import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MutableRefObject
} from "react";

import {
  AGENT_FOLLOW_ACTIVITY_CONNECTING,
  type AgentMode,
  type AgentModelCatalogSnapshot,
  type AgentFileCitation,
  type AgentPageCitation,
  type AgentPermissionPolicySnapshot,
  type AgentPlanReviewRespondAction,
  type AgentPlanSnapshot,
  type AgentProjectTodoSnapshot,
  type AgentRuntimeEvent,
  type AgentSessionCreateRequest,
  type AgentSessionSnapshot,
  type AgentTranscriptCitation
} from "../../../shared/agent";
import type {
  LyraDesktopApi,
  LyraSensitiveValueRef
} from "../../../shared/desktop-bridge";
import { isLyraSensitiveValueRef } from "../../../shared/sensitive-value";
import type { SettingsAiModel } from "../settings-ai";
import { setBrowserFollowModeEnabled as syncBrowserFollowModeCoordinator } from "../workspace-tabs/tab-activation-coordinator";
import type { GlobalDialogModel } from "../global-dialog";
import type { WorkbenchLocationControls } from "../location";
import { APP_CONFIG } from "./lyra-agents/core/config";
import type {
  AgentImageAttachment,
  ChatMessage,
  ComposerModelControls,
  ComposerPermissionModeControls,
  DecisionOption,
  DecisionQuestion,
  DiffFileEntry,
  OmaControls,
  PermissionRequest
} from "./lyra-agents/core/types";
import { t, useWorkbenchLocale, type I18nKey } from "@workbench/i18n";
import {
  createDataProviderValue,
  type CreateDataProviderValueInput
} from "./lyra-agents/data/createDataProviderValue";
import {
  agentSessionToChatMessages,
  mergeRunningSessionSnapshot,
  agentSessionToSessionMeta,
  agentSessionToTodos,
  applyAgentRuntimeEventToSnapshot,
  agentModelsToModelOptions,
  agentSessionMetaWithDraftWorkingDir,
  normalizeAgentSessionSnapshot
} from "../agent-session-view-model";
import type { CitationScrollTarget } from "./lyra-agents/data/DataProvider";
import {
  type ComposerInsertableCitation,
  segmentsToOmaMentions
} from "./lyra-agents/features/chat/message-citation";
import {
  buildFileAttachmentFromPath,
  type AgentFileAttachment
} from "./lyra-agents/features/chat/composer-file";
import {
  buildImageTurnPayloadEntry,
  hasMaterializableImageData,
  inlineImageMarkerIds,
  validateImageTurnCommit
} from "./lyra-agents/features/chat/composer-image";
import type { ComposerSegment } from "./lyra-agents/features/chat/message-citation";
import {
  isOpenableImageSource,
  readImageAttachmentFromPath
} from "./lyra-agents/features/chat/read-image-attachment";
import { isImageViewerSupportedPath } from "../image-viewer";
import type { TerminalDockTab } from "../terminal-dock/types";
import type { WorkspaceTab } from "../workspace-tabs/types";
import { navigateToPageCitation as navigateToPageCitationInWorkbench } from "./lyra-agents/features/chat/scroll-to-page-citation";
import { resolveAiPanelDragAttachAction } from "./lyra-agents/features/chat/ai-panel-drag-attach";
import { buildTerminalTabPageCitation } from "./lyra-agents/features/chat/terminal-tab-citation";
import { buildWorkspaceTabPageCitation } from "./lyra-agents/features/chat/workspace-tab-citation";
import type { ComposerCitationSink } from "../shell/use-browser-page-context-menu";

type FileRevealLocation = {
  readonly line: number;
  readonly endLine?: number;
};

type WorkbenchPathTarget = {
  readonly path: string;
  readonly location?: FileRevealLocation | undefined;
};

const isAbsoluteOrHomePath = (filePath: string): boolean =>
  /^(?:\/|~\/|[A-Za-z]:[\\/]|file:\/\/)/u.test(filePath);

const omaChannelIdFromMetadata = (metadata: unknown): string | null => {
  if (metadata === null || typeof metadata !== "object") return null;
  const oma = (metadata as { readonly oma?: unknown }).oma;
  if (oma === null || typeof oma !== "object") return null;
  const channelId = (oma as { readonly channelId?: unknown }).channelId;
  return typeof channelId === "string" ? channelId : null;
};

