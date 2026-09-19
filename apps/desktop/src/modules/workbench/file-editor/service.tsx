import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@workbench/i18n";

import type {
  LspDocumentRequest,
  LspLanguageId,
  LspRuntimeEvent,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";
import type { FileTextEncoding } from "../../../shared/file-manager";
import {
  disposeFileEditorTextModel,
  disposeInactiveFileEditorTextModels
} from "./monaco-model-store";
import { languageFromPath } from "../syntax/language-from-path";
import type {
  FileEditorAppIconKey,
  FileEditorAppState,
  FileEditorRevealLocation,
  FileEditorModel,
  FileEditorSaveSource,
  FileEditorSuggestion,
  FileEditorWriteOutcome,
  UseFileEditorModelOptions
} from "./types";
import { isLspLanguageId } from "./types";
import {
  isTypeScriptConfigPath
} from "./typescript-config";

const MAX_HYDRATED_EDITOR_STATES = 12;

const createId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
};

const normalizePath = (value: string): string => value.trim();

const toComparablePath = (value: string, platform: NodeJS.Platform | null): string =>
  platform === "win32" || platform === "darwin"
    ? value.replaceAll("\\", "/").toLowerCase()
    : value.replaceAll("\\", "/");

const titleFromPath = (filePath: string): string => {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const tail = segments[segments.length - 1];
  return tail === undefined || tail.length === 0 ? filePath : tail;
};

const toLspLanguageId = (languageId: string): LspLanguageId | null =>
  isLspLanguageId(languageId) ? languageId : null;

const iconFromState = (
  status: FileEditorAppState["status"],
  isReadOnly: boolean
): FileEditorAppIconKey => {
  if (status === "unsupported" || status === "error") {
    return "file-editor-unsupported";
  }
  if (isReadOnly) {
    return "file-editor-readonly";
  }
  return "file-editor-code";
};

const createInitialState = (
  instanceId: string,
  sessionId: string,
  filePath: string
): FileEditorAppState => ({
  instanceId,
  sessionId,
  filePath,
  title: titleFromPath(filePath),
  iconKey: "file-editor-code",
  status: "idle",
  languageId: languageFromPath(filePath),
  encoding: "utf8",
  content: "",
  lastSavedContent: "",
  isDirty: false,
  isReadOnly: false,
  isHydrated: false,
  revision: undefined,
  sizeBytes: 0,
  unsupportedReason: undefined,
  message: undefined,
  lastSavedAt: undefined,
  lspVersion: 1,
  pendingRevealLocation: undefined
});

const resolveEncoding = (value: string | undefined): FileTextEncoding =>
  value === "utf8-bom" ? "utf8-bom" : "utf8";

const toReadableError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const normalizeRevealLocation = (
  location: FileEditorRevealLocation
): FileEditorRevealLocation => ({
  line: Math.max(1, Math.round(location.line)),
  ...(typeof location.column === "number" && Number.isFinite(location.column)
    ? { column: Math.max(1, Math.round(location.column)) }
    : {}),
  ...(typeof location.endLine === "number" && Number.isFinite(location.endLine)
    ? { endLine: Math.max(1, Math.round(location.endLine)) }
    : {})
});

const readUnsupportedMessage = (reason: string | undefined): string => {
  if (reason === "virtual-tool-path") {
    return t("fileEditor.unsupportedVirtualToolPath");
  }
  if (reason === "not-found") {
    return t("fileEditor.unsupportedNotFound");
  }
  if (reason === "not-file") {
    return t("fileEditor.unsupportedNotFile");
  }
  if (reason === "file-too-large") {
    return t("fileEditor.unsupportedFileTooLarge");
  }
  if (reason === "encoding-not-supported") {
    return t("fileEditor.unsupportedEncodingNotSupported");
  }
  return t("fileEditor.unsupportedDefault");
};

