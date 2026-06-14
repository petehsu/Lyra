import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type {
  AgentModelCatalogSnapshot,
  AgentPermissionPolicySnapshot,
  AgentRuntimeEvent,
  AgentSessionCreateRequest,
  AgentSessionSnapshot
} from "../../../shared/agent";
import type {
  LyraDesktopApi,
  LyraSensitiveValueRef
} from "../../../shared/desktop-bridge";
import type { SettingsAiModel } from "../settings-ai";
import type { GlobalDialogModel } from "../global-dialog";
import { APP_CONFIG } from "./lyra-agents/core/config";
import type {
  AgentGoalItem,
  AgentImageAttachment,
  ComposerModelControls,
  DecisionOption,
  DecisionQuestion,
  DiffFileEntry,
  PermissionRequest
} from "./lyra-agents/core/types";
import { setLocale, t, type Locale } from "./lyra-agents/core/i18n";
import {
  createDataProviderValue,
  type CreateDataProviderValueInput
} from "./lyra-agents/data/createDataProviderValue";
import {
  agentSessionToChatMessages,
  agentSessionToSidePanel,
  agentSessionToSessionMeta,
  agentSessionToTodos,
  applyAgentRuntimeEventToSnapshot,
  agentModelsToModelOptions
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

const inferHomePathFromWorkingDir = (workingDir: string | null | undefined): string | null => {
  const normalized = (workingDir ?? "").trim().replaceAll("\\", "/");
  const match = normalized.match(/^\/(?:Users|home)\/[^/]+(?=\/|$)/u);
  return match?.[0] ?? null;
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
  | { readonly type: "empty" }
  | { readonly type: "snapshot"; readonly snapshot: AgentSessionSnapshot }
  | { readonly type: "event"; readonly event: AgentRuntimeEvent }
  | { readonly type: "error"; readonly message: string };

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
  if (action.type === "empty") {
    return {
      session: null,
      error: null,
      turnError: null,
      loading: false
    };
  }
  if (action.type === "snapshot") {
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

const isMissingSessionError = (error: unknown): boolean => {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("missing") ||
    message.includes("deleted") ||
    message.includes("no such file") ||
    message.includes("enoent")
  );
};

const runtimeEventSessionId = (event: AgentRuntimeEvent): string | null => {
  if ("sessionId" in event) return event.sessionId;
  if (event.kind === "sessionSnapshot") return event.snapshot.id;
  return null;
};

const sessionExistsInList = async (
  agentApi: NonNullable<LyraDesktopApi["agent"]>,
  sessionId: string
): Promise<boolean> => {
  const response = await agentApi.listSessions({});
  return response.sessions.some((session) => session.id === sessionId);
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

type LyraAgentDataProviderCallbacks = {
  readonly onActiveSessionChange?: ((sessionId: string) => void) | undefined;
  readonly onSessionSnapshotChange?: ((snapshot: AgentSessionSnapshot) => void) | undefined;
  readonly onCreateDraftSessionTab?: ((request: AgentSessionCreateRequest) => void) | undefined;
  readonly onCreateSessionTab?: ((
    request: AgentSessionCreateRequest
  ) => Promise<AgentSessionSnapshot> | AgentSessionSnapshot) | undefined;
  readonly onMissingSession?: ((sessionId: string) => void) | undefined;
  readonly onRequestProjectBind?: ((currentPath?: string) => Promise<string | null>) | undefined;
  readonly onOpenProjectTree?: ((request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void) | undefined;
  readonly onOpenSelfDevLab?: ((request: {
    readonly parentSessionId: string | null;
  }) => Promise<void> | void) | undefined;
  readonly onOpenOvernightLab?: ((request: {
    readonly parentSessionId: string | null;
  }) => Promise<void> | void) | undefined;
  readonly onOpenModelSettings?: (() => Promise<void> | void) | undefined;
  readonly onOpenUrlInWorkbench?: ((request: {
    readonly url: string;
    readonly title?: string;
  }) => Promise<void> | void) | undefined;
  readonly onOpenFile?: ((filePath: string, location?: FileRevealLocation) => void) | undefined;
  readonly onOpenTerminalLiveSession?: ((request: {
    readonly sessionId?: string | null;
    readonly terminalTabId?: string | null;
    readonly paneId?: string | null;
  }) => Promise<void> | void) | undefined;
  readonly openDialog?: GlobalDialogModel["openDialog"] | undefined;
  readonly locale?: Locale | undefined;
};

export const useLyraAgentDataProvider = (
  desktopApi: LyraDesktopApi | null,
  settingsAiModel?: SettingsAiModel,
  activeSessionId?: string | null,
  activeDraftWorkingDir?: string | null,
  deferInitialSessionCreation = false,
  callbacks: LyraAgentDataProviderCallbacks = {}
): {
  readonly data: ReturnType<typeof createDataProviderValue>;
  readonly followRunning: boolean;
  readonly followActivity: string | null;
  readonly error: string | null;
  readonly cancel: () => Promise<void>;
} => {
  const {
    onActiveSessionChange,
    onSessionSnapshotChange,
    onCreateDraftSessionTab,
    onCreateSessionTab,
    onMissingSession,
    onRequestProjectBind,
    onOpenProjectTree,
    onOpenSelfDevLab,
    onOpenOvernightLab,
    onOpenModelSettings,
    onOpenUrlInWorkbench,
    onOpenFile,
    onOpenTerminalLiveSession,
    openDialog,
    locale
  } = callbacks;
  if (locale !== undefined) {
    setLocale(locale);
  }

  const [state, dispatch] = useReducer(reducer, initialState);
  const [modelState, setModelState] = useState<AgentModelCatalogSnapshot | null>(null);
  const [modelBusy, setModelBusy] = useState<"refresh" | "switch" | null>(null);
  const [permissionPolicy, setPermissionPolicy] = useState<AgentPermissionPolicySnapshot | null>(null);
  const [permissionPolicyBusy, setPermissionPolicyBusy] = useState(false);
  const [browserFollowModeEnabled, setBrowserFollowModeEnabled] = useState(false);
  const [pendingClarifications, setPendingClarifications] = useState<DecisionQuestion[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [visibleMessageLimit, setVisibleMessageLimit] = useState<number>(
    APP_CONFIG.messageWindow.initialCount
  );
  const currentSessionIdRef = useRef<string | null>(activeSessionId ?? null);
  const previousSessionIdRef = useRef<string | null>(activeSessionId ?? null);
  const previousMessageWindowRef = useRef<{
    readonly sessionId: string | null;
    readonly messageCount: number;
  }>({
    sessionId: null,
    messageCount: 0
  });
  const materializedImagePathsRef = useRef<Map<string, string>>(new Map());
  const modelConfigSignature = useMemo(() => {
    const config = settingsAiModel?.agentConfig?.config as {
      provider?: unknown;
      providers?: unknown;
    } | undefined;
    return JSON.stringify({
      provider: config?.provider ?? null,
      providers: config?.providers ?? null,
      accountsDefaultProvider: settingsAiModel?.agentAccounts?.defaultProvider ?? null,
      accountsDefaultModel: settingsAiModel?.agentAccounts?.defaultModel ?? null
    });
  }, [settingsAiModel?.agentAccounts, settingsAiModel?.agentConfig]);

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
    const sessionId = state.session?.id ?? null;
    const messageCount = state.session?.messages.length ?? 0;
    const previous = previousMessageWindowRef.current;

    if (previous.sessionId !== sessionId || messageCount < previous.messageCount) {
      setVisibleMessageLimit(APP_CONFIG.messageWindow.initialCount);
    } else if (messageCount > previous.messageCount) {
      const appendedCount = messageCount - previous.messageCount;
      setVisibleMessageLimit((current) => Math.min(messageCount, current + appendedCount));
    }

    previousMessageWindowRef.current = {
      sessionId,
      messageCount
    };
  }, [state.session?.id, state.session?.messages.length]);

  useEffect(() => {
    if (desktopApi?.agent === undefined) {
      dispatch({ type: "error", message: t("runtime.desktopBridgeUnavailable") });
      return;
    }
    let disposed = false;
    const agentApi = desktopApi.agent;
    const requestedSessionId = activeSessionId ?? null;
    currentSessionIdRef.current = requestedSessionId;
    const unsubscribe = agentApi.onEvent((event) => {
      const eventSessionId = runtimeEventSessionId(event);
      if (eventSessionId !== null && currentSessionIdRef.current !== eventSessionId) {
        return;
      }
      if (event.kind === "clarificationRequested") {
        setPendingClarifications((items) =>
          upsertById(items, {
            id: event.clarificationId,
            question: event.question,
            options: normalizeClarificationOptions(event.options ?? []),
            allowCustomAnswer: event.allowCustomAnswer,
            detail: event.detail ?? null
          })
        );
      } else if (event.kind === "permissionRequested") {
        setPendingPermissions((items) =>
          upsertById(items, {
            id: event.permissionId,
            type: classifyPermissionRequest(event.title, event.detail),
            title: event.title,
            detail: event.detail
          })
        );
      } else if (
        event.kind === "turnFinished" ||
        event.kind === "turnFailed" ||
        event.kind === "turnInterrupted"
      ) {
        setPendingClarifications([]);
        setPendingPermissions([]);
      }
      dispatch({ type: "event", event });
      if (
        event.kind === "turnFinished" ||
        event.kind === "turnFailed" ||
        event.kind === "turnInterrupted"
      ) {
        void agentApi.readSession({ sessionId: event.sessionId })
          .then((snapshot) => {
            if (disposed || currentSessionIdRef.current !== snapshot.id) return;
            dispatch({ type: "snapshot", snapshot });
          })
        .catch(() => undefined);
      }
    });

    if (requestedSessionId === null && deferInitialSessionCreation) {
      setModelState(null);
      dispatch({ type: "empty" });
      return () => {
        disposed = true;
        unsubscribe();
      };
    }

    dispatch({ type: "loading" });
    const initialSession = requestedSessionId === null
      ? agentApi.createSession({ title: "新会话" })
      : (async () => {
          const exists = await sessionExistsInList(agentApi, requestedSessionId);
          if (!exists) {
            throw new Error(`session not found: ${requestedSessionId}`);
          }
          return agentApi.readSession({ sessionId: requestedSessionId });
        })();

    void initialSession
      .then((snapshot) => {
        if (disposed) return;
        currentSessionIdRef.current = snapshot.id;
        dispatch({ type: "snapshot", snapshot });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        if (requestedSessionId !== null && isMissingSessionError(error)) {
          onMissingSession?.(requestedSessionId);
          dispatch({ type: "empty" });
          return;
        }
        dispatch({ type: "error", message: toErrorMessage(error) });
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [activeSessionId, deferInitialSessionCreation, desktopApi, locale, onMissingSession]);

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
    if (
      desktopApi?.agent === undefined
      || typeof desktopApi.agent.readPermissionPolicy !== "function"
    ) {
      setPermissionPolicy(null);
      return;
    }
    let disposed = false;
    void desktopApi.agent.readPermissionPolicy()
      .then((snapshot) => {
        if (!disposed) setPermissionPolicy(snapshot);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [desktopApi]);

  useEffect(() => {
    if (desktopApi?.agent === undefined) return;
    const sessionId = state.session?.id ?? activeSessionId ?? null;
    const canLoadCatalog =
      sessionId !== null || (deferInitialSessionCreation && activeSessionId === null);
    if (!canLoadCatalog) return;
    let disposed = false;
    void desktopApi.agent.listAgentModels({ sessionId })
      .then((response) => {
        if (!disposed) setModelState(response);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [
    activeSessionId,
    deferInitialSessionCreation,
    desktopApi,
    modelConfigSignature,
    state.session?.id
  ]);

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
    onSessionSnapshotChange?.(state.session);
  }, [onActiveSessionChange, onSessionSnapshotChange, state.session]);

  const resolvedSessionId = state.session?.id ?? activeSessionId ?? null;

  const createSessionRequest = useCallback((): AgentSessionCreateRequest => {
    const draftWorkingDir = activeDraftWorkingDir?.trim() ?? "";
    const workingDir = draftWorkingDir.length > 0 ? draftWorkingDir : null;
    return workingDir === null
      ? { title: "新会话" }
      : { title: "新会话", workingDir };
  }, [activeDraftWorkingDir]);

  const ensureBackingSession = useCallback(async (): Promise<AgentSessionSnapshot | null> => {
    if (desktopApi?.agent === undefined) return null;
    if (state.session !== null) return state.session;
    const request = createSessionRequest();
    const snapshot = await (
      onCreateSessionTab === undefined
        ? desktopApi.agent.createSession(request)
        : onCreateSessionTab(request)
    );
    currentSessionIdRef.current = snapshot.id;
    dispatch({ type: "snapshot", snapshot });
    return snapshot;
  }, [createSessionRequest, desktopApi, onCreateSessionTab, state.session]);

  const sendMessage = useCallback(async (
    text: string,
    images: readonly AgentImageAttachment[] = []
  ): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const trimmed = text.trim();
    if (trimmed.length === 0 && images.length === 0) return;
    const session = await ensureBackingSession();
    if (session === null) return;
    await desktopApi.agent.sendTurn({
      sessionId: session.id,
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
  }, [desktopApi, ensureBackingSession]);

  const captureBrowserScreenshot = useCallback(async (): Promise<AgentImageAttachment | null> => {
    if (desktopApi === null) return null;
    const capture = await desktopApi.workbenchBrowser.capturePage();
    return {
      id: "browser-screenshot-" + Date.now().toString(36),
      mediaType: capture.mimeType,
      data: capture.imageBase64,
      label: t("lyra-agents-message.browserScreenshot"),
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
      label: t("lyra-agents-message.windowScreenshot"),
      source: "window-screenshot",
      width: capture.width,
      height: capture.height
    };
  }, [desktopApi, locale]);

  const cancel = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const sessionId = resolvedSessionId;
    if (sessionId === null) return;
    await desktopApi.agent.cancelTurn({ sessionId });
  }, [desktopApi, resolvedSessionId]);

  const setBrowserFollowMode = useCallback(async (enabled: boolean): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const snapshot = await desktopApi.agent.updateBrowserFollowMode({ enabled });
    setBrowserFollowModeEnabled(snapshot.enabled);
  }, [desktopApi]);

  const confirmFullAutoMode = useCallback(async (): Promise<boolean> => {
    const description = t("permissionPolicy.fullAutoWarningDescription");
    if (openDialog === undefined) {
      return window.confirm(description);
    }
    return new Promise<boolean>((resolve) => {
      openDialog({
        title: t("permissionPolicy.fullAutoWarningTitle"),
        description,
        source: {
          title: "Lyra Agent",
          subtitle: t("permissionPolicy.dialogSourceSubtitle"),
          iconLabel: "LA",
          iconTone: "danger"
        },
        actions: [
          {
            id: "cancel",
            label: t("permissionPolicy.cancel"),
            onSelect: () => resolve(false)
          },
          {
            id: "continue",
            label: t("permissionPolicy.continue"),
            tone: "danger",
            onSelect: () => resolve(true)
          }
        ]
      });
    });
  }, [locale, openDialog]);

  const requestAdminPassword = useCallback(async (): Promise<string | null> => {
    const description = t("permissionPolicy.adminCredentialDescription");
    if (openDialog === undefined) {
      const value = window.prompt(description);
      return value !== null && value.length > 0 ? value : null;
    }
    return new Promise<string | null>((resolve) => {
      openDialog({
        title: t("permissionPolicy.adminCredentialTitle"),
        description,
        source: {
          title: "Lyra Agent",
          subtitle: t("permissionPolicy.sensitiveValueSubtitle"),
          iconLabel: "KEY",
          iconTone: "accent"
        },
        input: {
          id: "admin-password",
          label: t("permissionPolicy.adminPasswordLabel"),
          type: "password",
          submitActionId: "save"
        },
        actions: [
          {
            id: "cancel",
            label: t("permissionPolicy.cancel"),
            onSelect: () => resolve(null)
          },
          {
            id: "save",
            label: t("permissionPolicy.saveAndEnable"),
            tone: "danger",
            onSelect: ({ inputValue }) => {
              const password = inputValue ?? "";
              resolve(password.length > 0 ? password : null);
            }
          }
        ]
      });
    });
  }, [locale, openDialog]);

  const switchPermissionMode = useCallback(async (
    mode: "approval" | "full_auto"
  ): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const sensitiveValues = desktopApi.sensitiveValues;
    if (mode === "full_auto" && sensitiveValues === undefined) return;
    if (mode === "approval") {
      setPermissionPolicyBusy(true);
      try {
        setPermissionPolicy(await desktopApi.agent.setPermissionPolicyMode({ mode }));
      } finally {
        setPermissionPolicyBusy(false);
      }
      return;
    }

    const confirmed = await confirmFullAutoMode();
    if (!confirmed) return;
    const password = await requestAdminPassword();
    if (password === null) return;
    if (sensitiveValues === undefined) return;
    setPermissionPolicyBusy(true);
    try {
      const credential = await sensitiveValues.store({
        owner: "system",
        valueKind: "credential",
        label: t("permissionPolicy.adminCredentialLabel"),
        description: t("permissionPolicy.adminCredentialStorageDescription"),
        value: password,
        capabilities: ["list_metadata", "use"]
      });
      setPermissionPolicy(await desktopApi.agent.setPermissionPolicyMode({
        mode,
        elevationCredentialRef: credential.ref
      }));
    } finally {
      setPermissionPolicyBusy(false);
    }
  }, [confirmFullAutoMode, desktopApi, locale, requestAdminPassword]);

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
    const request = createSessionRequest();
    if (onCreateDraftSessionTab !== undefined) {
      onCreateDraftSessionTab(request);
      setModelState(null);
      dispatch({ type: "empty" });
      return;
    }
    dispatch({ type: "loading" });
    setModelState(null);
    try {
      const snapshot = await (
        onCreateSessionTab === undefined
          ? desktopApi.agent.createSession(request)
          : onCreateSessionTab(request)
      );
      dispatch({ type: "snapshot", snapshot });
    } catch (error: unknown) {
      dispatch({ type: "error", message: toErrorMessage(error) });
    }
  }, [
    createSessionRequest,
    desktopApi,
    onCreateDraftSessionTab,
    onCreateSessionTab
  ]);

  const bindProject = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined || onRequestProjectBind === undefined) return;
    const currentPath =
      state.session?.projectBound === true && typeof state.session.workingDir === "string"
        ? state.session.workingDir
        : undefined;
    const selectedPath = await onRequestProjectBind(currentPath);
    if (selectedPath === null) return;
    const session = await ensureBackingSession();
    if (session === null) return;
    const snapshot = await desktopApi.agent.bindProject({
      sessionId: session.id,
      workingDir: selectedPath
    });
    dispatch({ type: "snapshot", snapshot });
  }, [
    desktopApi,
    ensureBackingSession,
    onRequestProjectBind,
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
      parentSessionId: resolvedSessionId
    });
  }, [onOpenSelfDevLab, resolvedSessionId]);

  const openOvernightLab = useCallback(async (): Promise<void> => {
    await onOpenOvernightLab?.({
      parentSessionId: resolvedSessionId
    });
  }, [onOpenOvernightLab, resolvedSessionId]);

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

  const currentSessionId = resolvedSessionId;

  const switchModel = useCallback(async (modelId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const trimmed = modelId.trim();
    if (trimmed.length === 0) return;
    setModelBusy("switch");
    try {
      setModelState(await desktopApi.agent.switchAgentModel({
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
      setModelState(await desktopApi.agent.refreshAgentModels({ sessionId: currentSessionId }));
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
    if (cleanedPath.startsWith("~/")) {
      const homePath = inferHomePathFromWorkingDir(state.session?.workingDir);
      if (homePath !== null) {
        cleanedPath = `${homePath}${cleanedPath.slice(1)}`;
      }
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

  const openTerminalLiveSession = useCallback(async (request: {
    readonly sessionId?: string | null;
    readonly terminalTabId?: string | null;
    readonly paneId?: string | null;
  }): Promise<void> => {
    await onOpenTerminalLiveSession?.(request);
  }, [onOpenTerminalLiveSession]);

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

  const revealSensitiveValueToUser = useCallback(async (
    ref: LyraSensitiveValueRef
  ): Promise<string> => {
    if (desktopApi?.sensitiveValues !== undefined) {
      return (await desktopApi.sensitiveValues.revealToUser({
        ref,
        reason: "user-ai-panel"
      })).value;
    }
    if (
      ref.owner === "login-manager"
      && ref.ownerRef.kind === "login-manager-credential"
      && desktopApi?.loginManager !== undefined
    ) {
      return (await desktopApi.loginManager.revealCredential({
        credentialId: ref.ownerRef.credentialId,
        reason: "user-ai-panel"
      })).password;
    }
    throw new Error("Sensitive value bridge is unavailable.");
  }, [desktopApi]);

  const updateReasoningEffort = useCallback(async (value: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    setModelBusy("switch");
    try {
      setModelState(await desktopApi.agent.updateAgentProviderOptions({
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
      setModelState(await desktopApi.agent.updateAgentProviderOptions({
        sessionId: currentSessionId,
        serviceTier: value
      }));
    } finally {
      setModelBusy(null);
    }
  }, [currentSessionId, desktopApi]);

  const updateVerbosity = useCallback(async (value: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    setModelBusy("switch");
    try {
      setModelState(await desktopApi.agent.updateAgentProviderOptions({
        sessionId: currentSessionId,
        verbosity: value
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
    const response = await desktopApi.agent.runBtw({ sessionId: currentSessionId, question });
    const snapshot = await desktopApi.agent.readSession({ sessionId: response.sessionId });
    dispatch({ type: "snapshot", snapshot });
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

  const messageWindowSessionId = state.session?.id ?? null;
  const visibleMessageLimitForSession =
    previousMessageWindowRef.current.sessionId === messageWindowSessionId
      ? visibleMessageLimit
      : APP_CONFIG.messageWindow.initialCount;

  const loadEarlierMessages = useCallback(async (): Promise<void> => {
    const messageCount = state.session?.messages.length ?? 0;
    const sessionId = state.session?.id ?? null;
    const baseLimit = visibleMessageLimitForSession;
    setVisibleMessageLimit((current) =>
      Math.min(
        messageCount,
        (previousMessageWindowRef.current.sessionId === sessionId ? current : baseLimit)
          + APP_CONFIG.messageWindow.batchCount
      )
    );
  }, [state.session?.id, state.session?.messages.length, visibleMessageLimitForSession]);

  const data = useMemo(() => {
    const totalMessageCount = state.session?.messages.length ?? 0;
    const visibleMessageCount = Math.min(totalMessageCount, visibleMessageLimitForSession);
    const modelControls: ComposerModelControls | null = modelState === null ? null : {
      currentModel: modelState.currentModel,
      currentProvider: modelState.currentProvider,
      models: agentModelsToModelOptions(modelState),
      reasoningEffort: {
        current: modelState.reasoningEffort.current ?? null,
        options: [...modelState.reasoningEffort.options],
        supported: modelState.reasoningEffort.supported
      },
      verbosity: {
        current: modelState.verbosity.current ?? null,
        options: [...modelState.verbosity.options],
        supported: modelState.verbosity.supported
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
      updateVerbosity,
      updateServiceTier
    };
    const permissionModeControls = desktopApi?.agent === undefined ? null : {
      currentMode: permissionPolicy?.mode ?? "approval",
      isSwitching: permissionPolicyBusy,
      warning: permissionPolicy?.warning ?? null,
      configPath: permissionPolicy?.configPath ?? null,
      switchMode: switchPermissionMode
    };
    const input: CreateDataProviderValueInput = {
      session: agentSessionToSessionMeta(state.session),
      messages: agentSessionToChatMessages(state.session, {
        failedTurnMessage: state.turnError,
        messageLimitFromEnd: visibleMessageLimitForSession
      }),
      messageWindow: {
        visibleCount: visibleMessageCount,
        hiddenBefore: Math.max(0, totalMessageCount - visibleMessageCount),
        totalCount: totalMessageCount,
        canLoadEarlier: visibleMessageCount < totalMessageCount
      },
      todos: agentSessionToTodos(state.session),
      diffFiles: [] satisfies DiffFileEntry[],
      decisions: pendingClarifications.slice(0, 1),
      permissions: pendingPermissions,
      modelControls,
      permissionModeControls,
      openModelSettings,
      browserFollowModeEnabled,
      setBrowserFollowMode,
      openUrlInWorkbench,
      openFileInWorkbench,
      openTerminalLiveSession,
      openImageInWorkbench,
      canOpenImageInWorkbench,
      revealSensitiveValueToUser,
      sidePanel: agentSessionToSidePanel(state.session),
      sendMessage,
      loadEarlierMessages,
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
    desktopApi,
    denyPermission,
    browserFollowModeEnabled,
    setBrowserFollowMode,
    openModelSettings,
    openUrlInWorkbench,
    openFileInWorkbench,
    openTerminalLiveSession,
    openImageInWorkbench,
    canOpenImageInWorkbench,
    revealSensitiveValueToUser,
    openProjectTree,
    openSelfDevLab,
    openOvernightLab,
    loadEarlierMessages,
    modelBusy,
    modelState,
    permissionPolicy,
    permissionPolicyBusy,
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
    state.turnError,
    visibleMessageLimitForSession,
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
    switchPermissionMode,
    switchModel,
    updateReasoningEffort,
    updateVerbosity,
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