const resolveSessionRelativePath = (filePath: string, workingDir: string | null | undefined): string => {
  const trimmed = filePath.trim();
  const base = workingDir?.trim() ?? "";
  const hasAbsoluteBase = base.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(base);
  if (trimmed.length === 0 || isAbsoluteOrHomePath(trimmed) || !hasAbsoluteBase || base === "/") {
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
  return base.startsWith("/") ? `/${parts.join("/")}` : parts.join("/");
};

const inferHomePathFromWorkingDir = (workingDir: string | null | undefined): string | null => {
  const normalized = (workingDir ?? "").trim().replaceAll("\\", "/");
  const match = normalized.match(/^\/(?:Users|home)\/[^/]+(?=\/|$)/u);
  return match?.[0] ?? null;
};

const parseWorkbenchPathTarget = (
  filePath: string,
  workingDir: string | null | undefined
): WorkbenchPathTarget | null => {
  let cleanedPath = filePath.trim();
  if (cleanedPath.length === 0) {
    return null;
  }

  if (cleanedPath.startsWith("file:///")) {
    cleanedPath = `/${cleanedPath.slice(8)}`;
  } else if (cleanedPath.startsWith("file://")) {
    cleanedPath = `/${cleanedPath.slice(7)}`;
  }
  if (cleanedPath.startsWith("~/")) {
    const homePath = inferHomePathFromWorkingDir(workingDir);
    if (homePath !== null) {
      cleanedPath = `${homePath}${cleanedPath.slice(1)}`;
    }
  }

  let line: number | undefined;
  let endLine: number | undefined;

  const hashMatch = cleanedPath.match(/#L(\d+)(?:-L(\d+))?$/u);
  if (hashMatch !== null) {
    line = Number.parseInt(hashMatch[1]!, 10);
    if (hashMatch[2] !== undefined) {
      endLine = Number.parseInt(hashMatch[2], 10);
    }
    cleanedPath = cleanedPath.replace(/#L\d+(?:-L\d+)?$/u, "");
  }

  const colonMatch = cleanedPath.match(/:(\d+)(?::(\d+))?$/u);
  if (colonMatch !== null) {
    line = Number.parseInt(colonMatch[1]!, 10);
    cleanedPath = cleanedPath.replace(/:\d+(?::\d+)?$/u, "");
  }

  const path = resolveSessionRelativePath(cleanedPath, workingDir).trim();
  if (path.length === 0) {
    return null;
  }
  const location = line === undefined
    ? undefined
    : (endLine === undefined ? { line } : { line, endLine });
  return { path, location };
};

const normalizeProjectPathBoundary = (value: string): string =>
  value.trim().replace(/\\/g, "/").replace(/\/+$/u, "");

const isPathInsideProjectRoot = (filePath: string, rootPath: string): boolean => {
  const normalizedPath = normalizeProjectPathBoundary(filePath);
  const normalizedRoot = normalizeProjectPathBoundary(rootPath);
  if (normalizedPath.length === 0 || normalizedRoot.length === 0 || normalizedRoot === "/") {
    return false;
  }
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
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

type State = {
  readonly session: AgentSessionSnapshot | null;
  readonly error: string | null;
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
  loading: true
};

const applyEvent = (state: State, event: AgentRuntimeEvent): State => {
  if (event.kind === "sessionSnapshot") {
    if (state.session !== null && event.snapshot.id !== state.session.id) {
      return state;
    }
    const session = state.session === null
      ? normalizeAgentSessionSnapshot(event.snapshot)
      : mergeRunningSessionSnapshot(state.session, event.snapshot);
    return {
      ...state,
      session,
      loading: false,
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
      error: null
    };
  }

  return {
    ...state,
    session: applyAgentRuntimeEventToSnapshot(session, event)
  };
};

function normalizeClarificationOptions(
  options: readonly (
    | string
    | {
        readonly label: string;
        readonly description?: string | null;
        readonly i18nKey?: string | null;
        readonly descriptionI18nKey?: string | null;
      }
  )[]
): DecisionOption[] {
  const normalized: DecisionOption[] = [];
  for (const option of options) {
    const label = (typeof option === "string" ? option : option.label).trim();
    const description =
      typeof option === "string" ? null : normalizeOptionalText(option.description ?? null);
    if (label.length === 0 || isCustomOptionLabel(label)) continue;
    if (normalized.some((existing) => existing.label === label)) continue;
    const item: DecisionOption = { label, description };
    if (typeof option !== "string") {
      const displayLabel = translateI18nKey(option.i18nKey);
      const displayDescription = translateI18nKey(option.descriptionI18nKey);
      if (displayLabel !== undefined) item.displayLabel = displayLabel;
      if (displayDescription !== undefined) item.displayDescription = displayDescription;
    }
    normalized.push(item);
  }
  return normalized;
}

function translateI18nKey(key: string | null | undefined): string | undefined {
  const normalized = key?.trim();
  if (!normalized) return undefined;
  return t(normalized as I18nKey);
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
  if (action.type === "loading") {
    return { ...state, loading: true, error: null };
  }
  if (action.type === "empty") {
    return {
      session: null,
      error: null,
      loading: false
    };
  }
  if (action.type === "snapshot") {
    const session = state.session !== null && state.session.id === action.snapshot.id
      ? mergeRunningSessionSnapshot(state.session, action.snapshot)
      : normalizeAgentSessionSnapshot(action.snapshot);
    return {
      ...state,
      session,
      loading: false,
      error: null
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

type LyraAgentDataProviderCallbacks = {
  readonly onActiveSessionChange?: ((sessionId: string) => void) | undefined;
  readonly onSessionSnapshotChange?: ((snapshot: AgentSessionSnapshot) => void) | undefined;
  readonly onCreateDraftSessionTab?: ((request: AgentSessionCreateRequest) => void) | undefined;
  readonly onCreateSessionTab?: ((
    request: AgentSessionCreateRequest
  ) => Promise<AgentSessionSnapshot> | AgentSessionSnapshot) | undefined;
  readonly onMissingSession?: ((sessionId: string) => void) | undefined;
  readonly onRequestProjectBind?: ((currentPath?: string) => Promise<string | null>) | undefined;
  readonly onUpdateDraftWorkingDir?: ((workingDir: string) => void) | undefined;
  readonly onOpenProjectTree?: ((request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void) | undefined;
  readonly onOpenPlanBoard?: ((request: {
    readonly sessionId: string;
    readonly plan: AgentPlanSnapshot;
    readonly projectTodo?: AgentProjectTodoSnapshot | null;
  }) => Promise<void> | void) | undefined;
  readonly onOpenProjectPlanManager?: ((request: {
    readonly sessionId: string;
    readonly workingDir: string;
    readonly view?: "plan" | "todo" | "both";
  }) => Promise<void> | void) | undefined;
  readonly onRevealProjectPath?: ((request: {
    readonly sessionId: string;
    readonly workingDir: string;
    readonly path: string;
    readonly location?: FileRevealLocation;
    readonly mode: "reveal" | "open-file";
  }) => Promise<void> | void) | undefined;
  readonly onOpenModelSettings?: (() => Promise<void> | void) | undefined;
  readonly onOpenUrlInWorkbench?: ((request: {
    readonly url: string;
    readonly title?: string;
  }) => Promise<void> | void) | undefined;
  readonly onOpenFile?: ((filePath: string, location?: FileRevealLocation) => void) | undefined;
  readonly onRevealPathInWorkbench?: ((filePath: string) => Promise<void> | void) | undefined;
  readonly onOpenTerminalLiveSession?: ((request: {
    readonly sessionId?: string | null;
    readonly terminalTabId?: string | null;
    readonly paneId?: string | null;
  }) => Promise<void> | void) | undefined;
  readonly openDialog?: GlobalDialogModel["openDialog"] | undefined;
  readonly composerCitationSinkRef?: MutableRefObject<ComposerCitationSink | null> | undefined;
  readonly onSetActiveBrowserTab?: ((tabId: string) => void) | undefined;
  readonly resolveActiveWorkspaceTab?: (() => WorkspaceTab | undefined) | undefined;
  readonly onPickFileFromFileManager?: (() => Promise<string | null>) | undefined;
  readonly listWorkspaceTabs?: (() => readonly WorkspaceTab[]) | undefined;
  readonly listTerminalTabs?: (() => readonly TerminalDockTab[]) | undefined;
  readonly getTerminalTabPanes?: ((tabId: string) => readonly import("../terminal-dock/types").TerminalDockPane[]) | undefined;
  readonly onCloseTerminalTab?: ((tabId: string) => void) | undefined;
  readonly onFocusTerminalTabInDock?: ((tabId: string) => void) | undefined;
  readonly locationControls?: WorkbenchLocationControls | undefined;
  readonly aiRichRenderingEnabled?: boolean | undefined;
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
    onUpdateDraftWorkingDir,
    onOpenProjectTree,
    onOpenPlanBoard,
    onOpenProjectPlanManager,
    onRevealProjectPath,
    onOpenModelSettings,
    onOpenUrlInWorkbench,
    onOpenFile,
    onRevealPathInWorkbench,
    onOpenTerminalLiveSession,
    openDialog,
    composerCitationSinkRef,
    onSetActiveBrowserTab,
    resolveActiveWorkspaceTab,
    onPickFileFromFileManager,
    listWorkspaceTabs,
    listTerminalTabs,
    getTerminalTabPanes,
    onCloseTerminalTab,
    onFocusTerminalTabInDock,
    locationControls,
    aiRichRenderingEnabled = true
  } = callbacks;
  const locale = useWorkbenchLocale();

  const [state, dispatch] = useReducer(reducer, initialState);
  const [modelState, setModelState] = useState<AgentModelCatalogSnapshot | null>(null);
  const [modelBusy, setModelBusy] = useState<"refresh" | "switch" | null>(null);
  const [permissionPolicy, setPermissionPolicy] = useState<AgentPermissionPolicySnapshot | null>(null);
  const [permissionPolicyBusy, setPermissionPolicyBusy] = useState(false);
  const [browserFollowModeEnabled, setBrowserFollowModeEnabled] = useState(false);
  const [pendingClarifications, setPendingClarifications] = useState<DecisionQuestion[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [pendingPlanReview, setPendingPlanReview] = useState<(AgentPlanSnapshot & { sessionId: string }) | null>(null);
  // Render budget: number of most-recent messages to render as DOM.
  // Replaces the old virtual-scroll + height-estimation system.
  const [renderBudgetCount, setRenderBudgetCount] = useState<number>(
    APP_CONFIG.messageWindow.initialRenderCount
  );
  const [pendingCitation, setPendingCitation] = useState<ComposerInsertableCitation | null>(null);
  const [pendingCitationNonce, setPendingCitationNonce] = useState(0);
  const [pendingImages, setPendingImages] = useState<readonly AgentImageAttachment[]>([]);
  const [pendingImagesNonce, setPendingImagesNonce] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<readonly AgentFileAttachment[]>([]);
  const [pendingFilesNonce, setPendingFilesNonce] = useState(0);
  const [citationHighlightMessageId, setCitationHighlightMessageId] = useState<string | null>(null);
  const [citationScrollTarget, setCitationScrollTarget] = useState<CitationScrollTarget | null>(null);
  const citationHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSessionIdRef = useRef<string | null>(activeSessionId ?? null);
  const previousSessionIdRef = useRef<string | null>(activeSessionId ?? null);
  const materializedImagePathsRef = useRef<Map<string, string>>(new Map());
  // Session snapshot cache — eliminates IPC round-trip on tab switch.
  // ponytail: simple Map cache, cap 32 entries. Not a true LRU (no access-time
  // tracking), but sufficient: Map iteration order = insertion order, so the
  // oldest entry is evicted first. Upgrade path: track last-accessed timestamps
  // if cache hit rate degrades with many concurrent sessions.
  const sessionCacheRef = useRef<Map<string, AgentSessionSnapshot>>(new Map());
  // Deduplicates in-flight backing session creation between prewarm and sendMessage.
  const backingSessionPromiseRef = useRef<Promise<AgentSessionSnapshot> | null>(null);
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

  // Keep cache in sync — every session state change writes to cache.
  // During streaming this runs per-token but Map.set is O(1) and causes no re-render.
  useEffect(() => {
    if (state.session !== null) {
      const cache = sessionCacheRef.current;
      cache.set(state.session.id, state.session);
      if (cache.size > 32) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
  }, [state.session]);

  useEffect(() => {
    const nextSessionId = state.session?.id ?? null;
    if (previousSessionIdRef.current !== nextSessionId) {
      // Interactive requests (clarifications, permissions, plan reviews) survive
      // tab switches — they carry their own sessionId and the user may need to
      // answer them regardless of which tab is active.
      setRenderBudgetCount(APP_CONFIG.messageWindow.initialRenderCount);
      previousSessionIdRef.current = nextSessionId;
    }
  }, [state.session?.id]);

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
      // Interactive events (clarifications, permissions, plan reviews, and
      // turn-end events that clear them) must pass through regardless of which
      // tab is active — otherwise a request from a background session is
      // silently dropped and the agent waits until its clarification times out.
      const isCrossSessionEvent =
        event.kind === "clarificationRequested" ||
        event.kind === "permissionRequested" ||
        event.kind === "planReviewRequested" ||
        event.kind === "clarificationResolved" ||
        event.kind === "turnFinished" ||
        event.kind === "turnFailed" ||
        event.kind === "turnInterrupted";
      if (eventSessionId !== null && !isCrossSessionEvent && currentSessionIdRef.current !== eventSessionId) {
        return;
      }
      if (event.kind === "clarificationRequested") {
        const question: DecisionQuestion = {
          id: event.clarificationId,
          question: event.question,
          options: normalizeClarificationOptions(event.options ?? []),
          allowCustomAnswer: event.allowCustomAnswer,
          detail: event.detail ?? null,
          omaSource: event.omaSource ?? null,
          sessionId: event.sessionId
        };
        const displayQuestion = translateI18nKey(event.i18nKey);
        const displayDetail = translateI18nKey(event.detailI18nKey);
        if (displayQuestion !== undefined) question.displayQuestion = displayQuestion;
        if (displayDetail !== undefined) question.displayDetail = displayDetail;
        setPendingClarifications((items) =>
          upsertById(items, question)
        );
      } else if (event.kind === "permissionRequested") {
        setPendingPermissions((items) =>
          upsertById(items, {
            id: event.permissionId,
            type: classifyPermissionRequest(event.title, event.detail),
            title: event.title,
            detail: event.detail,
            omaSource: event.omaSource ?? null,
            sessionId: event.sessionId
          })
        );
      } else if (event.kind === "planReviewRequested") {
        setPendingPlanReview({
          ...event.plan,
          sessionId: event.sessionId,
          omaSource: event.omaSource ?? event.plan.omaSource ?? null
        });
      } else if (event.kind === "clarificationResolved") {
        setPendingClarifications((items) =>
          items.filter((item) => item.id !== event.clarificationId)
        );
      } else if (
        event.kind === "turnFinished" ||
        event.kind === "turnFailed" ||
        event.kind === "turnInterrupted"
      ) {
        // Only clear pending items belonging to the session whose turn ended;
        // other sessions may still have live interactive requests.
        setPendingClarifications((items) =>
          items.filter((item) => item.sessionId !== event.sessionId)
        );
        setPendingPermissions((items) =>
          items.filter((item) => item.sessionId !== event.sessionId)
        );
        setPendingPlanReview((current) =>
          current !== null && current.sessionId === event.sessionId ? null : current
        );
      }
      dispatch({ type: "event", event });
      if (
        (event.kind === "turnFinished" ||
          event.kind === "turnFailed" ||
          event.kind === "turnInterrupted") &&
        currentSessionIdRef.current === event.sessionId
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

    // If we have a cached snapshot, render immediately — no loading flash.
    const cachedSnapshot = requestedSessionId !== null
      ? sessionCacheRef.current.get(requestedSessionId)
      : undefined;
    if (cachedSnapshot !== undefined) {
      dispatch({ type: "snapshot", snapshot: cachedSnapshot });
    } else {
      dispatch({ type: "loading" });
    }

    // Fetch fresh snapshot in background (even from cache, to catch updates).
    // Removed listSessions existence check — readSession failure handles missing sessions.
    const initialSession = requestedSessionId === null
      ? agentApi.createSession({ title: t("aiPanel.defaultSessionTitle") })
      : agentApi.readSession({ sessionId: requestedSessionId });

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
      syncBrowserFollowModeCoordinator(false);
      return;
    }
    let disposed = false;
    void desktopApi.agent.readBrowserFollowMode()
      .then((snapshot) => {
        if (!disposed) {
          setBrowserFollowModeEnabled(snapshot.enabled);
          syncBrowserFollowModeCoordinator(snapshot.enabled);
        }
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
    const agent = desktopApi.agent;
    const sensitiveValues = desktopApi.sensitiveValues;
    let disposed = false;
    void agent.readPermissionPolicy()
      .then(async (snapshot) => {
        if (disposed) return;
        setPermissionPolicy(snapshot);

        // 启动时恢复：full_auto 模式且有 credential ref → 从 safeStorage 解密 → 注入 Rust
        const ref = snapshot.elevationCredentialRef;
        if (
          snapshot.effectiveMode === "full_auto"
          && ref !== undefined
          && ref !== null
          && sensitiveValues !== undefined
          && isLyraSensitiveValueRef(ref)
        ) {
          try {
            const { value } = await sensitiveValues.revealToUser({ ref });
            if (!disposed && value.length > 0) {
              await agent.setElevationSecret({ secret: value });
            }
          } catch {
            // safeStorage 解密失败（OS 密钥变更等）— 静默降级，下次 sudo 会报权限错误
          }
        }
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
    if (state.session === null) return;
    onActiveSessionChange?.(state.session.id);
  }, [onActiveSessionChange, state.session?.id]);

  // The tab strip only consumes session metadata. Streaming deltas replace the
  // session object many times per second; forwarding each replacement to the
  // shell made the entire workbench re-render for every token.
  useEffect(() => {
    if (state.session === null) return;
    onSessionSnapshotChange?.(state.session);
  }, [
    onSessionSnapshotChange,
    state.session?.id,
    state.session?.title,
    state.session?.turnStatus,
    state.session?.workingDir,
    state.session?.projectBound,
    state.session?.workingDirIsHome
  ]);

  const resolvedSessionId = state.session?.id ?? activeSessionId ?? null;

  const createSessionRequest = useCallback((agentMode: AgentMode = "solo"): AgentSessionCreateRequest => {
    const workingDir = activeDraftWorkingDir?.trim() ?? "";
    return workingDir.length > 0
      ? { title: t("aiPanel.defaultSessionTitle"), workingDir, agentMode }
      : { title: t("aiPanel.defaultSessionTitle"), agentMode };
  }, [activeDraftWorkingDir]);

  const ensureBackingSession = useCallback(async (): Promise<AgentSessionSnapshot | null> => {
    if (desktopApi?.agent === undefined) return null;
    if (state.session !== null) return state.session;
    // If prewarm is in flight, await the same promise instead of creating a duplicate.
    if (backingSessionPromiseRef.current !== null) {
      return backingSessionPromiseRef.current;
    }
    const request = createSessionRequest();
    const createPromise = Promise.resolve(
      onCreateSessionTab === undefined
        ? desktopApi.agent.createSession(request)
        : onCreateSessionTab(request)
    );
    const promise = createPromise.then((snapshot) => {
      currentSessionIdRef.current = snapshot.id;
      dispatch({ type: "snapshot", snapshot });
      return snapshot;
    });
    backingSessionPromiseRef.current = promise;
    promise.finally(() => { backingSessionPromiseRef.current = null; });
    return promise;
  }, [createSessionRequest, desktopApi, onCreateSessionTab, state.session]);

  // Prewarm backing session for draft tabs — creates the session in the
  // background so the first message doesn't wait for IPC round-trip.
  useEffect(() => {
    if (!deferInitialSessionCreation) return;
    if (activeSessionId !== null) return;
    if (state.session !== null) return;
    if (desktopApi?.agent === undefined) return;
    void ensureBackingSession();
  }, [deferInitialSessionCreation, activeSessionId, state.session?.id, desktopApi, ensureBackingSession]);

  const sendMessage = useCallback(async (
    text: string,
    images: readonly AgentImageAttachment[] = [],
    citations: readonly AgentTranscriptCitation[] = [],
    pageCitations: readonly AgentPageCitation[] = [],
    fileCitations: readonly AgentFileCitation[] = [],
    segments: readonly ComposerSegment[] = []
  ): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const trimmed = text.trim();
    if (
      trimmed.length === 0
      && images.length === 0
      && citations.length === 0
      && pageCitations.length === 0
      && fileCitations.length === 0
    ) {
      return;
    }
    const session = await ensureBackingSession();
    if (session === null) return;

    const commitError = validateImageTurnCommit(trimmed, images, segments);
    if (commitError !== null) {
      throw new Error(commitError);
    }

    const materializeImageAttachment = desktopApi.agent?.materializeImageAttachment;
    const preparedImages = images.length === 0
      ? []
      : await Promise.all(images.map(async (image) =>
          buildImageTurnPayloadEntry(image, materializeImageAttachment)
        ));

    if (inlineImageMarkerIds(trimmed).length > 0 && preparedImages.length === 0) {
      throw new Error(
        "Image markers are present but no image attachments could be committed. Remove and re-attach the image."
      );
    }

    await desktopApi.agent.sendTurn({
      sessionId: session.id,
      ...(session.agentMode === "oma" && session.oma !== null
        ? { channelId: session.oma.activeChannelId }
        : {}),
      text: trimmed,
      ...(preparedImages.length === 0 ? {} : { images: preparedImages }),
      ...(citations.length === 0 ? {} : { citations }),
      ...(pageCitations.length === 0 ? {} : { pageCitations }),
      ...(fileCitations.length === 0 ? {} : { fileCitations }),
      ...(session.agentMode === "oma" && session.oma?.activeChannelId === "group:default"
        ? (() => {
            const omaMentions = segmentsToOmaMentions(segments);
            return omaMentions.length === 0 ? {} : { omaMentions };
          })()
        : {})
    });
  }, [desktopApi, ensureBackingSession]);

  const applyOmaSnapshot = useCallback((snapshot: AgentSessionSnapshot): void => {
    currentSessionIdRef.current = snapshot.id;
    dispatch({ type: "snapshot", snapshot });
  }, []);

  const setAgentMode = useCallback(async (mode: AgentMode): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const session = await ensureBackingSession();
    if (session === null) return;
    applyOmaSnapshot(await desktopApi.agent.setAgentMode({ sessionId: session.id, mode }));
  }, [applyOmaSnapshot, desktopApi, ensureBackingSession]);

  const addOmaAgent = useCallback(async (agentId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const session = await ensureBackingSession();
    if (session === null) return;
    applyOmaSnapshot(await desktopApi.agent.addOmaAgent({ sessionId: session.id, agentId }));
  }, [applyOmaSnapshot, desktopApi, ensureBackingSession]);

  const removeOmaAgent = useCallback(async (agentId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const session = await ensureBackingSession();
    if (session === null) return;
    applyOmaSnapshot(await desktopApi.agent.removeOmaAgent({ sessionId: session.id, agentId }));
  }, [applyOmaSnapshot, desktopApi, ensureBackingSession]);

  const setOmaActiveChannel = useCallback(async (channelId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const session = await ensureBackingSession();
    if (session === null) return;
    applyOmaSnapshot(await desktopApi.agent.setOmaActiveChannel({ sessionId: session.id, channelId }));
  }, [applyOmaSnapshot, desktopApi, ensureBackingSession]);

  const addCitationToComposer = useCallback((citation: AgentTranscriptCitation): void => {
    setPendingCitation({ kind: "transcript", citation });
    setPendingCitationNonce((value) => value + 1);
  }, []);

  const addPageCitationToComposer = useCallback((citation: AgentPageCitation): void => {
    setPendingCitation({ kind: "page", citation });
    setPendingCitationNonce((value) => value + 1);
  }, []);

  const workspaceTabsForComposer = listWorkspaceTabs?.() ?? [];
  const terminalTabsForComposer = listTerminalTabs?.() ?? [];

  const attachDragPayloadToComposer = useCallback(async (dataTransfer: DataTransfer): Promise<boolean> => {
    const action = await resolveAiPanelDragAttachAction(
      dataTransfer,
      listWorkspaceTabs?.() ?? [],
      listTerminalTabs?.() ?? []
    );
    if (action === null) {
      return false;
    }
    if (action.kind === "workspace-tab") {
      addPageCitationToComposer(buildWorkspaceTabPageCitation(action.tab));
      return true;
    }
    if (action.kind === "page-citation") {
      addPageCitationToComposer(action.citation);
      return true;
    }
    if (action.kind === "terminal-tab") {
      addPageCitationToComposer(buildTerminalTabPageCitation(action.tab, workspaceTabsForComposer));
      return true;
    }
    if (action.kind === "file") {
      setPendingFiles([action.file]);
      setPendingFilesNonce((value) => value + 1);
      return true;
    }
    if (action.kind === "files") {
      setPendingFiles(action.files);
      setPendingFilesNonce((value) => value + 1);
      return true;
    }
    setPendingImages(action.images);
    setPendingImagesNonce((value) => value + 1);
    return true;
  }, [addPageCitationToComposer, listTerminalTabs, listWorkspaceTabs]);

  const navigateToPageCitation = useCallback(async (citation: AgentPageCitation): Promise<void> => {
    const navigationOptions = onOpenTerminalLiveSession === undefined
      ? {}
      : {
          onOpenTerminalLiveSession: (request: {
            readonly terminalTabId?: string | null;
          }) => onOpenTerminalLiveSession(request)
        };
    await navigateToPageCitationInWorkbench(
      desktopApi,
      onSetActiveBrowserTab ?? (() => undefined),
      citation,
      {
        ...navigationOptions,
        onOpenExternalPageUrl: async (url, title) => {
          const trimmedUrl = url.trim();
          if (trimmedUrl.length === 0) {
            return;
          }
          await onOpenUrlInWorkbench?.({
            url: trimmedUrl,
            ...(title === undefined ? {} : { title })
          });
        }
      }
    );
  }, [desktopApi, onOpenTerminalLiveSession, onOpenUrlInWorkbench, onSetActiveBrowserTab]);

  useEffect(() => {
    if (composerCitationSinkRef === undefined) return;
    composerCitationSinkRef.current = { addPageCitation: addPageCitationToComposer };
    return () => {
      if (composerCitationSinkRef.current?.addPageCitation === addPageCitationToComposer) {
        composerCitationSinkRef.current = null;
      }
    };
  }, [addPageCitationToComposer, composerCitationSinkRef]);

  const ensureMessageVisible = useCallback((messageId: string): boolean => {
    const session = state.session;
    if (session === null) return false;
    const index = session.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return false;
    const neededFromEnd = session.messages.length - index;
    setRenderBudgetCount((current) => Math.max(current, neededFromEnd));
    return true;
  }, [state.session]);

  const reportCitationScrollFinished = useCallback((messageId: string): void => {
    setCitationScrollTarget((current) =>
      current?.messageId === messageId ? null : current
    );
    if (citationHighlightTimerRef.current !== null) {
      clearTimeout(citationHighlightTimerRef.current);
      citationHighlightTimerRef.current = null;
    }
    const startHighlight = (): void => {
      setCitationHighlightMessageId(messageId);
      citationHighlightTimerRef.current = setTimeout(() => {
        setCitationHighlightMessageId(null);
        citationHighlightTimerRef.current = null;
      }, 2600);
    };
    setCitationHighlightMessageId((current) => {
      if (current === messageId) {
        return null;
      }
      return current;
    });
    window.requestAnimationFrame(() => {
      startHighlight();
    });
  }, []);

  const scrollToMessage = useCallback(async (
    messageId: string,
    options?: {
      readonly blockId?: string | null;
      readonly startOffset?: number | null;
    }
  ): Promise<void> => {
    ensureMessageVisible(messageId);
    setCitationScrollTarget({
      messageId,
      blockId: options?.blockId ?? null,
      startOffset: options?.startOffset ?? null,
      token: performance.now()
    });
  }, [ensureMessageVisible, state.session]);

  const captureWorkspaceScreenshot = useCallback(async (): Promise<AgentImageAttachment | null> => {
    if (desktopApi === null) return null;
    const activeTab = resolveActiveWorkspaceTab?.();
    if (activeTab === undefined) {
      return null;
    }
    const workspaceContext = {
      workspaceTabId: activeTab.id,
      workspaceTabTitle: activeTab.title,
      workspaceTabPageKind: activeTab.pageKind,
      workspaceTabAddress: activeTab.displayAddress
    };
    const capture = activeTab.pageKind === "page"
      ? await desktopApi.workbenchBrowser.capturePage({ tabId: activeTab.id })
      : await desktopApi.workbenchBrowser.captureWindow();
    return {
      id: "workspace-screenshot-" + Date.now().toString(36),
      mediaType: capture.mimeType,
      data: capture.imageBase64,
      label: activeTab.title.trim() || t("lyra-agents-message.workspaceScreenshot"),
      source: "workspace-screenshot",
      width: capture.width,
      height: capture.height,
      ...workspaceContext
    };
  }, [desktopApi, locale, resolveActiveWorkspaceTab]);

  const pickFileFromFileManager = useCallback(async (): Promise<
    | { readonly kind: "image"; readonly attachment: AgentImageAttachment }
    | { readonly kind: "file"; readonly attachment: AgentFileCitation }
    | null
  > => {
    if (onPickFileFromFileManager === undefined) {
      return null;
    }
    const filePath = await onPickFileFromFileManager();
    if (filePath === null) {
      return null;
    }
    if (isImageViewerSupportedPath(filePath)) {
      const image = await readImageAttachmentFromPath(filePath);
      if (image === null) {
        return null;
      }
      return { kind: "image", attachment: image };
    }
    const file = buildFileAttachmentFromPath(filePath);
    if (file === null) {
      return null;
    }
    return { kind: "file", attachment: file };
  }, [onPickFileFromFileManager]);

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
    syncBrowserFollowModeCoordinator(snapshot.enabled);
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

  const showPasswordInvalid = useCallback(async (): Promise<void> => {
    const description = t("permissionPolicy.passwordInvalidDescription");
    if (openDialog === undefined) {
      window.alert(description);
      return;
    }
    return new Promise<void>((resolve) => {
      openDialog({
        title: t("permissionPolicy.passwordInvalidTitle"),
        description,
        source: {
          title: "Lyra Agent",
          subtitle: t("permissionPolicy.dialogSourceSubtitle"),
          iconLabel: "LA",
          iconTone: "danger"
        },
        actions: [
          {
            id: "ok",
            label: t("permissionPolicy.passwordInvalidAck"),
            onSelect: () => resolve()
          }
        ]
      });
    });
  }, [locale, openDialog]);

  const confirmDisableFullAuto = useCallback(async (
    hasCredential: boolean
  ): Promise<"delete" | "keep" | "cancel"> => {
    if (!hasCredential) return "keep";
    const description = t("permissionPolicy.deleteCredentialDescription");
    if (openDialog === undefined) {
      return window.confirm(description) ? "delete" : "cancel";
    }
    return new Promise<"delete" | "keep" | "cancel">((resolve) => {
      openDialog({
        title: t("permissionPolicy.deleteCredentialTitle"),
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
            onSelect: () => resolve("cancel")
          },
          {
            id: "keep",
            label: t("permissionPolicy.keepAndDisable"),
            onSelect: () => resolve("keep")
          },
          {
            id: "delete",
            label: t("permissionPolicy.deleteAndDisable"),
            tone: "danger",
            onSelect: () => resolve("delete")
          }
        ]
      });
    });
  }, [locale, openDialog]);

  const switchPermissionMode = useCallback(async (
    mode: "approval" | "full_auto"
  ): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const agent = desktopApi.agent;
    const sensitiveValues = desktopApi.sensitiveValues;

    // 关闭全自动 → 弹出凭据删除选择
    if (mode === "approval") {
      const existingRef = permissionPolicy?.elevationCredentialRef;
      const hasCredential = existingRef !== undefined && existingRef !== null;
      const choice = await confirmDisableFullAuto(hasCredential);
      if (choice === "cancel") return;
      setPermissionPolicyBusy(true);
      try {
        if (choice === "delete") {
          await agent.clearElevationSecret();
          if (sensitiveValues !== undefined && isLyraSensitiveValueRef(existingRef)) {
            await sensitiveValues.delete({ ref: existingRef });
          }
        }
        setPermissionPolicy(await agent.setPermissionPolicyMode({ mode }));
      } finally {
        setPermissionPolicyBusy(false);
      }
      return;
    }

    // 开启全自动 → 警告 → 输入密码 → 校验 → 存储 → 注入
    if (sensitiveValues === undefined) return;
    const confirmed = await confirmFullAutoMode();
    if (!confirmed) return;
    const password = await requestAdminPassword();
    if (password === null) return;
    setPermissionPolicyBusy(true);
    try {
      // 校验密码 — Rust 侧运行 sudo -S -k true 验证
      const validation = await agent.validateElevationPassword({ password });
      if (!validation.valid) {
        await showPasswordInvalid();
        return;
      }

      // 校验通过 → 加密存储到 safeStorage
      const credential = await sensitiveValues.store({
        owner: "system",
        valueKind: "credential",
        label: t("permissionPolicy.adminCredentialLabel"),
        description: t("permissionPolicy.adminCredentialStorageDescription"),
        value: password,
        capabilities: ["list_metadata", "use", "reveal_to_user"]
      });

      // 注入明文密码到 Rust 进程内（shell.rs sudo 自动解密用）
      await agent.setElevationSecret({ secret: password });

      // 设置权限模式 + 绑定 credential ref
      setPermissionPolicy(await agent.setPermissionPolicyMode({
        mode,
        elevationCredentialRef: credential.ref
      }));
    } finally {
      setPermissionPolicyBusy(false);
    }
  }, [
    confirmDisableFullAuto,
    confirmFullAutoMode,
    desktopApi,
    locale,
    permissionPolicy?.elevationCredentialRef,
    requestAdminPassword,
    showPasswordInvalid
  ]);

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

  const createSession = useCallback(async (agentMode?: AgentMode): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const request = createSessionRequest(agentMode);
    if (agentMode === undefined && onCreateDraftSessionTab !== undefined) {
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
    // A session bound to a real project is permanent (runtime rejects rebinds); a
    // home-defaulted session may still be bound once. Otherwise stash on the draft
    // tab (bound for real when the first message creates the session).
    if (state.session?.projectBound === true && state.session.workingDirIsHome !== true) return;
    const selectedPath = await onRequestProjectBind(activeDraftWorkingDir ?? undefined);
    if (selectedPath === null) return;
    if (state.session === null) {
      onUpdateDraftWorkingDir?.(selectedPath);
      // 选项目即触发索引（不等待首次消息建 session）。
      void desktopApi.agent.codegraphStatus({ workingDir: selectedPath }).catch(() => undefined);
      return;
    }
    const snapshot = await desktopApi.agent.bindProject({
      sessionId: state.session.id,
      workingDir: selectedPath
    });
    dispatch({ type: "snapshot", snapshot });
  }, [
    activeDraftWorkingDir,
    desktopApi,
    onRequestProjectBind,
    onUpdateDraftWorkingDir,
    state.session
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

  const submitDecisions = useCallback(async (answers: Record<string, string>) => {
    if (desktopApi?.agent === undefined) return;
    const entries = Object.entries(answers)
      .map(([id, answer]) => [id, answer.trim()] as const)
      .filter(([, answer]) => answer.length > 0);
    for (const [id, answer] of entries) {
      const question = pendingClarifications.find((item) => item.id === id);
      if (question === undefined) continue;
      const selectedOption =
        question.options.find((option) => option.label === answer)?.label ?? null;
      await desktopApi.agent.respondClarification({
        sessionId: question.sessionId,
        clarificationId: id,
        answer,
        selectedOption
      });
      setPendingClarifications((items) => items.filter((item) => item.id !== id));
    }
  }, [desktopApi, pendingClarifications]);

  const approvePermission = useCallback(async (id: string) => {
    if (desktopApi?.agent === undefined) return;
    const permission = pendingPermissions.find((item) => item.id === id);
    if (permission === undefined) return;
    await desktopApi.agent.respondPermission({
      sessionId: permission.sessionId,
      permissionId: id,
      allowed: true
    });
    setPendingPermissions((items) => items.filter((item) => item.id !== id));
  }, [desktopApi, pendingPermissions]);

  const denyPermission = useCallback(async (id: string) => {
    if (desktopApi?.agent === undefined) return;
    const permission = pendingPermissions.find((item) => item.id === id);
    if (permission === undefined) return;
    await desktopApi.agent.respondPermission({
      sessionId: permission.sessionId,
      permissionId: id,
      allowed: false
    });
    setPendingPermissions((items) => items.filter((item) => item.id !== id));
  }, [desktopApi, pendingPermissions]);

  const openPlanReview = useCallback(async (plan: AgentPlanSnapshot & { sessionId?: string }): Promise<void> => {
    const sessionId = plan.sessionId ?? state.session?.id;
    if (sessionId === undefined) return;
    await onOpenPlanBoard?.({
      sessionId,
      plan,
      projectTodo: state.session?.projectTodo ?? null
    });
  }, [onOpenPlanBoard, state.session]);

  const openProjectTodo = useCallback(async (): Promise<void> => {
    if (state.session?.plan === null || state.session?.plan === undefined) return;
    await onOpenPlanBoard?.({
      sessionId: state.session.id,
      plan: state.session.plan,
      projectTodo: state.session.projectTodo ?? null
    });
  }, [onOpenPlanBoard, state.session]);

  const openProjectPlanManager = useCallback(async (
    view: "plan" | "todo" | "both" = "both"
  ): Promise<void> => {
    if (
      state.session?.projectBound !== true ||
      state.session.workingDirIsHome === true ||
      typeof state.session.workingDir !== "string" ||
      state.session.workingDir.trim().length === 0
    ) {
      return;
    }
    await onOpenProjectPlanManager?.({
      sessionId: state.session.id,
      workingDir: state.session.workingDir,
      view
    });
  }, [
    onOpenProjectPlanManager,
    state.session?.id,
    state.session?.projectBound,
    state.session?.workingDir,
    state.session?.workingDirIsHome
  ]);

  const respondPlanReview = useCallback(async (
    action: AgentPlanReviewRespondAction,
    feedback?: string | null
  ): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    // ponytail: planReview prop 有 fallback 逻辑（line 2085）——pendingPlanReview
    // 为 null 时从 session 快照 plan.phase==="reviewing" 渲染面板。此处需同步 fallback，
    // 否则按钮可见但点击 return early → 无反应。
    const plan = pendingPlanReview ?? (
      state.session?.plan?.phase === "reviewing" ? state.session.plan : null
    );
    if (plan === null) return;
    const sessionId = pendingPlanReview?.sessionId ?? state.session?.id;
    if (sessionId === undefined) return;
    const snapshot = await desktopApi.agent.respondPlanReview({
      sessionId,
      action,
      feedback: feedback ?? null,
      omaChannelId: plan.omaSource?.channelId ?? null,
      omaSourceSessionAgentId: plan.omaSource?.sessionAgentId ?? null
    });
    setPendingPlanReview(null);
    dispatch({ type: "snapshot", snapshot });
  }, [desktopApi, pendingPlanReview, state.session]);

  const currentSessionId = resolvedSessionId;

  const switchModel = useCallback(async (modelId: string): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const selectedModel = modelState?.models.find((model) => model.id === modelId);
    const model = (selectedModel?.model ?? modelId).trim();
    const provider = (
      selectedModel?.providerKey
      ?? selectedModel?.providerId
      ?? selectedModel?.provider
      ?? ""
    ).trim();
    if (model.length === 0) return;
    setModelBusy("switch");
    try {
      setModelState(await desktopApi.agent.switchAgentModel({
        sessionId: currentSessionId,
        model,
        provider: provider.length === 0 ? null : provider
      }));
    } finally {
      setModelBusy(null);
    }
  }, [currentSessionId, desktopApi, modelState?.models]);

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

  const routeProjectPathIfBound = useCallback(async (
    target: WorkbenchPathTarget,
    mode: "reveal" | "open-file"
  ): Promise<boolean> => {
    const session = state.session;
    if (
      onRevealProjectPath === undefined ||
      session?.projectBound !== true ||
      session.workingDirIsHome === true
    ) {
      return false;
    }
    const sessionId = session.id.trim();
    const workingDir = session.workingDir.trim();
    if (
      sessionId.length === 0 ||
      workingDir.length === 0 ||
      !isPathInsideProjectRoot(target.path, workingDir)
    ) {
      return false;
    }
    await onRevealProjectPath({
      sessionId,
      workingDir,
      path: target.path,
      mode,
      ...(mode === "open-file" && target.location !== undefined
        ? { location: target.location }
        : {})
    });
    return true;
  }, [
    onRevealProjectPath,
    state.session
  ]);

  const openFileInWorkbench = useCallback(async (filePath: string): Promise<void> => {
    const target = parseWorkbenchPathTarget(filePath, state.session?.workingDir);
    if (target === null) return;
    if (await routeProjectPathIfBound(target, "open-file")) {
      return;
    }
    onOpenFile?.(target.path, target.location);
  }, [
    onOpenFile,
    routeProjectPathIfBound,
    state.session?.workingDir
  ]);

  const revealPathInWorkbench = useCallback(async (filePath: string): Promise<void> => {
    const target = parseWorkbenchPathTarget(filePath, state.session?.workingDir);
    if (target === null) return;
    if (await routeProjectPathIfBound(target, "reveal")) {
      return;
    }
    await onRevealPathInWorkbench?.(target.path);
  }, [
    onRevealPathInWorkbench,
    routeProjectPathIfBound,
    state.session?.workingDir
  ]);

  const openInFileManager = useCallback(async (path: string): Promise<void> => {
    const trimmed = path.trim();
    if (trimmed.length === 0) return;
    await onRevealPathInWorkbench?.(trimmed);
  }, [onRevealPathInWorkbench]);

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

    const cacheKey = `${image.id}:${image.mediaType}:${(image.data ?? "").length}:${image.label ?? ""}`;
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
      data: image.data ?? "",
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
    await desktopApi.agent.runReview({ sessionId: currentSessionId });
  }, [currentSessionId, desktopApi]);

  const runJudge = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    await desktopApi.agent.runJudge({ sessionId: currentSessionId });
  }, [currentSessionId, desktopApi]);

  const submitSessionRename = useCallback(async (title: string | null): Promise<void> => {
    if (desktopApi?.agent === undefined || currentSessionId === null) return;
    await desktopApi.agent.renameSession({ sessionId: currentSessionId, title });
    const snapshot = await desktopApi.agent.readSession({ sessionId: currentSessionId });
    dispatch({ type: "snapshot", snapshot });
    onSessionSnapshotChange?.(snapshot);
  }, [currentSessionId, desktopApi, onSessionSnapshotChange]);

  const renameSession = useCallback((): void => {
    if (openDialog === undefined || currentSessionId === null) return;
    const sessionTitle = state.session?.title ?? "Lyra Agent";
    openDialog({
      title: t("header.renameTitle"),
      source: {
        title: "Lyra Agent",
        subtitle: sessionTitle,
        iconLabel: "LA",
        iconTone: "accent"
      },
      input: {
        id: `rename-${currentSessionId}`,
        label: t("header.renamePlaceholder"),
        value: sessionTitle,
        placeholder: t("header.renamePlaceholder"),
        submitActionId: "save"
      },
      actions: [
        {
          id: "clear",
          label: t("header.clearRename"),
          onSelect: () => {
            void submitSessionRename(null);
          }
        },
        {
          id: "cancel",
          label: t("header.cancelAction")
        },
        {
          id: "save",
          label: t("header.saveRename"),
          tone: "primary",
          onSelect: ({ inputValue }) => {
            const nextTitle = inputValue?.trim() ?? "";
            void submitSessionRename(nextTitle.length === 0 ? null : nextTitle);
          }
        }
      ]
    });
  }, [currentSessionId, openDialog, state.session?.title, submitSessionRename]);

  const archiveSession = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined || currentSessionId === null) return;
    await desktopApi.agent.archiveSession({
      sessionId: currentSessionId,
      archived: true
    });
    onMissingSession?.(currentSessionId);
  }, [currentSessionId, desktopApi, onMissingSession]);

  const confirmDeleteSession = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined || currentSessionId === null) return;
    await desktopApi.agent.deleteSession({ sessionId: currentSessionId });
    onMissingSession?.(currentSessionId);
  }, [currentSessionId, desktopApi, onMissingSession]);

  const deleteSession = useCallback((): void => {
    if (openDialog === undefined || currentSessionId === null) return;
    const sessionTitle = state.session?.title ?? "Lyra Agent";
    openDialog({
      title: t("header.deleteConfirmTitle"),
      description: t("header.deleteConfirmDescription"),
      source: {
        title: "Lyra Agent",
        subtitle: sessionTitle,
        iconLabel: "LA",
        iconTone: "danger"
      },
      actions: [
        {
          id: "cancel",
          label: t("header.cancelAction")
        },
        {
          id: "delete",
          label: t("header.deleteConfirmAction"),
          tone: "danger",
          onSelect: () => {
            void confirmDeleteSession();
          }
        }
      ]
    });
  }, [confirmDeleteSession, currentSessionId, openDialog, state.session?.title]);

  // Stabilize the composer's control objects so they keep the same identity
  // across streaming-token re-renders (they do not depend on the message stream).
  // Without this they were rebuilt inside the `data` memo on every token, forcing
  // the composer toolbar / header consumers to re-render needlessly.
  const modelControls = useMemo<ComposerModelControls | null>(() => {
    if (modelState === null) return null;
    return {
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
  }, [modelState, modelBusy, switchModel, refreshModels, openModelSettings, updateReasoningEffort, updateVerbosity, updateServiceTier]);

  const permissionModeControls = useMemo<ComposerPermissionModeControls | null>(() => {
    if (desktopApi?.agent === undefined) return null;
    return {
      currentMode: permissionPolicy?.mode ?? "approval",
      isSwitching: permissionPolicyBusy,
      warning: permissionPolicy?.warning ?? null,
      configPath: permissionPolicy?.configPath ?? null,
      switchMode: switchPermissionMode
    };
  }, [desktopApi, permissionPolicy, permissionPolicyBusy, switchPermissionMode]);

  // Simple render-budget load: increase the visible message count by a fixed batch.
  const loadEarlierMessages = useCallback(async (): Promise<void> => {
    setRenderBudgetCount((current) =>
      Math.min(current + APP_CONFIG.messageWindow.loadBatchSize, APP_CONFIG.messageWindow.maxRenderMessages)
    );
  }, []);

  const data = useMemo(() => {
    const activeOmaChannelId =
      state.session?.agentMode === "oma" && state.session.oma !== null
        ? state.session.oma.activeChannelId
        : null;
    const messageSession = activeOmaChannelId === null || state.session === null
      ? state.session
      : {
          ...state.session,
          messages: state.session.messages.filter((message) =>
            omaChannelIdFromMetadata(message.metadata) === activeOmaChannelId
          )
        };
    const totalMessageCount = messageSession?.messages.length ?? 0;
    const visibleMessageCount = Math.min(totalMessageCount, renderBudgetCount);
    const chatMessages = agentSessionToChatMessages(messageSession, {
      messageLimitFromEnd: renderBudgetCount
    });
    const turnRunning = state.session?.follow.running ?? state.loading;
    const lastChatMessage = chatMessages.at(-1);
    // While a turn is running but the agent has not yet emitted its own message
    // (the "connecting" window before the first token), append an empty pending
    // agent placeholder so the activity indicator renders directly below the
    // latest user message. Without it the indicator either vanishes (the very
    // first message of a session) or attaches to the previous agent message
    // above the user's new message (subsequent messages).
    const messages: ChatMessage[] =
      turnRunning &&
      (lastChatMessage === undefined || lastChatMessage.author === "user")
        ? [
            ...chatMessages,
            {
              id: "lyra-agent-connecting",
              author: "agent",
              ...(activeOmaChannelId === null ? {} : { oma: { channelId: activeOmaChannelId } }),
              blocks: [
                {
                  type: "text",
                  id: "lyra-agent-connecting-text",
                  body: ""
                }
              ]
            }
          ]
        : chatMessages;
    const omaControls: OmaControls | null = state.session?.agentMode === "oma"
      ? {
          state: state.session.oma,
          agentMode: "oma",
          activeChannelId: activeOmaChannelId,
          setMode: setAgentMode,
          addAgent: addOmaAgent,
          removeAgent: removeOmaAgent,
          setActiveChannel: setOmaActiveChannel
        }
      : null;
    const input: CreateDataProviderValueInput = {
      session: agentSessionMetaWithDraftWorkingDir(agentSessionToSessionMeta(state.session), state.session === null ? activeDraftWorkingDir : null),
      messages,
      messageWindow: {
        visibleCount: visibleMessageCount,
        hiddenBefore: Math.max(0, totalMessageCount - visibleMessageCount),
        totalCount: totalMessageCount,
        canLoadEarlier: visibleMessageCount < totalMessageCount
      },
      todos: agentSessionToTodos(state.session),
      projectTodo: state.session?.projectTodo ?? null,
      diffFiles: [] satisfies DiffFileEntry[],
      decisions: pendingClarifications.slice(0, 1),
      permissions: pendingPermissions,
      planReview: pendingPlanReview ?? (
        state.session?.plan?.phase === "reviewing" ? state.session.plan : null
      ),
      modelControls,
      permissionModeControls,
      locationControls: locationControls ?? null,
      omaControls,
      openModelSettings,
      aiRichRenderingEnabled,
      browserFollowModeEnabled,
      setBrowserFollowMode,
      openUrlInWorkbench,
      openFileInWorkbench,
      revealPathInWorkbench,
      openInFileManager,
      openPlanReview,
      openProjectTodo,
      openProjectPlanManager,
      respondPlanReview,
      openTerminalLiveSession,
      openImageInWorkbench,
      canOpenImageInWorkbench,
      revealSensitiveValueToUser,
      sendMessage,
      addCitationToComposer,
      addPageCitationToComposer,
      attachDragPayloadToComposer,
      pendingCitation,
      pendingCitationNonce,
      pendingImages,
      pendingImagesNonce,
      pendingFiles,
      pendingFilesNonce,
      navigateToPageCitation,
      scrollToMessage,
      citationScrollTarget,
      reportCitationScrollFinished,
      citationHighlightMessageId,
      loadEarlierMessages,
      captureWorkspaceScreenshot,
      captureWindowScreenshot,
      pickFileFromFileManager,
      workspaceTabs: workspaceTabsForComposer,
      terminalTabs: terminalTabsForComposer,
      ...(getTerminalTabPanes === undefined ? {} : { getTerminalTabPanes }),
      ...(onCloseTerminalTab === undefined ? {} : { closeTerminalTab: onCloseTerminalTab }),
      ...(onFocusTerminalTabInDock === undefined ? {} : { focusTerminalTabInDock: onFocusTerminalTabInDock }),
      cancelTurn: cancel,
      previewRollback,
      rollbackMessage,
      createSession,
      bindProject,
      openProjectTree,
      runImprove,
      runRefactor,
      pokeTodos,
      runReview,
      runJudge,
      renameSession,
      archiveSession,
      deleteSession,
      submitDecisions,
      approvePermission,
      denyPermission,
      isMock: false,
      isTurnRunning: turnRunning,
      followActivity:
        state.session?.follow.activity ??
        (state.loading ? AGENT_FOLLOW_ACTIVITY_CONNECTING : null)
    };
    return createDataProviderValue(input);
  }, [
    approvePermission,
    bindProject,
    cancel,
    captureWorkspaceScreenshot,
    captureWindowScreenshot,
    pickFileFromFileManager,
    workspaceTabsForComposer,
    terminalTabsForComposer,
    getTerminalTabPanes,
    onCloseTerminalTab,
    onFocusTerminalTabInDock,
    createSession,
    desktopApi,
    denyPermission,
    browserFollowModeEnabled,
    setBrowserFollowMode,
    openModelSettings,
    openUrlInWorkbench,
    openFileInWorkbench,
    openPlanReview,
    openProjectTodo,
    openProjectPlanManager,
    revealPathInWorkbench,
    openInFileManager,
    respondPlanReview,
    openTerminalLiveSession,
    openImageInWorkbench,
    canOpenImageInWorkbench,
    revealSensitiveValueToUser,
    openProjectTree,
    addCitationToComposer,
    addPageCitationToComposer,
    attachDragPayloadToComposer,
    pendingCitation,
    pendingCitationNonce,
    pendingImages,
    pendingImagesNonce,
    pendingFiles,
    pendingFilesNonce,
    navigateToPageCitation,
    scrollToMessage,
    citationScrollTarget,
    reportCitationScrollFinished,
    citationHighlightMessageId,
    loadEarlierMessages,
    modelControls,
    permissionModeControls,
    locationControls,
    aiRichRenderingEnabled,
    pendingClarifications,
    pendingPermissions,
    pendingPlanReview,
    previewRollback,
    rollbackMessage,
    runImprove,
    runRefactor,
    runReview,
    sendMessage,
    setAgentMode,
    addOmaAgent,
    removeOmaAgent,
    setOmaActiveChannel,
    activeDraftWorkingDir,
    state.session,
    state.loading,
    renderBudgetCount,
    runJudge,
    renameSession,
    archiveSession,
    deleteSession,
    pokeTodos,
    submitDecisions,
    onOpenFile,
    locale
  ]);

  return {
    data,
    followRunning: state.session?.follow.running ?? state.loading,
    followActivity:
      state.session?.follow.activity ??
      (state.loading ? AGENT_FOLLOW_ACTIVITY_CONNECTING : null),
    error: state.error,
    cancel
  };
};