const shouldSyncLsp = (state: FileEditorAppState): boolean =>
  state.isHydrated &&
  state.status !== "loading" &&
  state.status !== "unsupported" &&
  state.status !== "error";

const tsconfigInspectSyncKey = (instanceId: string): string => `${instanceId}:tsconfig-inspect`;

const lspSyncOwnerId = (key: string): string => {
  if (key.endsWith(":tsconfig-seed")) {
    return key.slice(0, -":tsconfig-seed".length);
  }
  if (key.endsWith(":tsconfig-inspect")) {
    return key.slice(0, -":tsconfig-inspect".length);
  }
  return key;
};

const PROJECT_ROOT_MARKERS = [
  ".git",
  "Cargo.toml",
  "package.json",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "composer.json",
  "mix.exs",
  "CMakeLists.txt",
  "pubspec.yaml",
  "Gemfile"
] as const;

const parentDirectory = (filePath: string): string | null => {
  const trimmed = filePath.replace(/[\\/]+$/u, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slash <= 0) {
    return null;
  }
  return trimmed.slice(0, slash);
};

const joinPath = (directory: string, name: string): string => {
  const separator = directory.includes("\\") && directory.includes("/") === false ? "\\" : "/";
  return `${directory}${separator}${name}`;
};

const resolveProjectRoot = async (
  desktopApi: LyraDesktopApi,
  filePath: string
): Promise<string | undefined> => {
  let cursor = parentDirectory(filePath);
  for (let depth = 0; depth < 24 && cursor !== null; depth += 1) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        const stat = await desktopApi.files.statFile({ path: joinPath(cursor, marker) });
        if (stat.exists) {
          return cursor;
        }
      } catch {
        // keep walking
      }
    }
    cursor = parentDirectory(cursor);
  }
  return undefined;
};

const toLspDocumentRequest = (
  state: FileEditorAppState,
  languageId: LspLanguageId
): LspDocumentRequest => {
  const request: LspDocumentRequest = {
    sessionId: state.sessionId,
    filePath: state.filePath,
    languageId,
    content: state.content,
    version: state.lspVersion
  };
  return state.projectRoot === undefined || state.projectRoot.trim().length === 0
    ? request
    : { ...request, projectRoot: state.projectRoot };
};

