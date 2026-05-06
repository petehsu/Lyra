import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentRuntimeStreamEvent,
  LyraDesktopApi,
} from "../../../shared/desktop-bridge";
import type {
  AgentApplyPatchRequest,
  AgentApplyPatchResult,
  AgentMessage,
  AgentResolvePlanReviewRequest,
  AgentResolvePlanReviewResult,
  AgentResolveApprovalRequest,
  AgentResolveApprovalResult,
  AgentRuntimeEvent,
  AgentSession,
  AgentSessionDetail,
} from "./agent-ui-types";
import type {
  LyraThread,
  LyraTurn,
  ThreadAiPanelTimelineEntry,
  ThreadAiPanelMessageContentPart,
  ThreadAiPanelTurn,
  ThreadAiPanelTurnMeta,
  ThreadAiPanelViewModel,
} from "./lyra-thread-adapter";

export type LyraCollaborationMode = "default" | "plan";

export type LyraThreadTabStatus = "draft" | "idle" | "running" | "error";

export type LyraThreadTab = {
  readonly tabId: string;
  readonly threadId: string | null;
  readonly title: string;
  readonly openedAt: number;
  readonly updatedAt: number;
  readonly status: LyraThreadTabStatus;
};

type OptimisticUserMessage = {
  readonly id: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly role: "user";
  readonly content: string;
  readonly contentParts?: AgentSessionDetail["messages"][number]["contentParts"];
  readonly createdAt: number;
  readonly optimistic: true;
};

export type LyraThreadRuntimeState = {
  readonly threads: readonly LyraThread[];
  readonly threadTabs: readonly LyraThreadTab[];
  readonly activeTabId: string | null;
  readonly activeThreadId: string | null;
  readonly activeThread: LyraThread | null;
  readonly activeDetail: AgentSessionDetail | null;
  readonly planModeEnabled: boolean;
  readonly followEnabled: boolean;
  readonly optimisticUserMessages: readonly OptimisticUserMessage[];
  readonly isLoadingThreads: boolean;
  readonly isLoadingThread: boolean;
  readonly isSending: boolean;
  readonly isStreamActive: boolean;
  readonly streamingTurnId: string | null;
  readonly streamingAssistantText: string;
  readonly runtimeError: string | null;
};

