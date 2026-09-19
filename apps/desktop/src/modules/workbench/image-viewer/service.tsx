import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FileManagerEntry } from "../../../shared/file-manager";
import type { ImageViewerEvent } from "../../../shared/image-viewer";
import { previewKindFromPath } from "../file-preview/kinds";
import type {
  ImageViewerAppState,
  ImageViewerModel,
  ImageViewerViewport,
  UseImageViewerModelOptions
} from "./types";
import {
  imageViewerSourceEditorId,
  isImageViewerSupportedPath,
  parentPathFromImagePath,
  titleFromImagePath
} from "./path-utils";

const createId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
};

const defaultViewport = (): ImageViewerViewport => ({
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  background: "checkerboard"
});

const isSameViewport = (left: ImageViewerViewport, right: ImageViewerViewport): boolean =>
  left.zoom === right.zoom
  && left.offsetX === right.offsetX
  && left.offsetY === right.offsetY
  && left.rotation === right.rotation
  && left.background === right.background;

const normalizePath = (value: string): string => value.trim();

const toComparablePath = (value: string, platform: NodeJS.Platform | null): string =>
  platform === "win32" || platform === "darwin"
    ? value.replaceAll("\\", "/").toLowerCase()
    : value.replaceAll("\\", "/");

export const createImageViewerIdleState = (
  instanceId: string,
  filePath: string
): ImageViewerAppState => ({
  instanceId,
  filePath,
  title: titleFromImagePath(filePath),
  iconKey: "image-viewer-default",
  status: "idle",
  sessionId: undefined,
  openResult: null,
  importProgress: undefined,
  message: undefined,
  view: defaultViewport(),
  siblingPaths: [],
  siblingIndex: -1
});

const toReadableError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isUnsupportedError = (message: string): boolean =>
  message.toLowerCase().includes("unsupported image format");

const sortEntries = (entries: readonly FileManagerEntry[]): readonly FileManagerEntry[] =>
  [...entries].sort((left, right) => left.name.localeCompare(right.name));