export const useFileEditorModel = ({
  desktopApi,
  onMetaChange
}: UseFileEditorModelOptions): FileEditorModel => {
  const [statesById, setStatesById] = useState<Record<string, FileEditorAppState>>({});
  const statesRef = useRef<Record<string, FileEditorAppState>>({});
  const committedStatesRef = useRef(statesById);
  committedStatesRef.current = statesById;
  if (
    Object.keys(statesRef.current).length === 0
    && Object.keys(statesById).length > 0
  ) {
    statesRef.current = statesById;
  }
  const listenersRef = useRef(new Set<() => void>());
  const usageRef = useRef<readonly string[]>([]);
  const tabInstancesRef = useRef<ReadonlySet<string>>(new Set());
  const externalInstancesRef = useRef<ReadonlySet<string>>(new Set());
  const externalOwnersRef = useRef<Map<string, readonly string[]>>(new Map());
  const loadVersionRef = useRef<Record<string, number>>({});
  const lspSyncedVersionRef = useRef<Record<string, number>>({});
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

  useEffect(() => () => {
    disposeInactiveFileEditorTextModels({});
  }, []);

  const publishMeta = useCallback((state: FileEditorAppState): void => {
    onMetaChange({
      appId: "file-editor",
      appInstanceId: state.instanceId,
      title: state.title,
      iconKey: state.iconKey,
      filePath: state.filePath,
      fileSessionId: state.sessionId,
      isDirty: state.isDirty
    });
  }, [onMetaChange]);

  const trimUsageToExisting = useCallback((states: Record<string, FileEditorAppState>): readonly string[] => {
    const existing = new Set(Object.keys(states));
    return usageRef.current.filter((instanceId) => existing.has(instanceId));
  }, []);

  const applyHydrationEviction = useCallback((
    states: Record<string, FileEditorAppState>,
    protectedInstanceId: string
  ): Record<string, FileEditorAppState> => {
    const usage = trimUsageToExisting(states);
    let hydratedCount = Object.values(states).filter((entry) => entry.isHydrated).length;
    if (hydratedCount <= MAX_HYDRATED_EDITOR_STATES) {
      usageRef.current = usage;
      return states;
    }

    const next = { ...states };
    for (const instanceId of usage) {
      if (hydratedCount <= MAX_HYDRATED_EDITOR_STATES) {
        break;
      }
      if (instanceId === protectedInstanceId) {
        continue;
      }
      const target = next[instanceId];
      if (target === undefined) {
        continue;
      }
      if (target.isHydrated === false || target.isDirty || target.status !== "ready") {
        continue;
      }

      next[instanceId] = {
        ...target,
        content: "",
        lastSavedContent: "",
        isHydrated: false
      };
      disposeFileEditorTextModel(instanceId);
      hydratedCount -= 1;
      publishMeta(next[instanceId]);
      delete lspSyncedVersionRef.current[instanceId];
      delete lspSyncedVersionRef.current[tsconfigInspectSyncKey(instanceId)];
    }

    usageRef.current = usage;
    return next;
  }, [publishMeta, trimUsageToExisting]);

  const touch = useCallback((instanceId: string): void => {
    const current = usageRef.current.filter((entry) => entry !== instanceId);
    usageRef.current = [...current, instanceId];
  }, []);

  const patchState = useCallback((
    instanceId: string,
    updater: (state: FileEditorAppState) => FileEditorAppState
  ): void => {
    setStatesById((current) => {
      const base = current[instanceId];
      if (base === undefined) {
        return current;
      }
      const nextState = updater(base);
      const withPatched = {
        ...current,
        [instanceId]: nextState
      };
      const withEviction = applyHydrationEviction(withPatched, instanceId);
      statesRef.current = withEviction;
      disposeInactiveFileEditorTextModels(withEviction);
      publishMeta(withEviction[instanceId]!);
      return withEviction;
    });
  }, [applyHydrationEviction, publishMeta]);

  const replaceState = useCallback((instanceId: string, nextState: FileEditorAppState): void => {
    setStatesById((current) => {
      const withPatched = {
        ...current,
        [instanceId]: nextState
      };
      const withEviction = applyHydrationEviction(withPatched, instanceId);
      statesRef.current = withEviction;
      disposeInactiveFileEditorTextModels(withEviction);
      publishMeta(withEviction[instanceId]!);
      return withEviction;
    });
  }, [applyHydrationEviction, publishMeta]);

  useEffect(() => {
    if (desktopApi?.lsp === undefined) {
      return;
    }

    return desktopApi.lsp.onEvent((event: LspRuntimeEvent) => {
      if (event.kind === "error" && event.sessionId !== undefined) {
        const match = Object.values(statesRef.current).find(
          (state) => state.sessionId === event.sessionId
        );
        if (match !== undefined) {
          patchState(match.instanceId, (state) => ({
            ...state,
            message: event.message
          }));
        }
      }
    });
  }, [desktopApi?.lsp, patchState, platform]);

  const readFile = useCallback(async (instanceId: string, filePath: string): Promise<void> => {
    const current = statesRef.current[instanceId];
    if (current === undefined) {
      return;
    }
    if (desktopApi === null) {
      replaceState(instanceId, {
        ...current,
        status: "error",
        iconKey: "file-editor-unsupported",
        message: t("fileEditor.nativeCapabilityUnavailable")
      });
      return;
    }

    if (
      desktopApi.lsp !== undefined &&
      current.filePath !== filePath
    ) {
      const lspLanguageId = toLspLanguageId(current.languageId);
      if (lspLanguageId !== null && lspSyncedVersionRef.current[instanceId] !== undefined) {
        void desktopApi.lsp.closeDocument(
          toLspDocumentRequest(current, lspLanguageId)
        ).catch(() => {
          // noop
        });
        delete lspSyncedVersionRef.current[instanceId];
        delete lspSyncedVersionRef.current[tsconfigInspectSyncKey(instanceId)];
      }
    }

    const nextVersion = (loadVersionRef.current[instanceId] ?? 0) + 1;
    loadVersionRef.current = {
      ...loadVersionRef.current,
      [instanceId]: nextVersion
    };

    if (current.isHydrated === false || current.status === "idle") {
      patchState(instanceId, (state) => ({
        ...state,
        status: "loading",
        message: undefined,
        unsupportedReason: undefined
      }));
    }

    try {
      const result = await desktopApi.files.readTextFile({ path: filePath });
      if ((loadVersionRef.current[instanceId] ?? 0) !== nextVersion) {
        return;
      }

      if (result.kind === "unsupported") {
        replaceState(instanceId, {
          ...current,
          title: titleFromPath(filePath),
          filePath,
          languageId: languageFromPath(filePath),
          status: "unsupported",
          iconKey: "file-editor-unsupported",
          unsupportedReason: result.reason,
          message: readUnsupportedMessage(result.reason),
          isHydrated: false,
          content: "",
          lastSavedContent: "",
          isDirty: false,
          isReadOnly: true,
          revision: undefined,
          sizeBytes: result.sizeBytes,
          lspVersion: 1,
          pendingRevealLocation: current.pendingRevealLocation
        });
        touch(instanceId);
        delete lspSyncedVersionRef.current[instanceId];
        delete lspSyncedVersionRef.current[tsconfigInspectSyncKey(instanceId)];
        return;
      }

      const isReadOnly = result.readOnly;
      const projectRoot = await resolveProjectRoot(desktopApi, filePath);
      const nextState: FileEditorAppState = {
        ...current,
        title: titleFromPath(filePath),
        filePath,
        languageId: languageFromPath(filePath),
        status: "ready",
        iconKey: iconFromState("ready", isReadOnly),
        encoding: resolveEncoding(result.encoding),
        content: result.content,
        lastSavedContent: result.content,
        isDirty: false,
        isReadOnly,
        isHydrated: true,
        revision: result.revision,
        sizeBytes: result.sizeBytes,
        unsupportedReason: undefined,
        message: undefined,
        lspVersion: 1,
        ...(projectRoot === undefined ? {} : { projectRoot }),
        pendingRevealLocation: current.pendingRevealLocation
      };
      replaceState(instanceId, nextState);
      delete lspSyncedVersionRef.current[instanceId];
      delete lspSyncedVersionRef.current[tsconfigInspectSyncKey(instanceId)];
      touch(instanceId);
    } catch (error) {
      if ((loadVersionRef.current[instanceId] ?? 0) !== nextVersion) {
        return;
      }
      patchState(instanceId, (state) => ({
        ...state,
        status: "error",
        iconKey: "file-editor-unsupported",
        message: toReadableError(error)
      }));
    }
  }, [desktopApi, patchState, replaceState, touch]);

  useEffect(() => {
    if (desktopApi?.lsp === undefined) {
      return;
    }

    for (const state of Object.values(statesById)) {
      if (shouldSyncLsp(state) === false) {
        continue;
      }
      if (isTypeScriptConfigPath(state.filePath)) {
        continue;
      }
      const lspLanguageId = toLspLanguageId(state.languageId);
      if (lspLanguageId === null) {
        continue;
      }

      const syncedVersion = lspSyncedVersionRef.current[state.instanceId];
      const request = toLspDocumentRequest(state, lspLanguageId);
      if (syncedVersion === undefined) {
        lspSyncedVersionRef.current[state.instanceId] = state.lspVersion;
        void desktopApi.lsp.openDocument(request).catch((error) => {
          patchState(state.instanceId, (entry) => ({
            ...entry,
            message: toReadableError(error)
          }));
        });
        continue;
      }

      if (state.lspVersion <= syncedVersion) {
        continue;
      }

      lspSyncedVersionRef.current[state.instanceId] = state.lspVersion;
      void desktopApi.lsp.changeDocument(request).catch((error) => {
        lspSyncedVersionRef.current[state.instanceId] = syncedVersion;
        patchState(state.instanceId, (entry) => ({
          ...entry,
          message: toReadableError(error)
        }));
      });
    }
  }, [desktopApi?.lsp, patchState, statesById]);

  const createInstance = useCallback((filePathRaw: string) => {
    const filePath = normalizePath(filePathRaw);
    if (filePath.length === 0) {
      throw new Error("file path is required");
    }
    const instanceId = createId("file-editor");
    const sessionId = createId("file-session");
    const initialState = createInitialState(instanceId, sessionId, filePath);
    const nextStates = {
      ...statesRef.current,
      [instanceId]: initialState
    };
    statesRef.current = nextStates;
    setStatesById(nextStates);
    publishMeta(initialState);
    touch(instanceId);

    return {
      appId: "file-editor" as const,
      appInstanceId: instanceId,
      title: initialState.title,
      iconKey: initialState.iconKey,
      filePath,
      fileSessionId: sessionId,
      isDirty: false
    };
  }, [publishMeta, touch]);

  const findInstanceByPath = useCallback((filePathRaw: string): string | null => {
    const normalized = normalizePath(filePathRaw);
    if (normalized.length === 0) {
      return null;
    }
    const comparable = toComparablePath(normalized, platform);
    for (const [instanceId, state] of Object.entries(statesRef.current)) {
      if (toComparablePath(state.filePath, platform) === comparable) {
        return instanceId;
      }
    }
    return null;
  }, [platform]);

  const getState = useCallback(
    (instanceId: string) =>
      statesRef.current[instanceId]
      ?? committedStatesRef.current[instanceId]
      ?? null,
    []
  );

  const ensureInstance = useCallback((instanceId: string, options: {
    readonly filePath: string;
    readonly fileSessionId?: string;
  }) => {
    const normalizedPath = normalizePath(options.filePath);
    if (normalizedPath.length === 0) {
      return;
    }

    const normalizedSessionId = options.fileSessionId?.trim();

    const current = statesRef.current;
    const existing = current[instanceId];
    if (existing !== undefined) {
      if (
        existing.filePath === normalizedPath &&
        (normalizedSessionId === undefined || existing.sessionId === normalizedSessionId)
      ) {
        return;
      }

      const nextState = {
        ...existing,
        filePath: normalizedPath,
        title: titleFromPath(normalizedPath),
        languageId: languageFromPath(normalizedPath),
        status: "idle" as const,
        isHydrated: false,
        content: "",
        lastSavedContent: "",
        pendingRevealLocation: existing.pendingRevealLocation,
        ...(normalizedSessionId === undefined ? {} : { sessionId: normalizedSessionId })
      };
      const nextStates = {
        ...current,
        [instanceId]: nextState
      };
      statesRef.current = nextStates;
      disposeFileEditorTextModel(instanceId);
      setStatesById(nextStates);
      publishMeta(nextState);
      return;
    }

    const initialState = createInitialState(
      instanceId,
      normalizedSessionId === undefined || normalizedSessionId.length === 0
        ? createId("file-session")
        : normalizedSessionId,
      normalizedPath
    );
    const nextStates = {
      ...current,
      [instanceId]: initialState
    };
    statesRef.current = nextStates;
    setStatesById(nextStates);
    publishMeta(initialState);
  }, [publishMeta]);

  const syncTabInstances = useCallback((instanceIds: readonly string[]) => {
    tabInstancesRef.current = new Set(instanceIds);
    const kept = new Set([
      ...instanceIds,
      ...externalInstancesRef.current
    ]);
    const currentStates = statesRef.current;

    if (desktopApi?.lsp !== undefined) {
      for (const state of Object.values(currentStates)) {
        if (kept.has(state.instanceId)) {
          continue;
        }
        const lspLanguageId = toLspLanguageId(state.languageId);
        if (lspLanguageId === null || lspSyncedVersionRef.current[state.instanceId] === undefined) {
          continue;
        }
        void desktopApi.lsp.closeDocument(toLspDocumentRequest(state, lspLanguageId)).catch(() => {
          // noop
        });
      }
    }

    setStatesById((current) => {
      const currentEntries = Object.entries(current);
      const nextEntries = currentEntries.filter(([instanceId]) => kept.has(instanceId));
      if (nextEntries.length === currentEntries.length) {
        return current;
      }
      const nextStates = Object.fromEntries(nextEntries);
      statesRef.current = nextStates;
      disposeInactiveFileEditorTextModels(nextStates);
      return nextStates;
    });

    const nextSynced = { ...lspSyncedVersionRef.current };
    for (const key of Object.keys(nextSynced)) {
      if (kept.has(lspSyncOwnerId(key)) === false) {
        delete nextSynced[key];
      }
    }
    lspSyncedVersionRef.current = nextSynced;

    usageRef.current = usageRef.current.filter((instanceId) => kept.has(instanceId));
  }, [desktopApi?.lsp]);

  const syncExternalInstances = useCallback((
    instanceIds: readonly string[],
    owner = "default"
  ) => {
    if (instanceIds.length === 0) {
      externalOwnersRef.current.delete(owner);
    } else {
      externalOwnersRef.current.set(owner, instanceIds);
    }
    const next = new Set<string>();
    for (const ids of externalOwnersRef.current.values()) {
      for (const id of ids) {
        next.add(id);
      }
    }
    externalInstancesRef.current = next;
    syncTabInstances(Array.from(tabInstancesRef.current));
  }, [syncTabInstances]);

  const openFile = useCallback(async (instanceId: string, filePath: string) => {
    const current = statesRef.current[instanceId];
    if (current === undefined) {
      return;
    }
    await readFile(instanceId, normalizePath(filePath));
  }, [readFile]);

  const hydrateIfNeeded = useCallback(async (instanceId: string) => {
    const current = statesRef.current[instanceId];
    if (
      current === undefined ||
      current.isHydrated ||
      current.status === "loading" ||
      current.status === "unsupported" ||
      current.status === "error"
    ) {
      return;
    }
    await readFile(instanceId, current.filePath);
  }, [readFile]);

  const touchInstance = useCallback((instanceId: string) => {
    touch(instanceId);
    setStatesById((current) => applyHydrationEviction(current, instanceId));
  }, [applyHydrationEviction, touch]);

  const revealLocation = useCallback((instanceId: string, location: FileEditorRevealLocation) => {
    const normalizedLocation = normalizeRevealLocation(location);
    patchState(instanceId, (state) => ({
      ...state,
      pendingRevealLocation: normalizedLocation
    }));
    touch(instanceId);
  }, [patchState, touch]);

  const clearRevealLocation = useCallback((instanceId: string) => {
    patchState(instanceId, (state) => {
      if (state.pendingRevealLocation === undefined) {
        return state;
      }
      return {
        ...state,
        pendingRevealLocation: undefined
      };
    });
  }, [patchState]);

  const setContent = useCallback((instanceId: string, content: string) => {
    patchState(instanceId, (state) => {
      if (state.isReadOnly || state.status === "loading" || state.isHydrated === false) {
        return state;
      }

      if (state.content === content) {
        return state;
      }

      const isDirty = content !== state.lastSavedContent;
      return {
        ...state,
        content,
        isDirty,
        lspVersion: state.lspVersion + 1,
        status: state.status === "conflict" ? "conflict" : "ready",
        iconKey: iconFromState(state.status === "conflict" ? "conflict" : "ready", state.isReadOnly)
      };
    });
    touch(instanceId);
  }, [patchState, touch]);

  const applyExternalContent = useCallback((
    instanceId: string,
    content: string,
    options?: {
      readonly markHydrated?: boolean;
      readonly readOnly?: boolean;
    }
  ) => {
    patchState(instanceId, (state) => {
      const markHydrated = options?.markHydrated ?? true;
      const isReadOnly = options?.readOnly ?? state.isReadOnly;
      const contentChanged = state.content !== content;
      if (
        contentChanged === false &&
        state.isHydrated === markHydrated &&
        state.isReadOnly === isReadOnly &&
        state.status === "ready" &&
        state.isDirty === false
      ) {
        return state;
      }

      return {
        ...state,
        status: "ready",
        iconKey: iconFromState("ready", isReadOnly),
        content,
        lastSavedContent: content,
        isDirty: false,
        isReadOnly,
        isHydrated: markHydrated,
        sizeBytes: content.length,
        message: undefined,
        unsupportedReason: undefined,
        lspVersion: contentChanged ? state.lspVersion + 1 : state.lspVersion
      };
    });
    touch(instanceId);
  }, [patchState, touch]);

  const save = useCallback(async (instanceId: string, _source: FileEditorSaveSource) => {
    const current = statesRef.current[instanceId];
    if (current === undefined || current.isHydrated === false || current.isReadOnly || current.isDirty === false) {
      return;
    }
    if (desktopApi === null) {
      patchState(instanceId, (state) => ({
        ...state,
        status: "error",
        message: t("fileEditor.nativeCapabilityUnavailable")
      }));
      return;
    }

    patchState(instanceId, (state) => ({
      ...state,
      status: "saving",
      message: undefined
    }));

    let writeResult: FileEditorWriteOutcome;
    try {
      const writeRequest = {
        path: current.filePath,
        content: current.content,
        encoding: current.encoding
      } as const;
      writeResult = await desktopApi.files.writeTextFile(
        current.revision === undefined
          ? writeRequest
          : {
              ...writeRequest,
              expectedRevision: current.revision
            }
      );
    } catch (error) {
      patchState(instanceId, (state) => ({
        ...state,
        status: "error",
        message: toReadableError(error),
        iconKey: "file-editor-unsupported"
      }));
      return;
    }

    if (writeResult.ok === false) {
      patchState(instanceId, (state) => ({
        ...state,
        status: "conflict",
        message: writeResult.message,
        iconKey: iconFromState("conflict", state.isReadOnly)
      }));
      return;
    }

    patchState(instanceId, (state) => ({
      ...state,
      status: "ready",
      revision: writeResult.revision,
      encoding: resolveEncoding(writeResult.encoding),
      isDirty: false,
      lastSavedContent: state.content,
      lastSavedAt: writeResult.savedAt,
      message: undefined,
      iconKey: iconFromState("ready", state.isReadOnly)
    }));
    touch(instanceId);

    if (desktopApi.lsp !== undefined) {
      const latest = statesRef.current[instanceId] ?? current;
      const lspLanguageId = toLspLanguageId(latest.languageId);
      if (lspLanguageId !== null && lspSyncedVersionRef.current[instanceId] !== undefined) {
        void desktopApi.lsp.saveDocument(toLspDocumentRequest(latest, lspLanguageId)).catch(() => {
          // noop
        });
      }
    }
  }, [desktopApi, patchState, touch]);

  const statFile = useCallback(async (instanceId: string) => {
    const current = statesRef.current[instanceId];
    if (current === undefined || desktopApi === null) {
      return null;
    }
    return desktopApi.files.statFile({
      path: current.filePath
    });
  }, [desktopApi]);

  const requestCompletion = useCallback(async (
    instanceId: string,
    line: number,
    column: number
  ): Promise<readonly FileEditorSuggestion[]> => {
    const current = statesRef.current[instanceId];
    if (current === undefined || desktopApi?.lsp === undefined) {
      return [];
    }

    const lspLanguageId = toLspLanguageId(current.languageId);
    if (lspLanguageId === null || shouldSyncLsp(current) === false) {
      return [];
    }

    try {
      const completionResult = await desktopApi.lsp.completion({
        sessionId: current.sessionId,
        filePath: current.filePath,
        languageId: lspLanguageId,
        line,
        column,
        version: current.lspVersion,
        ...(current.projectRoot === undefined ? {} : { projectRoot: current.projectRoot })
      });
      return completionResult.items;
    } catch (_error) {
      return [];
    }
  }, [desktopApi?.lsp]);

  const positionRequest = useCallback(async (
    instanceId: string,
    line: number,
    column: number
  ) => {
    const current = statesRef.current[instanceId];
    if (current === undefined || desktopApi?.lsp === undefined) {
      return null;
    }
    const lspLanguageId = toLspLanguageId(current.languageId);
    if (lspLanguageId === null || shouldSyncLsp(current) === false) {
      return null;
    }
    return {
      filePath: current.filePath,
      languageId: lspLanguageId,
      line,
      column,
      ...(current.projectRoot === undefined ? {} : { projectRoot: current.projectRoot })
    };
  }, [desktopApi?.lsp]);

  const requestHover = useCallback(async (
    instanceId: string,
    line: number,
    column: number
  ) => {
    const request = await positionRequest(instanceId, line, column);
    if (request === null || desktopApi?.lsp === undefined) {
      return null;
    }
    try {
      return await desktopApi.lsp.hover(request);
    } catch (_error) {
      return null;
    }
  }, [desktopApi?.lsp, positionRequest]);

  const requestDefinition = useCallback(async (
    instanceId: string,
    line: number,
    column: number
  ) => {
    const request = await positionRequest(instanceId, line, column);
    if (request === null || desktopApi?.lsp === undefined) {
      return [];
    }
    try {
      return await desktopApi.lsp.gotoDefinition(request);
    } catch (_error) {
      return [];
    }
  }, [desktopApi?.lsp, positionRequest]);

  const requestReferences = useCallback(async (
    instanceId: string,
    line: number,
    column: number
  ) => {
    const request = await positionRequest(instanceId, line, column);
    if (request === null || desktopApi?.lsp === undefined) {
      return [];
    }
    try {
      return await desktopApi.lsp.findReferences(request);
    } catch (_error) {
      return [];
    }
  }, [desktopApi?.lsp, positionRequest]);

  const subscribeLspEvents = useCallback((
    listener: (event: LspRuntimeEvent) => void
  ) => {
    if (desktopApi?.lsp === undefined) {
      return () => undefined;
    }
    return desktopApi.lsp.onEvent(listener);
  }, [desktopApi?.lsp]);

  return useMemo(
    () => ({
      createInstance,
      findInstanceByPath,
      getState,
      ensureInstance,
      syncExternalInstances,
      syncTabInstances,
      openFile,
      hydrateIfNeeded,
      touchInstance,
      revealLocation,
      clearRevealLocation,
      setContent,
      applyExternalContent,
      save,
      statFile,
      requestCompletion,
      requestHover,
      requestDefinition,
      requestReferences,
      subscribe,
      subscribeLspEvents
    }),
    [
      createInstance,
      findInstanceByPath,
      getState,
      ensureInstance,
      syncExternalInstances,
      syncTabInstances,
      openFile,
      hydrateIfNeeded,
      touchInstance,
      revealLocation,
      clearRevealLocation,
      setContent,
      applyExternalContent,
      save,
      statFile,
      requestCompletion,
      requestHover,
      requestDefinition,
      requestReferences,
      subscribe,
      subscribeLspEvents
    ]
  );
};
