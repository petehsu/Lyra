import { useCallback, useMemo, useState } from "react";

import type {
  LyraDesktopApi,
} from "../../../shared/desktop-bridge";
import type {
  AgentSessionDetail,
} from "./agent-ui-types";
import type { LyraThread } from "./lyra-thread-adapter";
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
  readonly model?: string | undefined;
  readonly modelProvider?: string | null | undefined;
  readonly cwd?: string | null | undefined;
  readonly collaborationMode?: LyraCollaborationMode | undefined;
  readonly effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
  readonly verbosity?: "low" | "medium" | "high" | undefined;
  readonly approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never" | undefined;
  readonly approvalsReviewer?: "user" | "auto_review" | undefined;
};

export type RuntimeTurnAttachment = {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory" | "local_image" | "image" | "workbench_tab" | "ai_thread";
  readonly contextText?: string | undefined;
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
  readonly onFollowOpenFilePath?: (filePath: string, options?: {
    readonly forceReloadIfOpen?: boolean;
    readonly allowMissing?: boolean;
    readonly location?: { readonly line: number };
  }) => void;
};

type LyraThreadTabState = {
  readonly tabs: readonly LyraThreadTab[];
  readonly activeTabId: string | null;
};

const DEFAULT_DRAFT_TITLE = "New thread";

const emptyThreads: readonly LyraThread[] = [];
const emptyOptimisticMessages: readonly OptimisticUserMessage[] = [];

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

export const useLyraThreadRuntime = (_options: UseLyraThreadRuntimeOptions): {
  readonly state: LyraThreadRuntimeState;
  readonly actions: LyraThreadRuntimeActions;
} => {
  const [tabState, setTabState] = useState<LyraThreadTabState>(() => initialTabState());
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const [followEnabled, setFollowEnabled] = useState(false);

  const activeTab = useMemo(
    () => tabState.tabs.find((tab) => tab.tabId === tabState.activeTabId) ?? null,
    [tabState.activeTabId, tabState.tabs]
  );

  const state = useMemo<LyraThreadRuntimeState>(() => ({
    threads: emptyThreads,
    threadTabs: tabState.tabs,
    activeTabId: tabState.activeTabId,
    activeThreadId: activeTab?.threadId ?? null,
    activeThread: null,
    activeDetail: null,
    planModeEnabled,
    followEnabled,
    optimisticUserMessages: emptyOptimisticMessages,
    isLoadingThreads: false,
    isLoadingThread: false,
    isSending: false,
    isStreamActive: false,
    streamingTurnId: null,
    streamingAssistantText: "",
    runtimeError: null,
  }), [
    activeTab?.threadId,
    followEnabled,
    planModeEnabled,
    tabState.activeTabId,
    tabState.tabs,
  ]);

  const createThread = useCallback(async (): Promise<string> => {
    const tab = createDraftTab();
    setTabState((current) => insertAfterActive(current, tab));
    return tab.tabId;
  }, []);

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
      const now = Date.now();
      return insertAfterActive(current, {
        tabId: `thread:${normalizedThreadId}`,
        threadId: normalizedThreadId,
        title: normalizedThreadId,
        openedAt: now,
        updatedAt: now,
        status: "idle",
      });
    });
  }, []);

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

  const noOp = useCallback(async (): Promise<void> => {}, []);
  const actions = useMemo<LyraThreadRuntimeActions>(() => ({
    createThread,
    sendTurn: noOp,
    steerTurn: noOp,
    interruptTurn: noOp,
    cleanBackgroundTerminals: noOp,
    selectThread,
    activateThreadTab,
    closeThreadTab,
    reorderThreadTab,
    openThreadTab,
    setPlanModeEnabled,
    setFollowEnabled,
  }), [
    activateThreadTab,
    closeThreadTab,
    createThread,
    noOp,
    openThreadTab,
    reorderThreadTab,
    selectThread,
  ]);

  return { state, actions };
};