export const useImageViewerModel = ({
  desktopApi,
  fileEditorModel,
  onMetaChange
}: UseImageViewerModelOptions): ImageViewerModel => {
  const [statesById, setStatesById] = useState<Record<string, ImageViewerAppState>>({});
  const statesRef = useRef<Record<string, ImageViewerAppState>>({});
  const committedStatesRef = useRef(statesById);
  committedStatesRef.current = statesById;
  if (
    Object.keys(statesRef.current).length === 0
    && Object.keys(statesById).length > 0
  ) {
    statesRef.current = statesById;
  }
  const listenersRef = useRef(new Set<() => void>());
  const tabInstancesRef = useRef<ReadonlySet<string>>(new Set());
  const externalInstancesRef = useRef<ReadonlySet<string>>(new Set());
  const loadVersionRef = useRef<Record<string, number>>({});
  const platform = desktopApi?.appMeta.platform ?? null;

  useEffect(() => {
    statesRef.current = statesById;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, [statesById]);

  const subscribe = useCallback((onStoreChange: () => void) => {
    listenersRef.current.add(onStoreChange);
    return () => {
      listenersRef.current.delete(onStoreChange);
    };
  }, []);

  const svgSourceKeyRef = useRef("");
  const syncSvgSourceEditors = useCallback((states: Record<string, ImageViewerAppState>): void => {
    if (fileEditorModel === undefined) {
      return;
    }
    const ids = Object.values(states)
      .filter((state) => previewKindFromPath(state.filePath) === "svg")
      .map((state) => imageViewerSourceEditorId(state.instanceId));
    const key = ids.join("\0");
    if (key === svgSourceKeyRef.current) {
      return;
    }
    svgSourceKeyRef.current = key;
    fileEditorModel.syncExternalInstances(ids, "image-viewer-source");
  }, [fileEditorModel]);

  useEffect(() => {
    syncSvgSourceEditors(statesById);
  }, [statesById, syncSvgSourceEditors]);

  const publishMeta = useCallback((state: ImageViewerAppState): void => {
    onMetaChange({
      appId: "image-viewer",
      appInstanceId: state.instanceId,
      title: state.title,
      iconKey: state.iconKey,
      filePath: state.filePath,
      ...(state.sessionId === undefined ? {} : { fileSessionId: state.sessionId }),
      isDirty: false
    });
  }, [onMetaChange]);

  const patchState = useCallback((
    instanceId: string,
    updater: (state: ImageViewerAppState) => ImageViewerAppState,
    options?: { readonly publishMeta?: boolean }
  ): ImageViewerAppState | null => {
    let nextState: ImageViewerAppState | null = null;
    let shouldPublish = false;
    const publish = options?.publishMeta !== false;
    setStatesById((current) => {
      const existing = current[instanceId];
      if (existing === undefined) {
        return current;
      }
      nextState = updater(existing);
      if (nextState === existing) {
        return current;
      }
      shouldPublish = publish;
      const nextStates = {
        ...current,
        [instanceId]: nextState
      };
      statesRef.current = nextStates;
      return nextStates;
    });
    if (shouldPublish && nextState !== null) {
      publishMeta(nextState);
    }
    return nextState;
  }, [publishMeta]);

  const ensureInstance = useCallback<ImageViewerModel["ensureInstance"]>((instanceId, options) => {
    const filePath = normalizePath(options.filePath);
    if (filePath.length === 0) {
      return;
    }
    if (statesRef.current[instanceId] !== undefined) {
      return;
    }
    const state = createImageViewerIdleState(instanceId, filePath);
    const nextStates = {
      ...statesRef.current,
      [instanceId]: state
    };
    statesRef.current = nextStates;
    setStatesById(nextStates);
    publishMeta(state);
    syncSvgSourceEditors(nextStates);
  }, [publishMeta, syncSvgSourceEditors]);

  const createInstance = useCallback<ImageViewerModel["createInstance"]>((filePath) => {
    const normalized = normalizePath(filePath);
    const instanceId = createId("image-viewer");
    const state = createImageViewerIdleState(instanceId, normalized);
    const nextStates = {
      ...statesRef.current,
      [instanceId]: state
    };
    statesRef.current = nextStates;
    setStatesById(nextStates);
    publishMeta(state);
    syncSvgSourceEditors(nextStates);
    return {
      appId: "image-viewer",
      appInstanceId: instanceId,
      title: state.title,
      iconKey: state.iconKey,
      filePath: state.filePath,
      isDirty: false
    };
  }, [publishMeta, syncSvgSourceEditors]);

  const findInstanceByPath = useCallback<ImageViewerModel["findInstanceByPath"]>((filePath) => {
    const comparable = toComparablePath(normalizePath(filePath), platform);
    for (const state of Object.values(statesRef.current)) {
      if (toComparablePath(state.filePath, platform) === comparable) {
        return state.instanceId;
      }
    }
    return null;
  }, [platform]);

  const getState = useCallback<ImageViewerModel["getState"]>(
    (instanceId) =>
      statesRef.current[instanceId]
      ?? committedStatesRef.current[instanceId]
      ?? null,
    []
  );

  const readSiblingPaths = useCallback(async (filePath: string): Promise<readonly string[]> => {
    const parentPath = parentPathFromImagePath(filePath);
    if (desktopApi === null || parentPath === null) {
      return [];
    }
    try {
      const directory = await desktopApi.files.readDirectory({ path: parentPath });
      return sortEntries(directory.entries)
        .filter((entry) => entry.kind === "file" && isImageViewerSupportedPath(entry.path))
        .map((entry) => entry.path);
    } catch (_error) {
      return [];
    }
  }, [desktopApi]);

  const openImage = useCallback<ImageViewerModel["openImage"]>(async (instanceId, filePath, options) => {
    const normalized = normalizePath(filePath);
    ensureInstance(instanceId, { filePath: normalized });
    if (fileEditorModel !== undefined && previewKindFromPath(normalized) === "svg") {
      const sourceId = imageViewerSourceEditorId(instanceId);
      fileEditorModel.ensureInstance(sourceId, {
        filePath: normalized,
        fileSessionId: `image-viewer:${instanceId}`
      });
      syncSvgSourceEditors(statesRef.current);
      void fileEditorModel.openFile(sourceId, normalized);
    }
    const version = (loadVersionRef.current[instanceId] ?? 0) + 1;
    loadVersionRef.current[instanceId] = version;
    const previousSessionId = statesRef.current[instanceId]?.sessionId;
    const requestedSiblingPaths = options?.siblingPaths;
    patchState(instanceId, (state) => ({
      ...state,
      filePath: normalized,
      title: titleFromImagePath(normalized),
      status: "loading",
      message: undefined,
      openResult: null,
      importProgress: undefined,
      sessionId: undefined,
      view: defaultViewport()
    }));

    if (desktopApi === null || desktopApi.imageViewer === undefined) {
      patchState(instanceId, (state) => ({
        ...state,
        status: "error",
        message: "Image viewer native service is unavailable."
      }));
      return;
    }

    if (previousSessionId !== undefined) {
      void desktopApi.imageViewer.closeSession({ sessionId: previousSessionId }).catch(() => undefined);
    }

    try {
      const openResult = await desktopApi.imageViewer.openImage({ path: normalized });
      if (loadVersionRef.current[instanceId] !== version) {
        void desktopApi.imageViewer.closeSession({ sessionId: openResult.sessionId }).catch(() => undefined);
        return;
      }
      const applySiblings = (siblingPaths: readonly string[]): void => {
        const siblingIndex = siblingPaths.findIndex(
          (path) => toComparablePath(path, platform) === toComparablePath(openResult.path, platform)
        );
        patchState(instanceId, (state) => {
          if (state.sessionId !== openResult.sessionId) {
            return state;
          }
          return {
            ...state,
            siblingPaths,
            siblingIndex
          };
        });
      };
      const initialSiblings = requestedSiblingPaths === undefined || requestedSiblingPaths.length === 0
        ? { siblingPaths: [] as readonly string[], siblingIndex: -1 }
        : (() => {
          const siblingPaths = requestedSiblingPaths.some(
            (path) => toComparablePath(path, platform) === toComparablePath(openResult.path, platform)
          )
            ? requestedSiblingPaths
            : [openResult.path, ...requestedSiblingPaths];
          const siblingIndex = siblingPaths.findIndex(
            (path) => toComparablePath(path, platform) === toComparablePath(openResult.path, platform)
          );
          return { siblingPaths, siblingIndex };
        })();
      patchState(instanceId, (state) => ({
        ...state,
        filePath: openResult.path,
        title: openResult.title,
        status: "ready",
        sessionId: openResult.sessionId,
        openResult,
        importProgress: openResult.importProgress,
        message: undefined,
        siblingPaths: initialSiblings.siblingPaths,
        siblingIndex: initialSiblings.siblingIndex
      }));
      if (requestedSiblingPaths !== undefined && requestedSiblingPaths.length > 0) {
        return;
      }
      void readSiblingPaths(openResult.path).then((siblingPaths) => {
        if (loadVersionRef.current[instanceId] !== version) {
          return;
        }
        applySiblings(siblingPaths);
      }).catch(() => undefined);
    } catch (error) {
      const message = toReadableError(error);
      patchState(instanceId, (state) => ({
        ...state,
        status: isUnsupportedError(message) ? "unsupported" : "error",
        importProgress: undefined,
        message
      }));
    }
  }, [desktopApi, ensureInstance, fileEditorModel, patchState, platform, readSiblingPaths, syncSvgSourceEditors]);

  useEffect(() => {
    if (desktopApi?.imageViewer?.onEvent === undefined) {
      return undefined;
    }
    const handleEvent = (event: ImageViewerEvent): void => {
      if (event.kind === "import-progress") {
        for (const state of Object.values(statesRef.current)) {
          if (state.sessionId !== event.sessionId) {
            continue;
          }
          patchState(state.instanceId, (current) => {
            if (current.sessionId !== event.sessionId || current.openResult === null) {
              return current;
            }
            return {
              ...current,
              importProgress: event.progress,
              openResult: {
                ...current.openResult,
                importProgress: event.progress,
                cacheState: "importing"
              },
              message: event.message ?? current.message
            };
          });
        }
        return;
      }
      if (event.kind === "cache-ready") {
        for (const state of Object.values(statesRef.current)) {
          if (state.sessionId !== event.sessionId) {
            continue;
          }
          patchState(state.instanceId, (current) => {
            if (current.sessionId !== event.sessionId || current.openResult === null) {
              return current;
            }
            return {
              ...current,
              importProgress: 1,
              openResult: {
                ...current.openResult,
                cacheState: "ready",
                importProgress: 1
              }
            };
          });
        }
        return;
      }
      if (event.kind === "cache-error") {
        for (const state of Object.values(statesRef.current)) {
          if (state.sessionId !== event.sessionId) {
            continue;
          }
          patchState(state.instanceId, (current) => ({
            ...current,
            status: "error",
            message: event.message,
            importProgress: undefined
          }));
        }
      }
    };
    return desktopApi.imageViewer.onEvent(handleEvent);
  }, [desktopApi?.imageViewer, patchState]);

  const openAdjacent = useCallback<ImageViewerModel["openAdjacent"]>(async (instanceId, direction) => {
    const state = statesRef.current[instanceId];
    if (state === undefined || state.siblingPaths.length === 0) {
      return;
    }
    const currentIndex = state.siblingIndex >= 0 ? state.siblingIndex : 0;
    const nextIndex = (currentIndex + direction + state.siblingPaths.length) % state.siblingPaths.length;
    const nextPath = state.siblingPaths[nextIndex];
    if (nextPath !== undefined) {
      await openImage(instanceId, nextPath, { siblingPaths: state.siblingPaths });
    }
  }, [openImage]);

  const readTile = useCallback<ImageViewerModel["readTile"]>(async (request) => {
    if (desktopApi === null || desktopApi.imageViewer === undefined) {
      throw new Error("Image viewer native service is unavailable.");
    }
    return desktopApi.imageViewer.readTile(request);
  }, [desktopApi]);

  const setViewport = useCallback<ImageViewerModel["setViewport"]>((instanceId, patch) => {
    patchState(instanceId, (state) => {
      const nextView: ImageViewerViewport = {
        zoom: patch.zoom === undefined ? state.view.zoom : Math.max(0.02, Math.min(64, patch.zoom)),
        offsetX: patch.offsetX === undefined ? state.view.offsetX : patch.offsetX,
        offsetY: patch.offsetY === undefined ? state.view.offsetY : patch.offsetY,
        rotation: patch.rotation === undefined ? state.view.rotation : ((patch.rotation % 360) + 360) % 360,
        background: patch.background === undefined ? state.view.background : patch.background
      };
      if (isSameViewport(state.view, nextView)) {
        return state;
      }
      return {
        ...state,
        view: nextView
      };
    }, { publishMeta: false });
  }, [patchState]);

  const resetViewport = useCallback<ImageViewerModel["resetViewport"]>((instanceId) => {
    patchState(instanceId, (state) => {
      const nextView = defaultViewport();
      if (isSameViewport(state.view, nextView)) {
        return state;
      }
      return {
        ...state,
        view: nextView
      };
    }, { publishMeta: false });
  }, [patchState]);

  const syncTabInstances = useCallback<ImageViewerModel["syncTabInstances"]>((instanceIds) => {
    const nextIds = new Set(instanceIds);
    tabInstancesRef.current = nextIds;
    const kept = new Set([
      ...nextIds,
      ...externalInstancesRef.current
    ]);
    setStatesById((current) => {
      const next: Record<string, ImageViewerAppState> = {};
      let removed = false;
      for (const [instanceId, state] of Object.entries(current)) {
        if (kept.has(instanceId)) {
          next[instanceId] = state;
          continue;
        }
        removed = true;
        if (state.sessionId !== undefined && desktopApi?.imageViewer !== undefined) {
          void desktopApi.imageViewer.closeSession({ sessionId: state.sessionId }).catch(() => undefined);
        }
      }
      if (removed === false) {
        return current;
      }
      statesRef.current = next;
      return next;
    });
  }, [desktopApi?.imageViewer]);

  const syncExternalInstances = useCallback<ImageViewerModel["syncExternalInstances"]>((instanceIds) => {
    externalInstancesRef.current = new Set(instanceIds);
    syncTabInstances(Array.from(tabInstancesRef.current));
  }, [syncTabInstances]);

  const touchInstance = useCallback<ImageViewerModel["touchInstance"]>(() => undefined, []);

  return useMemo(() => ({
    createInstance,
    findInstanceByPath,
    getState,
    ensureInstance,
    syncTabInstances,
    syncExternalInstances,
    subscribe,
    openImage,
    openAdjacent,
    readTile,
    setViewport,
    resetViewport,
    touchInstance
  }), [
    createInstance,
    findInstanceByPath,
    getState,
    ensureInstance,
    syncTabInstances,
    syncExternalInstances,
    subscribe,
    openImage,
    openAdjacent,
    readTile,
    setViewport,
    resetViewport,
    touchInstance
  ]);
};
