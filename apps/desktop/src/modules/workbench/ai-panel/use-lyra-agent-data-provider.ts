import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type {
  JcodeModelsListResponse,
  AgentRuntimeEvent,
  AgentSessionSnapshot
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { SettingsAiModel } from "../settings-ai";
import type {
  AgentGoalItem,
  AgentImageAttachment,
  ComposerModelControls,
  DecisionOption,
  DecisionQuestion,
  DiffFileEntry,
  PermissionRequest
} from "./agent-chat-demo/core/types";
import { setLocale, t, type Locale } from "./agent-chat-demo/core/i18n";
import {
  createDataProviderValue,
  type CreateDataProviderValueInput
} from "./agent-chat-demo/data/createDataProviderValue";
import {
  agentSessionToChatMessages,
  agentSessionToSidePanel,
  agentSessionToSessionMeta,
  agentSessionToTodos,
  applyAgentRuntimeEventToSnapshot,
  jcodeModelsToModelOptions
} from "../agent-session-view-model";

type FileRevealLocation = {
  readonly line: number;
  readonly endLine?: number;
};

const isAbsoluteOrHomePath = (filePath: string): boolean =>
  /^(?:\/|~\/|[A-Za-z]:[\\/]|file:\/\/)/u.test(filePath);

const resolveSessionRelativePath = (filePath: string, workingDir: string | null | undefined): string => {
  const trimmed = filePath.trim();
  const base = workingDir?.trim() ?? "";
  if (trimmed.length === 0 || isAbsoluteOrHomePath(trimmed) || !base.startsWith("/") || base === "/") {
    return trimmed;
  }
  const parts: string[] = [];
  for (const part of `${base.replace(/\/+$/u, "")}/${trimmed}`.replaceAll("\\", "/").split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
};

const isOpenableImageSource = (source: string | null | undefined): source is string => {
  const trimmed = source?.trim() ?? "";
  if (trimmed.length === 0) {
    return false;
  }
  if (/^(?:local-file|browser-screenshot|window-screenshot|inline-data-url)$/u.test(trimmed)) {
    return false;
  }
  return /^(?:\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/]|file:\/\/|(?:apps|crates|web|scripts|packages|vendor|docs|target|参考)\/)/u
    .test(trimmed);
};

const imageUrlSource = (source: string | null | undefined): string | null => {
  const trimmed = source?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  if (/^www\./iu.test(trimmed)) {
    return `https://${trimmed}`;
  }
  if (/^localhost(?::\d+)?(?:\/|$)/iu.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return /^https?:\/\//iu.test(trimmed) ? trimmed : null;
};

const hasMaterializableImageData = (image: AgentImageAttachment): boolean => {
  const mediaType = image.mediaType.trim().toLowerCase();
  if (!mediaType.startsWith("image/")) {
    return false;
  }
  const data = image.data.replace(/\s+/gu, "");
  if (data.length === 0 || data.length % 4 === 1) {
    return false;
  }
  return /^[A-Za-z0-9+/_-]+={0,2}$/u.test(data);
};

type State = {
  readonly session: AgentSessionSnapshot | null;
  readonly error: string | null;
  readonly turnError: string | null;
  readonly loading: boolean;
};

type Action =
  | { readonly type: "loading" }
  | { readonly type: "snapshot"; readonly snapshot: AgentSessionSnapshot }
  | { readonly type: "event"; readonly event: AgentRuntimeEvent }
  | { readonly type: "error"; readonly message: string };

let lastAgentSessionId: string | null = null;

const initialState: State = {
  session: null,
  error: null,
  turnError: null,
  loading: true
};

const RUNNING_SESSION_REFRESH_MS = 10_000;

const applyEvent = (state: State, event: AgentRuntimeEvent): State => {
  if (event.kind === "sessionSnapshot") {
    if (state.session !== null && event.snapshot.id !== state.session.id) {
      return state;
    }
    lastAgentSessionId = event.snapshot.id;
    return {
      ...state,
      session: event.snapshot,
      loading: false,
      turnError: event.snapshot.turnStatus === "failed" ? state.turnError : null,
      error: null
    };
  }

  if (state.session !== null && "sessionId" in event && event.sessionId !== state.session.id) {
    return state;
  }

  const session = state.session;
  if (session === null) {
    return state;
  }

  if (event.kind === "turnFailed") {
    return {
      ...state,
      session: applyAgentRuntimeEventToSnapshot(session, event),
      turnError: event.message,
      error: null
    };
  }

  return {
    ...state,
    session: applyAgentRuntimeEventToSnapshot(session, event)
  };
};

function normalizeClarificationOptions(
  options: readonly (string | { readonly label: string; readonly description?: string | null })[]
): DecisionOption[] {
  const normalized: DecisionOption[] = [];
  for (const option of options) {
    const label = (typeof option === "string" ? option : option.label).trim();
    const description =
      typeof option === "string" ? null : normalizeOptionalText(option.description ?? null);
    if (label.length === 0 || isCustomOptionLabel(label)) continue;
    if (normalized.some((existing) => existing.label === label)) continue;
    normalized.push({ label, description });
  }
  return normalized;
}

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isCustomOptionLabel(label: string): boolean {
  const trimmed = label.trim();
  const normalized = trimmed.toLowerCase();
  return (
    normalized === "other" ||
    normalized === "custom" ||
    normalized === "something else" ||
    trimmed === "其他" ||
    trimmed === "其它" ||
    trimmed === "自定义"
  );
}

const reducer = (state: State, action: Action): State => {
  if (action.type === "loading") return { ...state, loading: true, error: null, turnError: null };
  if (action.type === "snapshot") {
    lastAgentSessionId = action.snapshot.id;
    return {
      ...state,
      session: action.snapshot,
      loading: false,
      error: null,
      turnError: action.snapshot.turnStatus === "failed" ? state.turnError : null
    };
  }
  if (action.type === "event") return applyEvent(state, action.event);
  return { ...state, loading: false, error: action.message };
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runtimeEventSessionId = (event: AgentRuntimeEvent): string | null => {
  if ("sessionId" in event) return event.sessionId;
  if (event.kind === "sessionSnapshot") return event.snapshot.id;
  return null;
};

const classifyPermissionRequest = (
  title: string,
  detail: string
): PermissionRequest["type"] => {
  const text = `${title} ${detail}`.toLowerCase();
  if (/\b(shell|bash|command|terminal|exec)\b/.test(text)) return "shell";
  if (/\b(file|write|read|delete|patch|edit|workspace)\b/.test(text)) return "file";
  if (/\b(http|https|network|browser|web|url)\b/.test(text)) return "network";
  return "dangerous";
};

const upsertById = <T extends { readonly id: string }>(items: readonly T[], item: T): T[] => {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...items, item];
  return items.map((existing, existingIndex) => (existingIndex === index ? item : existing));
};

const stringFromRecord = (value: unknown, key: string): string | null => {
  if (typeof value !== "object" || value === null || !Object.prototype.hasOwnProperty.call(value, key)) {
    return null;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : null;
};

const normalizeGoalItem = (value: unknown): AgentGoalItem | null => {
  const id = stringFromRecord(value, "id");
  if (id === null) return null;
  return {
    id,
    title: stringFromRecord(value, "title") ?? id,
    status: stringFromRecord(value, "status"),
    scope: stringFromRecord(value, "scope")
  };
};

export const useLyraAgentDataProvider = (
  desktopApi: LyraDesktopApi | null,
  settingsAiModel?: SettingsAiModel,
  activeSessionId?: string | null,
  onActiveSessionChange?: (sessionId: string) => void,
  onRequestProjectBind?: (currentPath?: string) => Promise<string | null>,
  onOpenProjectTree?: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void,
  onOpenSelfDevLab?: (request: {
    readonly parentSessionId: string | null;
  }) => Promise<void> | void,
  onOpenOvernightLab?: (request: {
    readonly parentSessionId: string | null;
  }) => Promise<void> | void,
  onOpenModelSettings?: () => Promise<void> | void,
  onOpenUrlInWorkbench?: (request: {
    readonly url: string;
    readonly title?: string;
  }) => Promise<void> | void,
  onOpenFile?: (filePath: string, location?: FileRevealLocation) => void,
  locale?: Locale
): {
  readonly data: ReturnType<typeof createDataProviderValue>;
  readonly followRunning: boolean;
  readonly followActivity: string | null;
  readonly error: string | null;
  readonly cancel: () => Promise<void>;
} => {
  if (locale !== undefined) {
    setLocale(locale);
  }

  const [state, dispatch] = useReducer(reducer, initialState);
  const [modelState, setModelState] = useState<JcodeModelsListResponse | null>(null);
  const [modelBusy, setModelBusy] = useState<"refresh" | "switch" | null>(null);
  const [browserFollowModeEnabled, setBrowserFollowModeEnabled] = useState(false);
  const [pendingClarifications, setPendingClarifications] = useState<DecisionQuestion[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const currentSessionIdRef = useRef<string | null>(lastAgentSessionId);
  const previousSessionIdRef = useRef<string | null>(lastAgentSessionId);
  const materializedImagePathsRef = useRef<Map<string, string>>(new Map());
  const modelConfigSignature = useMemo(() => {
    const config = settingsAiModel?.jcodeConfig?.config as {
      provider?: unknown;
      providers?: unknown;
    } | undefined;
    return JSON.stringify({
      provider: config?.provider ?? null,
      providers: config?.providers ?? null,
      accountsDefaultProvider: settingsAiModel?.jcodeAccounts?.defaultProvider ?? null,
      accountsDefaultModel: settingsAiModel?.jcodeAccounts?.defaultModel ?? null
    });
  }, [settingsAiModel?.jcodeAccounts, settingsAiModel?.jcodeConfig]);

  useEffect(() => {
    currentSessionIdRef.current = state.session?.id ?? null;
  }, [state.session?.id]);

  useEffect(() => {
    const nextSessionId = state.session?.id ?? null;
    if (previousSessionIdRef.current !== nextSessionId) {
      setPendingClarifications([]);
      setPendingPermissions([]);
      previousSessionIdRef.current = nextSessionId;
    }
  }, [state.session?.id]);

  useEffect(() => {
    if (desktopApi?.agent === undefined) {
      dispatch({ type: "error", message: t("runtime.desktopBridgeUnavailable") });
      return;
    }
    let disposed = false;
    dispatch({ type: "loading" });
    const agentApi = desktopApi.agent;
    const requestedSessionId = activeSessionId ?? lastAgentSessionId;
    currentSessionIdRef.current = requestedSessionId;
    const unsubscribe = agentApi.onEvent((event) => {
      const eventSessionId = runtimeEventSessionId(event);
      if (eventSessionId !== null && currentSessionIdRef.current !== eventSessionId) {
        return;
      }
      if (event.kind === "clarificationRequired") {
        setPendingClarifications((items) =>
          upsertById(items, {
            id: event.clarificationId,
            question: event.question,
            options: normalizeClarificationOptions(event.options ?? []),
            allowCustomAnswer: event.allowCustomAnswer,
            detail: event.detail ?? null
          })
        );
      } else if (event.kind === "permissionRequired") {
        setPendingPermissions((items) =>
          upsertById(items, {
            id: event.permissionId,
            type: classifyPermissionRequest(event.title, event.detail),
            title: event.title,
            detail: event.detail
          })
        );
      } else if (event.kind === "turnFinished" || event.kind === "turnFailed") {
        setPendingClarifications([]);
        setPendingPermissions([]);
      }
      dispatch({ type: "event", event });
      if (event.kind === "turnFinished" || event.kind === "turnFailed") {
        void agentApi.readSession({ sessionId: event.sessionId })
          .then((snapshot) => {
            if (disposed || currentSessionIdRef.current !== snapshot.id) return;
            dispatch({ type: "snapshot", snapshot });
          })
          .catch(() => undefined);
      }
    });

    const initialSession = requestedSessionId === null
      ? agentApi.createSession({ title: "Lyra Agent" })
      : agentApi.readSession({ sessionId: requestedSessionId });

    void initialSession
      .then((snapshot) => {
        if (disposed) return;
        currentSessionIdRef.current = snapshot.id;
        dispatch({ type: "snapshot", snapshot });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        dispatch({ type: "error", message: toErrorMessage(error) });
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [activeSessionId, desktopApi, locale]);

  useEffect(() => {
    if (desktopApi?.agent === undefined) {
      setBrowserFollowModeEnabled(false);
      return;
    }
    let disposed = false;
    void desktopApi.agent.readBrowserFollowMode()
      .then((snapshot) => {
        if (!disposed) setBrowserFollowModeEnabled(snapshot.enabled);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [desktopApi]);

  useEffect(() => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    let disposed = false;
    void desktopApi.agent.listJcodeModels({ sessionId: state.session.id })
      .then((response) => {
        if (!disposed) setModelState(response);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [desktopApi, modelConfigSignature, state.session?.id]);

  useEffect(() => {
    if (
      desktopApi?.agent === undefined ||
      state.session === null ||
      state.session.turnStatus !== "running"
    ) {
      return;
    }
    const agentApi = desktopApi.agent;
    let disposed = false;
    const sessionId = state.session.id;
    const refresh = (): void => {
      void agentApi.readSession({ sessionId })
        .then((snapshot) => {
          if (disposed || snapshot.id !== sessionId) return;
          dispatch({ type: "snapshot", snapshot });
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(refresh, RUNNING_SESSION_REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [desktopApi, state.session?.id, state.session?.turnStatus]);

  useEffect(() => {
    if (state.session === null) return;
    onActiveSessionChange?.(state.session.id);
  }, [onActiveSessionChange, state.session?.id]);

  const sendMessage = useCallback(async (
    text: string,
    images: readonly AgentImageAttachment[] = []
  ): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const trimmed = text.trim();
    if (trimmed.length === 0 && images.length === 0) return;
    await desktopApi.agent.sendTurn({
      sessionId: state.session?.id ?? lastAgentSessionId,
      text: trimmed,
      ...(images.length === 0
        ? {}
        : {
            images: images.map((image) => ({
              mediaType: image.mediaType,
              data: image.data,
              label: image.label ?? null,
              source: image.source ?? null,
              width: image.width ?? null,
              height: image.height ?? null
            }))
          })
    });
  }, [desktopApi, state.session?.id]);

  const captureBrowserScreenshot = useCallback(async (): Promise<AgentImageAttachment | null> => {
    if (desktopApi === null) return null;
    const capture = await desktopApi.workbenchBrowser.capturePage();
    return {
      id: "browser-screenshot-" + Date.now().toString(36),
      mediaType: capture.mimeType,
      data: capture.imageBase64,
      label: t("msg.browserScreenshot"),
      source: "browser-screenshot",
      width: capture.width,
      height: capture.height
    };
  }, [desktopApi, locale]);

  const captureWindowScreenshot = useCallback(async (): Promise<AgentImageAttachment | null> => {
    if (desktopApi === null) return null;
    const capture = await desktopApi.workbenchBrowser.captureWindow();
    return {
      id: "window-screenshot-" + Date.now().toString(36),
      mediaType: capture.mimeType,
      data: capture.imageBase64,
      label: t("msg.windowScreenshot"),
      source: "window-screenshot",
      width: capture.width,
      height: capture.height
    };
  }, [desktopApi, locale]);

  const cancel = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const sessionId = state.session?.id ?? lastAgentSessionId;
    if (sessionId === null) return;
    await desktopApi.agent.cancelTurn({ sessionId });
  }, [desktopApi, state.session?.id]);

  const setBrowserFollowMode = useCallback(async (enabled: boolean): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const snapshot = await desktopApi.agent.updateBrowserFollowMode({ enabled });
    setBrowserFollowModeEnabled(snapshot.enabled);
  }, [desktopApi]);

  const previewRollback = useCallback(async (messageId: string) => {
    if (desktopApi?.agent === undefined || state.session === null) {
      return {
        sessionId: "",
        messageId,
        available: false,
        removedMessageCount: 0,
        changedFiles: [],
        unavailableReason: "No active agent session."
      };
    }
    return desktopApi.agent.previewRollback({
      sessionId: state.session.id,
      messageId
    });
  }, [desktopApi, state.session]);

  const rollbackMessage = useCallback(async (messageId: string): Promise<void> => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    const response = await desktopApi.agent.restoreRollback({
      sessionId: state.session.id,
      messageId,
      mode: "taskAndWorkspace"
    });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [desktopApi, state.session]);

  const createSession = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    dispatch({ type: "loading" });
    setModelState(null);
    try {
      const request =
        state.session?.projectBound === true && typeof state.session.workingDir === "string"
          ? { title: "Lyra Agent", workingDir: state.session.workingDir }
          : { title: "Lyra Agent" };
      const snapshot = await desktopApi.agent.createSession(request);
      dispatch({ type: "snapshot", snapshot });
    } catch (error: unknown) {
      dispatch({ type: "error", message: toErrorMessage(error) });
    }
  }, [desktopApi, state.session?.projectBound, state.session?.workingDir]);

  const bindProject = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined || onRequestProjectBind === undefined) return;
    const currentPath =
      state.session?.projectBound === true && typeof state.session.workingDir === "string"
        ? state.session.workingDir
        : undefined;
    const selectedPath = await onRequestProjectBind(currentPath);
    if (selectedPath === null) return;
    const snapshot = await desktopApi.agent.bindProject({
      sessionId: state.session?.id ?? lastAgentSessionId,
      workingDir: selectedPath
    });
    dispatch({ type: "snapshot", snapshot });
  }, [
    desktopApi,
    onRequestProjectBind,
    state.session?.id,
    state.session?.projectBound,
    state.session?.workingDir
  ]);

  const openProjectTree = useCallback(async (): Promise<void> => {
    if (
      state.session?.projectBound !== true ||
      typeof state.session.workingDir !== "string" ||
      state.session.workingDir.trim().length === 0
    ) {
      return;
    }
    await onOpenProjectTree?.({
      sessionId: state.session.id,
      workingDir: state.session.workingDir
    });
  }, [
    onOpenProjectTree,
    state.session?.id,
    state.session?.projectBound,
    state.session?.workingDir
  ]);

  const openSelfDevLab = useCallback(async (): Promise<void> => {
    await onOpenSelfDevLab?.({
      parentSessionId: state.session?.id ?? lastAgentSessionId
    });
  }, [onOpenSelfDevLab, state.session?.id]);

  const openOvernightLab = useCallback(async (): Promise<void> => {
    await onOpenOvernightLab?.({
      parentSessionId: state.session?.id ?? lastAgentSessionId
    });
  }, [onOpenOvernightLab, state.session?.id]);

  const submitDecisions = useCallback(async (answers: Record<string, string>) => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    const entries = Object.entries(answers)
      .map(([id, answer]) => [id, answer.trim()] as const)
      .filter(([, answer]) => answer.length > 0);
    for (const [id, answer] of entries) {
      const question = pendingClarifications.find((item) => item.id === id);
      if (question === undefined) continue;
      const selectedOption =
        question.options.find((option) => option.label === answer)?.label ?? null;
      await desktopApi.agent.respondClarification({
        sessionId: state.session.id,
        clarificationId: id,
        answer,
        selectedOption
      });
      setPendingClarifications((items) => items.filter((item) => item.id !== id));
    }
  }, [desktopApi, pendingClarifications, state.session]);

  const approvePermission = useCallback(async (id: string) => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    await desktopApi.agent.respondPermission({
      sessionId: state.session.id,
      permissionId: id,
      allowed: true
    });
    setPendingPermissions((items) => items.filter((item) => item.id !== id));
  }, [desktopApi, state.session]);

  const denyPermission = useCallback(async (id: string) => {
    if (desktopApi?.agent === undefined || state.session === null) return;
    await desktopApi.agent.respondPermission({
      sessionId: state.session.id,
      permissionId: id,
      allowed: false
    });
    setPendingPermissions((items) => items.filter((item) => item.id !== id));
  }, [desktopApi, state.session]);

  const currentSessionId = state.session?.id ?? lastAgentSessionId;

  const switchModel = useCallback(async (modelId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const trimmed = modelId.trim();
    if (trimmed.length === 0) return;
    setModelBusy("switch");
    try {
      setModelState(await desktopApi.agent.switchJcodeModel({
        sessionId: currentSessionId,
        model: trimmed
      }));
    } finally {
      setModelBusy(null);
    }
  }, [currentSessionId, desktopApi]);

  const refreshModels = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    setModelBusy("refresh");
    try {
      setModelState(await desktopApi.agent.refreshJcodeModels({ sessionId: currentSessionId }));
    } finally {
      setModelBusy(null);
    }
  }, [currentSessionId, desktopApi]);

  const openModelSettings = useCallback(async (): Promise<void> => {
    await onOpenModelSettings?.();
  }, [onOpenModelSettings]);

  const openUrlInWorkbench = useCallback(async (url: string, title?: string): Promise<void> => {
    const trimmedUrl = url.trim();
    if (trimmedUrl.length === 0) return;
    await onOpenUrlInWorkbench?.({
      url: trimmedUrl,
      ...(title === undefined ? {} : { title })
    });
  }, [onOpenUrlInWorkbench]);

  const openFileInWorkbench = useCallback(async (filePath: string): Promise<void> => {
    let cleanedPath = filePath.trim();
    if (cleanedPath.length === 0) return;

    // 1. Remove file:/// prefix if present
    if (cleanedPath.startsWith("file:///")) {
      cleanedPath = "/" + cleanedPath.slice(8); // Keep the starting slash for absolute path
    } else if (cleanedPath.startsWith("file://")) {
      cleanedPath = "/" + cleanedPath.slice(7);
    }

    let line: number | undefined;
    let endLine: number | undefined;

    // 2. Parse #L123-L145
    const hashMatch = cleanedPath.match(/#L(\d+)(?:-L(\d+))?$/);
    if (hashMatch) {
      line = parseInt(hashMatch[1]!, 10);
      if (hashMatch[2]) {
        endLine = parseInt(hashMatch[2]!, 10);
      }
      cleanedPath = cleanedPath.replace(/#L\d+(?:-L\d+)?$/, "");
    }

    // 3. Parse :123 or :123:45
    const colonMatch = cleanedPath.match(/:(\d+)(?::(\d+))?$/);
    if (colonMatch) {
      line = parseInt(colonMatch[1]!, 10);
      cleanedPath = cleanedPath.replace(/:\d+(?::\d+)?$/, "");
    }

    if (onOpenFile) {
      cleanedPath = resolveSessionRelativePath(cleanedPath, state.session?.workingDir);
      const location = line === undefined
        ? undefined
        : (endLine === undefined ? { line } : { line, endLine });
      onOpenFile(cleanedPath, location);
    }
  }, [onOpenFile, state.session?.workingDir]);

  const canOpenImageInWorkbench = useCallback((image: AgentImageAttachment): boolean => {
    if (isOpenableImageSource(image.source)) {
      return onOpenFile !== undefined;
    }
    if (imageUrlSource(image.source) !== null) {
      return onOpenUrlInWorkbench !== undefined;
    }
    return (
      onOpenFile !== undefined &&
      desktopApi?.agent?.materializeImageAttachment !== undefined &&
      hasMaterializableImageData(image)
    );
  }, [desktopApi, onOpenFile, onOpenUrlInWorkbench]);

  const openImageInWorkbench = useCallback(async (image: AgentImageAttachment): Promise<void> => {
    if (isOpenableImageSource(image.source)) {
      await openFileInWorkbench(image.source);
      return;
    }

    const sourceUrl = imageUrlSource(image.source);
    if (sourceUrl !== null) {
      await openUrlInWorkbench(sourceUrl, image.label ?? undefined);
      return;
    }

    if (!hasMaterializableImageData(image)) {
      return;
    }

    const cacheKey = `${image.id}:${image.mediaType}:${image.data.length}:${image.label ?? ""}`;
    const cachedPath = materializedImagePathsRef.current.get(cacheKey);
    if (cachedPath !== undefined) {
      await openFileInWorkbench(cachedPath);
      return;
    }

    const materializeImageAttachment = desktopApi?.agent?.materializeImageAttachment;
    if (materializeImageAttachment === undefined) {
      return;
    }

    const result = await materializeImageAttachment({
      id: image.id,
      mediaType: image.mediaType,
      data: image.data,
      label: image.label ?? null
    });
    materializedImagePathsRef.current.set(cacheKey, result.path);
    await openFileInWorkbench(result.path);
  }, [desktopApi, openFileInWorkbench, openUrlInWorkbench]);

  const updateReasoningEffort = useCallback(async (value: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    setModelBusy("switch");
    try {
      setModelState(await desktopApi.agent.updateJcodeProviderOptions({
        sessionId: currentSessionId,
        reasoningEffort: value
      }));
    } finally {
      setModelBusy(null);
    }
  }, [currentSessionId, desktopApi]);

  const updateServiceTier = useCallback(async (value: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    setModelBusy("switch");
    try {
      setModelState(await desktopApi.agent.updateJcodeProviderOptions({
        sessionId: currentSessionId,
        serviceTier: value
      }));
    } finally {
      setModelBusy(null);
    }
  }, [currentSessionId, desktopApi]);

  const runImprove = useCallback(async (options?: {
    planOnly?: boolean;
    focus?: string | null;
  }): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.runImprove({
      sessionId: currentSessionId,
      planOnly: options?.planOnly ?? false,
      focus: options?.focus ?? null
    });
  }, [currentSessionId, desktopApi]);

  const runRefactor = useCallback(async (options?: {
    planOnly?: boolean;
    focus?: string | null;
  }): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.runRefactor({
      sessionId: currentSessionId,
      planOnly: options?.planOnly ?? false,
      focus: options?.focus ?? null
    });
  }, [currentSessionId, desktopApi]);

  const pokeTodos = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.triggerPoke({ sessionId: currentSessionId });
  }, [currentSessionId, desktopApi]);

  const runReview = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.runReview({ sessionId: currentSessionId });
    const snapshot = await desktopApi.agent.readSession({ sessionId: response.sessionId });
    dispatch({ type: "snapshot", snapshot });
  }, [currentSessionId, desktopApi]);

  const runJudge = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.runJudge({ sessionId: currentSessionId });
    const snapshot = await desktopApi.agent.readSession({ sessionId: response.sessionId });
    dispatch({ type: "snapshot", snapshot });
  }, [currentSessionId, desktopApi]);

  const runSubagent = useCallback(async (options: {
    prompt: string;
    subagentType?: string | null;
    model?: string | null;
    continueSessionId?: string | null;
  }): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.runSubagent({
      sessionId: currentSessionId,
      prompt: options.prompt,
      subagentType: options.subagentType ?? null,
      model: options.model ?? null,
      continueSessionId: options.continueSessionId ?? null
    });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [currentSessionId, desktopApi]);

  const askSideQuestion = useCallback(async (question: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.runBtw({ sessionId: currentSessionId, question });
  }, [currentSessionId, desktopApi]);

  const splitSession = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.splitSession({ sessionId: currentSessionId });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [currentSessionId, desktopApi]);

  const transferSession = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.transferSession({ sessionId: currentSessionId });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [currentSessionId, desktopApi]);

  const compactContext = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.compactSession({ sessionId: currentSessionId });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [currentSessionId, desktopApi]);

  const openGoals = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.openGoals({ sessionId: currentSessionId });
    if (currentSessionId !== null) {
      const snapshot = await desktopApi.agent.readSession({ sessionId: currentSessionId });
      dispatch({ type: "snapshot", snapshot });
    }
  }, [currentSessionId, desktopApi]);

  const listGoals = useCallback(async (): Promise<readonly AgentGoalItem[]> => {
    if (desktopApi?.agent === undefined) return [];
    const response = await desktopApi.agent.listGoals({ sessionId: currentSessionId });
    return response.goals
      .map(normalizeGoalItem)
      .filter((goal): goal is AgentGoalItem => goal !== null);
  }, [currentSessionId, desktopApi]);

  const showGoal = useCallback(async (goalId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const trimmed = goalId.trim();
    if (trimmed.length === 0) return;
    await desktopApi.agent.showGoal({ sessionId: currentSessionId, goalId: trimmed });
    if (currentSessionId !== null) {
      const snapshot = await desktopApi.agent.readSession({ sessionId: currentSessionId });
      dispatch({ type: "snapshot", snapshot });
    }
  }, [currentSessionId, desktopApi]);

  const resumeGoal = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.resumeGoal({ sessionId: currentSessionId });
    if (currentSessionId !== null) {
      const snapshot = await desktopApi.agent.readSession({ sessionId: currentSessionId });
      dispatch({ type: "snapshot", snapshot });
    }
  }, [currentSessionId, desktopApi]);

  const updateAutomation = useCallback(async (settings: {
    subagentModel?: string | null;
    autoreviewEnabled?: boolean | null;
    autojudgeEnabled?: boolean | null;
  }): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const response = await desktopApi.agent.updateSessionAutomation({
      sessionId: currentSessionId,
      ...settings
    });
    dispatch({ type: "snapshot", snapshot: response.snapshot });
  }, [currentSessionId, desktopApi]);

  const data = useMemo(() => {
    const modelControls: ComposerModelControls | null = modelState === null ? null : {
      currentModel: modelState.currentModel,
      currentProvider: modelState.currentProvider,
      models: jcodeModelsToModelOptions(modelState),
      reasoningEffort: {
        current: modelState.reasoningEffort.current ?? null,
        options: [...modelState.reasoningEffort.options],
        supported: modelState.reasoningEffort.supported
      },
      serviceTier: {
        current: modelState.serviceTier.current ?? null,
        options: [...modelState.serviceTier.options],
        supported: modelState.serviceTier.supported
      },
      isRefreshing: modelBusy === "refresh",
      isSwitching: modelBusy === "switch",
      switchModel,
      refreshModels,
      openModelSettings,
      updateReasoningEffort,
      updateServiceTier
    };
    const input: CreateDataProviderValueInput = {
      session: agentSessionToSessionMeta(state.session),
      messages: agentSessionToChatMessages(state.session, { failedTurnMessage: state.turnError }),
      todos: agentSessionToTodos(state.session),
      diffFiles: [] satisfies DiffFileEntry[],
      decisions: pendingClarifications.slice(0, 1),
      permissions: pendingPermissions,
      modelControls,
      openModelSettings,
      browserFollowModeEnabled,
      setBrowserFollowMode,
      openUrlInWorkbench,
      openFileInWorkbench,
      openImageInWorkbench,
      canOpenImageInWorkbench,
      sidePanel: agentSessionToSidePanel(state.session),
      sendMessage,
      captureBrowserScreenshot,
      captureWindowScreenshot,
      cancelTurn: cancel,
      previewRollback,
      rollbackMessage,
      createSession,
      bindProject,
      openProjectTree,
      openSelfDevLab,
      openOvernightLab,
      runImprove,
      runRefactor,
      pokeTodos,
      runReview,
      runJudge,
      runSubagent,
      askSideQuestion,
      splitSession,
      transferSession,
      compactContext,
      openGoals,
      listGoals,
      showGoal,
      resumeGoal,
      updateAutomation,
      submitDecisions,
      approvePermission,
      denyPermission,
      isMock: false,
      isTurnRunning: state.session?.follow.running ?? state.loading
    };
    return createDataProviderValue(input);
  }, [
    approvePermission,
    bindProject,
    cancel,
    captureBrowserScreenshot,
    captureWindowScreenshot,
    createSession,
    denyPermission,
    browserFollowModeEnabled,
    setBrowserFollowMode,
    openModelSettings,
    openUrlInWorkbench,
    openFileInWorkbench,
    openImageInWorkbench,
    canOpenImageInWorkbench,
    openProjectTree,
    openSelfDevLab,
    openOvernightLab,
    modelBusy,
    modelState,
    pendingClarifications,
    pendingPermissions,
    previewRollback,
    refreshModels,
    rollbackMessage,
    runImprove,
    runRefactor,
    runReview,
    runSubagent,
    sendMessage,
    state.session,
    state.loading,
    runJudge,
    askSideQuestion,
    compactContext,
    openGoals,
    listGoals,
    showGoal,
    resumeGoal,
    splitSession,
    transferSession,
    updateAutomation,
    pokeTodos,
    submitDecisions,
    switchModel,
    updateReasoningEffort,
    updateServiceTier,
    onOpenFile,
    locale
  ]);

  return {
    data,
    followRunning: state.session?.follow.running ?? state.loading,
    followActivity: state.session?.follow.activity ?? (state.loading ? t("runtime.connecting") : null),
    error: state.error,
    cancel
  };
};