export type LyraThreadRuntimeActions = {
  readonly createThread: (options?: RuntimeThreadOptions) => Promise<string>;
  readonly sendTurn: (input: RuntimeTurnInput, options?: RuntimeThreadOptions) => Promise<void>;
  readonly steerTurn: (input: RuntimeTurnInput) => Promise<void>;
  readonly interruptTurn: () => Promise<void>;
  readonly applyPatch: (request: AgentApplyPatchRequest) => Promise<AgentApplyPatchResult>;
  readonly resolveApproval: (request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>;
  readonly resolvePlanReview: (request: AgentResolvePlanReviewRequest) => Promise<AgentResolvePlanReviewResult>;
  readonly pauseFollow: () => Promise<void>;
  readonly resumeFollow: () => Promise<void>;
  readonly refreshActiveThread: () => Promise<void>;
  readonly cleanBackgroundTerminals: () => Promise<void>;
  readonly selectThread: (threadId: string | null) => void;
  readonly activateThreadTab: (tabId: string) => void;
  readonly closeThreadTab: (tabId: string) => void;
  readonly reorderThreadTab: (tabId: string, targetIndex: number) => void;
  readonly openThreadTab: (threadId: string) => void;
  readonly setPlanModeEnabled: (enabled: boolean) => void;
  readonly setFollowEnabled: (enabled: boolean) => void;
};

export type RuntimeThreadOptions = {
  readonly profileId?: string;
  readonly model?: string;
  readonly modelProvider?: string | null;
  readonly cwd?: string | null;
  readonly collaborationMode?: LyraCollaborationMode;
  readonly effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly verbosity?: "low" | "medium" | "high";
  readonly approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
  readonly approvalsReviewer?: "user" | "auto_review";
  readonly permissionMode?: "sandbox" | "full_access";
  readonly followEnabled?: boolean;
};

export type RuntimeTurnAttachment = {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory" | "local_image" | "image" | "workbench_tab" | "ai_thread";
  readonly contextText?: string;
};

export type RuntimeTurnInputPart =
  | {
    readonly type: "text";
    readonly text: string;
  }
  | {
    readonly type: "attachment";
    readonly attachment: RuntimeTurnAttachment;
  };

export type RuntimeTurnInput = {
  readonly text: string;
  readonly attachments: readonly RuntimeTurnAttachment[];
  readonly parts?: readonly RuntimeTurnInputPart[];
};

type UseLyraThreadRuntimeOptions = {
  readonly desktopApi: LyraDesktopApi | null;
};

type LyraThreadTabState = {
  readonly tabs: readonly LyraThreadTab[];
  readonly activeTabId: string | null;
};

const DEFAULT_DRAFT_TITLE = "New thread";
const emptyOptimisticMessages: readonly OptimisticUserMessage[] = [];
const PROJECTED_RUNTIME_EVENT_TYPES = new Set([
  "runtime_state_changed",
  "tool_operation_requested",
  "tool_operation_started",
  "tool_operation_completed",
  "tool_operation_failed",
  "verification_plan_created",
  "verification_run_updated",
]);

const createTabId = (): string =>
  `draft:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

const createDraftTab = (): LyraThreadTab => {
  const now = Date.now();
  return {
    tabId: createTabId(),
    threadId: null,
    title: DEFAULT_DRAFT_TITLE,
    openedAt: now,
    updatedAt: now,
    status: "draft",
  };
};

const initialTabState = (): LyraThreadTabState => {
  const tab = createDraftTab();
  return {
    tabs: [tab],
    activeTabId: tab.tabId,
  };
};

const insertAfterActive = (
  state: LyraThreadTabState,
  tab: LyraThreadTab
): LyraThreadTabState => {
  const activeIndex = state.tabs.findIndex((entry) => entry.tabId === state.activeTabId);
  const insertIndex = activeIndex < 0 ? state.tabs.length : activeIndex + 1;
  return {
    tabs: [
      ...state.tabs.slice(0, insertIndex),
      tab,
      ...state.tabs.slice(insertIndex),
    ],
    activeTabId: tab.tabId,
  };
};

const readDetailFromPayload = (payload: unknown): AgentSessionDetail | null => {
  if (payload === null || typeof payload !== "object" || !("detail" in payload)) {
    return null;
  }
  const detail = (payload as { readonly detail?: unknown }).detail;
  if (detail === null || typeof detail !== "object" || !("session" in detail)) {
    return null;
  }
  return detail as AgentSessionDetail;
};

const streamEventToRuntimeEvent = (event: AgentRuntimeStreamEvent): AgentRuntimeEvent => {
  const timestamp = Date.parse(event.createdAt);
  return {
    sessionId: event.sessionId,
    turnId: event.runtimeTurnId ?? "",
    phase: event.eventType,
    payload: event.payload,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
};

const latestMessagePreview = (messages: readonly AgentMessage[]): string =>
  [...messages]
    .reverse()
    .map((message) => (message.displayContent ?? message.content).trim())
    .find((content) => content.length > 0)
  ?? "";

const sessionStatus = (detail: AgentSessionDetail | null): LyraThreadTabStatus => {
  const lastTurn = detail?.turns.at(-1);
  if (lastTurn?.status === "running") {
    return "running";
  }
  if (lastTurn?.status === "failed") {
    return "error";
  }
  return "idle";
};

const detailToThread = (detail: AgentSessionDetail): LyraThread => ({
  id: detail.session.id,
  preview: latestMessagePreview(detail.messages),
  name: detail.session.title,
  cwd: detail.session.projectRoot ?? null,
  boundProjectRoot: detail.session.projectRoot ?? null,
  modelProvider: detail.turns.at(-1)?.profileId ?? detail.session.profileId ?? "ai",
  createdAt: detail.session.createdAt,
  updatedAt: detail.session.updatedAt,
  turns: detail.turns.map<LyraTurn>((turn) => ({
    id: turn.id,
    status: turn.status,
    collaborationMode: turn.collaborationMode ?? detail.session.collaborationMode,
    items: [],
    startedAt: turn.createdAt,
    completedAt: turn.status === "completed" ? turn.updatedAt : null,
    ...(turn.usage === undefined ? {} : { usage: turn.usage })
  })),
  aiPanelViewModel: detailToViewModel(detail),
});

const sessionToThread = (session: AgentSession): LyraThread => ({
  id: session.id,
  preview: "",
  name: session.title,
  cwd: session.projectRoot ?? null,
  boundProjectRoot: session.projectRoot ?? null,
  modelProvider: session.profileId ?? "ai",
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  turns: [],
});

const detailToViewModel = (detail: AgentSessionDetail): ThreadAiPanelViewModel => {
  const timelineEntries: ThreadAiPanelTimelineEntry[] = detail.messages.map((message) => ({
    id: `message:${message.id}`,
    sessionId: detail.session.id,
    turnId: message.turnId ?? "",
    kind: message.role === "assistant" ? "assistantMessage" : "userMessage",
    refId: message.id,
    createdAtMs: message.createdAt,
  }));
  const turnMetaById = new Map<string, ThreadAiPanelTurnMeta>();
  for (const message of detail.messages) {
    if (message.turnId === undefined) {
      continue;
    }
    const current = turnMetaById.get(message.turnId);
    if (message.role !== "assistant") {
      if (current === undefined) {
        turnMetaById.set(message.turnId, {
          turnId: message.turnId,
          sessionId: detail.session.id,
          hasAssistantDisplay: false,
        });
      }
      continue;
    }
    turnMetaById.set(message.turnId, {
      turnId: message.turnId,
      sessionId: detail.session.id,
      firstAssistantMessageId: current?.firstAssistantMessageId ?? message.id,
      lastAssistantMessageId: message.id,
      hasAssistantDisplay: true,
    });
  }
  return {
    messages: detail.messages.map((message) => {
      const contentParts = message.contentParts?.map((part): ThreadAiPanelMessageContentPart | null => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        }
        if (
          part.type === "attachment"
          && (part.kind === undefined
            || part.kind === "file"
            || part.kind === "directory"
            || part.kind === "local_image"
            || part.kind === "image")
        ) {
          return part.kind === undefined ? {
            type: "attachment",
            name: part.name,
            path: part.path,
          } : {
            type: "attachment",
            name: part.name,
            path: part.path,
            kind: part.kind,
          };
        }
        return null;
      }).filter((part): part is ThreadAiPanelMessageContentPart => part !== null);
      return {
        id: message.id,
        sessionId: message.sessionId,
        ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
        role: message.role,
        content: message.content,
        ...(message.displayContent === undefined ? {} : { displayContent: message.displayContent }),
        ...(contentParts === undefined || contentParts.length === 0 ? {} : { contentParts }),
        createdAtMs: message.createdAt,
      };
    }),
    turns: detail.turns.map<ThreadAiPanelTurn>((turn) => ({
      id: turn.id,
      sessionId: turn.sessionId,
      status: turn.status,
      collaborationMode: turn.collaborationMode ?? detail.session.collaborationMode,
      createdAtMs: turn.createdAt,
      updatedAtMs: turn.updatedAt,
      ...(turn.errorCode === undefined ? {} : { errorCode: turn.errorCode }),
      ...(turn.errorMessage === undefined ? {} : { errorMessage: turn.errorMessage }),
      ...(turn.usage === undefined ? {} : { usage: turn.usage }),
    })),
    plans: [],
    pendingInteractions: [],
    timelineEntries,
    turnMeta: [...turnMetaById.values()],
  };
};

export const useLyraThreadRuntime = ({ desktopApi }: UseLyraThreadRuntimeOptions): {
  readonly state: LyraThreadRuntimeState;
  readonly actions: LyraThreadRuntimeActions;
} => {
  const [tabState, setTabState] = useState<LyraThreadTabState>(() => initialTabState());
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const [followEnabled, setFollowEnabled] = useState(false);
  const [threads, setThreads] = useState<readonly LyraThread[]>([]);
  const [detailById, setDetailById] = useState<ReadonlyMap<string, AgentSessionDetail>>(() => new Map());
  const [streamingTextByTurn, setStreamingTextByTurn] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [streamingTurnId, setStreamingTurnId] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const activeTabRef = useRef<LyraThreadTab | null>(null);

  const activeTab = useMemo(
    () => tabState.tabs.find((tab) => tab.tabId === tabState.activeTabId) ?? null,
    [tabState.activeTabId, tabState.tabs]
  );
  activeTabRef.current = activeTab;

  const upsertDetail = useCallback((detail: AgentSessionDetail): void => {
    setDetailById((current) => {
      const next = new Map(current);
      next.set(detail.session.id, detail);
      return next;
    });
    setThreads((current) => {
      const nextThread = detailToThread(detail);
      const existingIndex = current.findIndex((thread) => thread.id === detail.session.id);
      const next = existingIndex < 0
        ? [nextThread, ...current]
        : [
            ...current.slice(0, existingIndex),
            nextThread,
            ...current.slice(existingIndex + 1),
          ];
      return [...next].sort((left, right) => right.updatedAt - left.updatedAt);
    });
    setTabState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.threadId === detail.session.id
          ? {
              ...tab,
              title: detail.session.title,
              updatedAt: detail.session.updatedAt,
              status: sessionStatus(detail),
            }
          : tab
      ),
    }));
  }, []);

  const appendRuntimeEvent = useCallback((event: AgentRuntimeEvent): void => {
    setDetailById((current) => {
      const detail = current.get(event.sessionId);
      if (detail === undefined) {
        return current;
      }
      if (detail.runtimeEvents.some((entry) =>
        entry.phase === event.phase
        && entry.turnId === event.turnId
        && entry.timestamp === event.timestamp
      )) {
        return current;
      }
      const nextDetail: AgentSessionDetail = {
        ...detail,
        runtimeEvents: [...detail.runtimeEvents, event],
      };
      const next = new Map(current);
      next.set(event.sessionId, nextDetail);
      return next;
    });
  }, []);

  useEffect(() => {
    const api = desktopApi?.ai;
    if (api === undefined) {
      return;
    }
    let disposed = false;
    setIsLoadingThreads(true);
    void api.listSessions()
      .then((sessions) => {
        if (disposed) {
          return;
        }
        setThreads(sessions.map(sessionToThread));
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setRuntimeError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsLoadingThreads(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [desktopApi?.ai]);

  useEffect(() => {
    const api = desktopApi?.ai;
    if (api === undefined) {
      return;
    }
    return api.onAgentEvent((event: AgentRuntimeStreamEvent) => {
      if (event.eventType === "model_text_delta") {
        const delta = event.payload !== null && typeof event.payload === "object"
          ? (event.payload as { readonly delta?: unknown }).delta
          : null;
        if (typeof delta === "string" && event.runtimeTurnId !== undefined) {
          setStreamingTurnId(event.runtimeTurnId);
          setStreamingTextByTurn((current) => {
            const next = new Map(current);
            next.set(event.runtimeTurnId!, `${next.get(event.runtimeTurnId!) ?? ""}${delta}`);
            return next;
          });
        }
        return;
      }
      if (
        event.eventType === "runtime_turn_completed"
        || event.eventType === "runtime_turn_cancelled"
        || event.eventType === "model_message_end"
      ) {
        if (event.runtimeTurnId !== undefined) {
          setStreamingTextByTurn((current) => {
            const next = new Map(current);
            next.delete(event.runtimeTurnId!);
            return next;
          });
          setStreamingTurnId((current) => current === event.runtimeTurnId ? null : current);
        }
      }
      if (event.eventType === "runtime_error") {
        const message = event.payload !== null && typeof event.payload === "object"
          ? (event.payload as { readonly message?: unknown }).message
          : null;
        setRuntimeError(typeof message === "string" ? message : "AI runtime error");
      }
      if (PROJECTED_RUNTIME_EVENT_TYPES.has(event.eventType)) {
        appendRuntimeEvent(streamEventToRuntimeEvent(event));
      }
      const detail = readDetailFromPayload(event.payload);
      if (detail !== null) {
        upsertDetail(detail);
      }
    });
  }, [appendRuntimeEvent, desktopApi?.ai, upsertDetail]);

  useEffect(() => {
    const api = desktopApi?.ai;
    const threadId = activeTab?.threadId ?? null;
    if (api === undefined || threadId === null || detailById.has(threadId)) {
      return;
    }
    let disposed = false;
    setIsLoadingThread(true);
    void api.readSession({ sessionId: threadId })
      .then((detail) => {
        if (!disposed) {
          upsertDetail(detail);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setRuntimeError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsLoadingThread(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [activeTab?.threadId, desktopApi?.ai, detailById, upsertDetail]);

  const openThreadTab = useCallback((threadId: string): void => {
    const normalizedThreadId = threadId.trim();
    if (normalizedThreadId.length === 0) {
      return;
    }
    setTabState((current) => {
      const existing = current.tabs.find((tab) => tab.threadId === normalizedThreadId);
      if (existing !== undefined) {
        return { ...current, activeTabId: existing.tabId };
      }
      const thread = threads.find((entry) => entry.id === normalizedThreadId);
      const now = Date.now();
      return insertAfterActive(current, {
        tabId: `thread:${normalizedThreadId}`,
        threadId: normalizedThreadId,
        title: thread?.name ?? thread?.preview ?? normalizedThreadId,
        openedAt: now,
        updatedAt: thread?.updatedAt ?? now,
        status: "idle",
      });
    });
  }, [threads]);

  const createThread = useCallback(async (options?: RuntimeThreadOptions): Promise<string> => {
    const api = desktopApi?.ai;
    if (api === undefined) {
      const tab = createDraftTab();
      setTabState((current) => insertAfterActive(current, tab));
      return tab.tabId;
    }
    const detail = await api.createSession({
      ...(options?.profileId === undefined ? {} : { profileId: options.profileId }),
      projectRoot: options?.cwd ?? null,
      cwd: options?.cwd ?? null,
      ...(options?.collaborationMode === undefined ? {} : { collaborationMode: options.collaborationMode }),
    });
    upsertDetail(detail);
    const now = Date.now();
    const tab: LyraThreadTab = {
      tabId: `thread:${detail.session.id}`,
      threadId: detail.session.id,
      title: detail.session.title,
      openedAt: now,
      updatedAt: detail.session.updatedAt,
      status: "idle",
    };
    setTabState((current) => insertAfterActive(current, tab));
    return detail.session.id;
  }, [desktopApi?.ai, upsertDetail]);

  const selectThread = useCallback((threadId: string | null): void => {
    if (threadId === null) {
      const tab = createDraftTab();
      setTabState((current) => insertAfterActive(current, tab));
      return;
    }
    openThreadTab(threadId);
  }, [openThreadTab]);

  const activateThreadTab = useCallback((tabId: string): void => {
    setTabState((current) =>
      current.tabs.some((tab) => tab.tabId === tabId)
        ? { ...current, activeTabId: tabId }
        : current
    );
  }, []);

  const closeThreadTab = useCallback((tabId: string): void => {
    setTabState((current) => {
      const index = current.tabs.findIndex((tab) => tab.tabId === tabId);
      if (index < 0) {
        return current;
      }
      const nextTabs = current.tabs.filter((tab) => tab.tabId !== tabId);
      if (nextTabs.length === 0) {
        return initialTabState();
      }
      if (current.activeTabId !== tabId) {
        return { ...current, tabs: nextTabs };
      }
      const nextActive = nextTabs[index] ?? nextTabs[index - 1] ?? nextTabs[0];
      return {
        tabs: nextTabs,
        activeTabId: nextActive?.tabId ?? null,
      };
    });
  }, []);

  const reorderThreadTab = useCallback((tabId: string, targetIndex: number): void => {
    setTabState((current) => {
      const fromIndex = current.tabs.findIndex((tab) => tab.tabId === tabId);
      if (fromIndex < 0) {
        return current;
      }
      const nextTabs = [...current.tabs];
      const [tab] = nextTabs.splice(fromIndex, 1);
      if (tab === undefined) {
        return current;
      }
      const boundedIndex = Math.max(0, Math.min(targetIndex, nextTabs.length));
      nextTabs.splice(boundedIndex, 0, tab);
      return { ...current, tabs: nextTabs };
    });
  }, []);

  const sendTurn = useCallback(async (
    input: RuntimeTurnInput,
    options?: RuntimeThreadOptions
  ): Promise<void> => {
    const api = desktopApi?.ai;
    if (api === undefined) {
      setRuntimeError("AI runtime is not connected");
      return;
    }
    setIsSending(true);
    setRuntimeError(null);
    const activeTabSnapshot = activeTabRef.current;
    try {
      const result = await api.sendTurn({
        sessionId: activeTabSnapshot?.threadId ?? null,
        input,
        ...(options === undefined ? {} : { options }),
      });
      upsertDetail(result.detail);
      setStreamingTurnId(result.turnId);
      setTabState((current) => ({
        tabs: current.tabs.map((tab) =>
          tab.tabId === activeTabSnapshot?.tabId
            ? {
                ...tab,
                threadId: result.sessionId,
                tabId: tab.threadId === null ? `thread:${result.sessionId}` : tab.tabId,
                title: result.detail.session.title,
                updatedAt: result.detail.session.updatedAt,
                status: "running",
              }
            : tab
        ),
        activeTabId:
          current.activeTabId === activeTabSnapshot?.tabId && activeTabSnapshot?.threadId === null
            ? `thread:${result.sessionId}`
            : current.activeTabId,
      }));
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
    }
  }, [desktopApi?.ai, upsertDetail]);

  const steerTurn = useCallback(async (input: RuntimeTurnInput): Promise<void> => {
    await sendTurn(input);
  }, [sendTurn]);

  const interruptTurn = useCallback(async (): Promise<void> => {
    const api = desktopApi?.ai;
    const threadId = activeTabRef.current?.threadId ?? null;
    if (api === undefined || threadId === null || streamingTurnId === null) {
      return;
    }
    await api.cancelTurn({
      sessionId: threadId,
      turnId: streamingTurnId,
    });
  }, [desktopApi?.ai, streamingTurnId]);

  const applyPatch = useCallback(async (
    request: AgentApplyPatchRequest
  ): Promise<AgentApplyPatchResult> => {
    const api = desktopApi?.ai;
    if (api === undefined) {
      throw new Error("AI runtime is not connected");
    }
    const result = await api.applyPatch(request);
    const detail = await api.readSession({ sessionId: request.sessionId });
    upsertDetail(detail);
    return result;
  }, [desktopApi?.ai, upsertDetail]);

  const resolveApproval = useCallback(async (
    request: AgentResolveApprovalRequest
  ): Promise<AgentResolveApprovalResult> => {
    const api = desktopApi?.ai;
    if (api === undefined) {
      throw new Error("AI runtime is not connected");
    }
    const result = await api.resolveApproval(request);
    const detail = await api.readSession({ sessionId: request.sessionId });
    upsertDetail(detail);
    return result;
  }, [desktopApi?.ai, upsertDetail]);

  const resolvePlanReview = useCallback(async (
    request: AgentResolvePlanReviewRequest
  ): Promise<AgentResolvePlanReviewResult> => {
    const api = desktopApi?.ai;
    if (api === undefined) {
      throw new Error("AI runtime is not connected");
    }
    const result = await api.resolvePlanReview(request);
    const detail = await api.readSession({ sessionId: request.sessionId });
    upsertDetail(detail);
    return result;
  }, [desktopApi?.ai, upsertDetail]);

  const refreshActiveDetail = useCallback(async (): Promise<void> => {
    const api = desktopApi?.ai;
    const threadId = activeTabRef.current?.threadId ?? null;
    if (api === undefined || threadId === null) {
      return;
    }
    const detail = await api.readSession({ sessionId: threadId });
    upsertDetail(detail);
  }, [desktopApi?.ai, upsertDetail]);

  const pauseFollow = useCallback(async (): Promise<void> => {
    const api = desktopApi?.ai;
    const threadId = activeTabRef.current?.threadId ?? null;
    if (api === undefined || threadId === null) {
      return;
    }
    await api.pauseFollow({ sessionId: threadId });
    await refreshActiveDetail();
  }, [desktopApi?.ai, refreshActiveDetail]);

  const resumeFollow = useCallback(async (): Promise<void> => {
    const api = desktopApi?.ai;
    const threadId = activeTabRef.current?.threadId ?? null;
    if (api === undefined || threadId === null) {
      return;
    }
    await api.resumeFollow({ sessionId: threadId });
    await refreshActiveDetail();
  }, [desktopApi?.ai, refreshActiveDetail]);

  const cleanBackgroundTerminals = useCallback(async (): Promise<void> => {}, []);

  const activeThreadId = activeTab?.threadId ?? null;
  const activeDetail = activeThreadId === null ? null : detailById.get(activeThreadId) ?? null;
  const activeThread = activeThreadId === null
    ? null
    : threads.find((thread) => thread.id === activeThreadId) ?? (activeDetail === null ? null : detailToThread(activeDetail));
  const streamingAssistantText = streamingTurnId === null ? "" : streamingTextByTurn.get(streamingTurnId) ?? "";
  const isStreamActive = streamingTurnId !== null && streamingAssistantText.length >= 0;

  const state = useMemo<LyraThreadRuntimeState>(() => ({
    threads,
    threadTabs: tabState.tabs,
    activeTabId: tabState.activeTabId,
    activeThreadId,
    activeThread,
    activeDetail,
    planModeEnabled,
    followEnabled,
    optimisticUserMessages: emptyOptimisticMessages,
    isLoadingThreads,
    isLoadingThread,
    isSending,
    isStreamActive,
    streamingTurnId,
    streamingAssistantText,
    runtimeError,
  }), [
    activeDetail,
    activeThread,
    activeThreadId,
    followEnabled,
    isLoadingThread,
    isLoadingThreads,
    isSending,
    isStreamActive,
    planModeEnabled,
    runtimeError,
    streamingAssistantText,
    streamingTurnId,
    tabState.activeTabId,
    tabState.tabs,
    threads,
  ]);

  const actions = useMemo<LyraThreadRuntimeActions>(() => ({
    createThread,
    sendTurn,
    steerTurn,
    interruptTurn,
    applyPatch,
    resolveApproval,
    resolvePlanReview,
    pauseFollow,
    resumeFollow,
    refreshActiveThread: refreshActiveDetail,
    cleanBackgroundTerminals,
    selectThread,
    activateThreadTab,
    closeThreadTab,
    reorderThreadTab,
    openThreadTab,
    setPlanModeEnabled,
    setFollowEnabled,
  }), [
    activateThreadTab,
    applyPatch,
    resolveApproval,
    resolvePlanReview,
    pauseFollow,
    resumeFollow,
    refreshActiveDetail,
    cleanBackgroundTerminals,
    closeThreadTab,
    createThread,
    interruptTurn,
    openThreadTab,
    reorderThreadTab,
    selectThread,
    sendTurn,
    steerTurn,
  ]);

  return { state, actions };
};
