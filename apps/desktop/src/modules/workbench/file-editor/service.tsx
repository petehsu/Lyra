import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  LspDocumentRequest,
  LspLanguageId,
  LspRuntimeEvent
} from "../../../shared/desktop-bridge";
import type { FileTextEncoding } from "../../../shared/file-manager";
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

const languageFromPath = (filePath: string): string => {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "ts") return "typescript";
  if (extension === "tsx") return "typescript";
  if (extension === "js") return "javascript";
  if (extension === "jsx") return "javascript";
  if (extension === "json") return "json";
  if (extension === "md") return "markdown";
  if (extension === "rs") return "rust";
  if (extension === "py") return "python";
  if (extension === "go") return "go";
  if (extension === "java") return "java";
  if (extension === "css") return "css";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "yml" || extension === "yaml") return "yaml";
  if (extension === "toml") return "toml";
  return "plaintext";
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
  diagnostics: [],
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
    return "这是 Lyra 运行时工具路径，不是本地文件。";
  }
  if (reason === "not-found") {
    return "文件不存在或尚未创建。";
  }
  if (reason === "not-file") {
    return "当前路径不是可编辑文件。";
  }
  if (reason === "file-too-large") {
    return "文件过大，已降级为只读或不可编辑。";
  }
  if (reason === "encoding-not-supported") {
    return "当前文件编码暂不支持编辑。";
  }
  return "当前文件类型暂不支持编辑。";
};

const shouldSyncLsp = (state: FileEditorAppState): boolean =>
  state.isHydrated &&
  state.status !== "loading" &&
  state.status !== "unsupported" &&
  state.status !== "error";

const toLspDocumentRequest = (
  state: FileEditorAppState,
  languageId: LspLanguageId
): LspDocumentRequest => ({
  sessionId: state.sessionId,
  filePath: state.filePath,
  languageId,
  content: state.content,
  version: state.lspVersion
});

export const useFileEditorModel = ({
  desktopApi,
  onMetaChange
}: UseFileEditorModelOptions): FileEditorModel => {
  const [statesById, setStatesById] = useState<Record<string, FileEditorAppState>>({});
  const statesRef = useRef<Record<string, FileEditorAppState>>({});
  const usageRef = useRef<readonly string[]>([]);
  const tabInstancesRef = useRef<ReadonlySet<string>>(new Set());
  const externalInstancesRef = useRef<ReadonlySet<string>>(new Set());
  const loadVersionRef = useRef<Record<string, number>>({});
  const lspSyncedVersionRef = useRef<Record<string, number>>({});
  const platform = desktopApi?.appMeta.platform ?? null;

  useEffect(() => {
    statesRef.current = statesById;
  }, [statesById]);

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
        isHydrated: false,
        diagnostics: []
      };
      hydratedCount -= 1;
      publishMeta(next[instanceId]);
      delete lspSyncedVersionRef.current[instanceId];
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
      publishMeta(withEviction[instanceId]!);
      return withEviction;
    });
  }, [applyHydrationEviction, publishMeta]);

  useEffect(() => {
    if (desktopApi?.lsp === undefined) {
      return;
    }

    return desktopApi.lsp.onEvent((event: LspRuntimeEvent) => {
      if (event.kind === "diagnostic") {
        setStatesById((current) => {
          const entries = Object.entries(current);
          let targetId: string | null = null;

          if (event.sessionId !== undefined) {
            const bySession = entries.find(([, state]) => state.sessionId === event.sessionId);
            targetId = bySession?.[0] ?? null;
          }

          if (targetId === null && event.filePath !== undefined) {
            const comparable = toComparablePath(event.filePath, platform);
            const byPath = entries.find(([, state]) =>
              toComparablePath(state.filePath, platform) === comparable
            );
            targetId = byPath?.[0] ?? null;
          }

          if (targetId === null) {
            return current;
          }

          const base = current[targetId];
          if (base === undefined) {
            return current;
          }

          return {
            ...current,
            [targetId]: {
              ...base,
              diagnostics: event.diagnostics
            }
          };
        });
        return;
      }

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
        message: "文件编辑器原生能力不可用。"
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
      }
    }

    const nextVersion = (loadVersionRef.current[instanceId] ?? 0) + 1;
    loadVersionRef.current = {
      ...loadVersionRef.current,
      [instanceId]: nextVersion
    };

    patchState(instanceId, (state) => ({
      ...state,
      status: "loading",
      message: undefined,
      unsupportedReason: undefined
    }));

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
          diagnostics: [],
          pendingRevealLocation: current.pendingRevealLocation
        });
        touch(instanceId);
        delete lspSyncedVersionRef.current[instanceId];
        return;
      }

      const isReadOnly = result.readOnly;
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
        diagnostics: [],
        pendingRevealLocation: current.pendingRevealLocation
      };
      replaceState(instanceId, nextState);
      delete lspSyncedVersionRef.current[instanceId];
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
      const lspLanguageId = toLspLanguageId(state.languageId);
      if (lspLanguageId === null || shouldSyncLsp(state) === false) {
        continue;
      }

      const syncedVersion = lspSyncedVersionRef.current[state.instanceId];
      const request = toLspDocumentRequest(state, lspLanguageId);
      if (syncedVersion === undefined) {
        lspSyncedVersionRef.current[state.instanceId] = state.lspVersion;
        void desktopApi.lsp.openDocument(request).catch((error) => {
          delete lspSyncedVersionRef.current[state.instanceId];
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

  const getState = useCallback((instanceId: string) => statesRef.current[instanceId] ?? null, []);

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
        diagnostics: [],
        pendingRevealLocation: existing.pendingRevealLocation,
        ...(normalizedSessionId === undefined ? {} : { sessionId: normalizedSessionId })
      };
      const nextStates = {
        ...current,
        [instanceId]: nextState
      };
      statesRef.current = nextStates;
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
      return nextStates;
    });

    const nextSynced = { ...lspSyncedVersionRef.current };
    for (const instanceId of Object.keys(nextSynced)) {
      if (kept.has(instanceId) === false) {
        delete nextSynced[instanceId];
      }
    }
    lspSyncedVersionRef.current = nextSynced;

    usageRef.current = usageRef.current.filter((instanceId) => kept.has(instanceId));
  }, [desktopApi?.lsp]);

  const syncExternalInstances = useCallback((instanceIds: readonly string[]) => {
    externalInstancesRef.current = new Set(instanceIds);
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
        message: "文件编辑器原生能力不可用。"
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
        version: current.lspVersion
      });
      return completionResult.items;
    } catch (_error) {
      return [];
    }
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
      requestCompletion
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
      requestCompletion
    ]
  );
};
