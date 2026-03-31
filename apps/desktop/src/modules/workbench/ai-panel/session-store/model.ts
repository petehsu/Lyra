import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AiChatSessionSummary } from "../../../../shared/ai";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type {
  FileEditorChangeReviewItem,
  FileEditorModel
} from "../../file-editor";
import type { WorkbenchFeedbackPublishRequest } from "../../feedback";
import type {
  SidebarChangeApprovalView,
  SidebarComposerMode,
  SidebarComposerSubmitPayload
} from "../../sidebar/types";
import { toSidebarChangeApprovalPanelViewModel } from "../change-approval";
import { toSidebarQuestionPanelViewModel } from "../question-flow";
import type {
  AiPanelHistoryItem,
  AiPanelSession,
  AiPanelSessionId,
  AiPanelSessionPlacement,
  AiPanelSessionViewModel
} from "../types";
import {
  arraysEqual,
  buildHistoryItems,
  createDraftSession,
  createDraftSessionId,
  mergeNativeSession,
  resolveFeedbackCodeFromError,
  upsertSummary
} from "./native-mappers";

export type UseAiPanelSessionStoreOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly fileEditorModel: FileEditorModel;
  readonly defaultSessionTitle: string;
  readonly publishFeedback?: (event: WorkbenchFeedbackPublishRequest) => void;
};

export type AiPanelSessionStoreModel = {
  readonly sidebarSessionId: AiPanelSessionId;
  readonly sidebarSession: AiPanelSessionViewModel;
  readonly sessions: readonly AiPanelSession[];
  readonly externalEditorInstanceIds: readonly string[];
  readonly fileChangeReviewItems: readonly FileEditorChangeReviewItem[];
  readonly getSessionView: (sessionId: AiPanelSessionId) => AiPanelSessionViewModel | null;
  readonly getSession: (sessionId: AiPanelSessionId) => AiPanelSession | null;
  readonly ensureSession: (
    sessionId: AiPanelSessionId,
    options?: {
      readonly title?: string;
      readonly placement?: AiPanelSessionPlacement;
    }
  ) => void;
  readonly syncWorkspaceTabSessions: (sessionIds: readonly AiPanelSessionId[]) => void;
  readonly isSessionOpenInWorkspace: (sessionId: AiPanelSessionId) => boolean;
  readonly sendMessage: (
    sessionId: AiPanelSessionId,
    payload: SidebarComposerSubmitPayload,
    mode: SidebarComposerMode
  ) => void;
  readonly pauseReplying: (sessionId: AiPanelSessionId) => void;
  readonly setComposerMode: (sessionId: AiPanelSessionId, mode: SidebarComposerMode) => void;
  readonly setQuotedMessage: (sessionId: AiPanelSessionId, value: string | null) => void;
  readonly closeQuestionPanel: (sessionId: AiPanelSessionId) => void;
  readonly navigateQuestion: (
    sessionId: AiPanelSessionId,
    direction: "up" | "down"
  ) => void;
  readonly selectQuestionOption: (
    sessionId: AiPanelSessionId,
    questionId: string,
    optionId: string
  ) => void;
  readonly updateQuestionCustomDraft: (
    sessionId: AiPanelSessionId,
    questionId: string,
    value: string
  ) => void;
  readonly submitQuestionCustomAnswer: (
    sessionId: AiPanelSessionId,
    questionId: string
  ) => void;
  readonly setChangeApprovalView: (
    sessionId: AiPanelSessionId,
    view: SidebarChangeApprovalView
  ) => void;
  readonly acceptAllRuntimeFileChanges: (sessionId: AiPanelSessionId) => void;
  readonly startNewSidebarConversation: () => AiPanelSessionId;
  readonly openSessionInSidebar: (sessionId: AiPanelSessionId) => void;
  readonly moveSidebarSessionToWorkspace: () => AiPanelSessionId;
  readonly activateRuntimeItem: (sessionId: AiPanelSessionId, itemId: string) => void;
  readonly acceptRuntimeItem: (sessionId: AiPanelSessionId, itemId: string) => void;
  readonly rejectRuntimeItem: (sessionId: AiPanelSessionId, itemId: string) => void;
  readonly undoRuntimeItemDecision: (sessionId: AiPanelSessionId, itemId: string) => void;
};

const EMPTY_EDITOR_IDS: readonly string[] = [];
const EMPTY_FILE_CHANGE_ITEMS: readonly FileEditorChangeReviewItem[] = [];

const upsertSession = (
  current: readonly AiPanelSession[],
  nextSession: AiPanelSession
): readonly AiPanelSession[] => {
  const index = current.findIndex((session) => session.id === nextSession.id);
  if (index === -1) {
    return [...current, nextSession];
  }
  return current.map((session, sessionIndex) =>
    sessionIndex === index ? nextSession : session
  );
};

const buildSessionView = (
  session: AiPanelSession,
  historyItems: readonly AiPanelHistoryItem[]
): AiPanelSessionViewModel => ({
  id: session.id,
  title: session.title,
  mode: session.mode,
  messages: session.messages,
  isReplying: session.isReplying,
  quotedMessage: session.quotedMessage,
  questionPanel: toSidebarQuestionPanelViewModel(session.questionFlow),
  changeApprovalPanel: toSidebarChangeApprovalPanelViewModel(
    session.runtimeItems,
    session.changeApprovalView
  ),
  historyItems,
  runtimeItems: session.runtimeItems,
  activeRuntimeItemId: session.activeRuntimeItemId
});

export const useAiPanelSessionStore = ({
  desktopApi,
  fileEditorModel: _fileEditorModel,
  defaultSessionTitle,
  publishFeedback
}: UseAiPanelSessionStoreOptions): AiPanelSessionStoreModel => {
  const initialSidebarSessionId = useMemo(() => createDraftSessionId(), []);
  const [sessions, setSessions] = useState<readonly AiPanelSession[]>(() => [
    createDraftSession(defaultSessionTitle, initialSidebarSessionId, "sidebar-draft")
  ]);
  const [sidebarSessionId, setSidebarSessionId] = useState<AiPanelSessionId>(
    initialSidebarSessionId
  );
  const [workspaceSessionIds, setWorkspaceSessionIds] = useState<readonly AiPanelSessionId[]>([]);
  const [historySummaries, setHistorySummaries] = useState<readonly AiChatSessionSummary[]>([]);
  const loadRequestsRef = useRef<Map<string, Promise<void>>>(new Map());

  const publishAiError = useCallback((sessionId: string, error: unknown): void => {
    publishFeedback?.({
      code: resolveFeedbackCodeFromError(error),
      level: "error",
      sessionId,
      message: error instanceof Error ? error.message : String(error)
    });
  }, [publishFeedback]);

  const applyNativeSession = useCallback((
    nativeSession: Parameters<typeof mergeNativeSession>[0],
    placement?: AiPanelSessionPlacement
  ): void => {
    setSessions((current) => {
      const existing = current.find((session) => session.id === nativeSession.id);
      return upsertSession(current, mergeNativeSession(nativeSession, existing, placement));
    });
    setHistorySummaries((current) =>
      upsertSummary(current, {
        id: nativeSession.id,
        title: nativeSession.title,
        updatedAt: nativeSession.updatedAt,
        summary: nativeSession.summary,
        mode: nativeSession.mode
      })
    );
  }, []);

  const refreshHistory = useCallback(async (): Promise<void> => {
    if (desktopApi === null) {
      return;
    }
    try {
      const nextHistory = await desktopApi.ai.readSessionHistory({ limit: 128 });
      setHistorySummaries(
        [...nextHistory].sort((left, right) => right.updatedAt - left.updatedAt)
      );
    } catch {
      // Keep existing history when the bridge is unavailable.
    }
  }, [desktopApi]);

  const loadSession = useCallback(async (
    sessionId: string,
    options?: {
      readonly title?: string;
      readonly placement?: AiPanelSessionPlacement;
    }
  ): Promise<void> => {
    if (desktopApi === null) {
      return;
    }
    const existingRequest = loadRequestsRef.current.get(sessionId);
    if (existingRequest !== undefined) {
      await existingRequest;
      return;
    }

    const request = desktopApi.ai
      .readSession({
        sessionId,
        fallbackTitle: options?.title ?? defaultSessionTitle,
        preferredMode: "chat"
      })
      .then((session) => {
        applyNativeSession(session, options?.placement);
      })
      .catch((error: unknown) => {
        publishAiError(sessionId, error);
      })
      .finally(() => {
        loadRequestsRef.current.delete(sessionId);
      });

    loadRequestsRef.current.set(sessionId, request);
    await request;
  }, [applyNativeSession, defaultSessionTitle, desktopApi, publishAiError]);

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }

    void refreshHistory();
    const unsubscribe = desktopApi.ai.onEvent((event) => {
      if (event.kind !== "session_updated") {
        return;
      }
      applyNativeSession(event.session);
      setHistorySummaries((current) => upsertSummary(current, event.summary));
    });

    return () => {
      unsubscribe();
    };
  }, [applyNativeSession, desktopApi, refreshHistory]);

  useEffect(() => {
    void loadSession(sidebarSessionId, { placement: "sidebar-draft" });
  }, [loadSession, sidebarSessionId]);

  useEffect(() => {
    for (const sessionId of workspaceSessionIds) {
      void loadSession(sessionId, { placement: "workspace-tab" });
    }
  }, [loadSession, workspaceSessionIds]);

  const ensureSession = useCallback((
    sessionId: AiPanelSessionId,
    options?: {
      readonly title?: string;
      readonly placement?: AiPanelSessionPlacement;
    }
  ): void => {
    setSessions((current) => {
      const existing = current.find((session) => session.id === sessionId);
      if (existing === undefined) {
        const nextSession = createDraftSession(
          options?.title ?? defaultSessionTitle,
          sessionId,
          options?.placement ?? "workspace-tab"
        );
        return [...current, nextSession];
      }
      return current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        return {
          ...session,
          title: options?.title ?? session.title,
          placement: options?.placement ?? session.placement
        };
      });
    });

    void loadSession(sessionId, options);
  }, [defaultSessionTitle, loadSession]);

  const syncWorkspaceTabSessions = useCallback((sessionIds: readonly AiPanelSessionId[]): void => {
    const normalized = Array.from(
      new Set(sessionIds.filter((sessionId) => sessionId.trim().length > 0))
    );
    setWorkspaceSessionIds((current) => (arraysEqual(current, normalized) ? current : normalized));
    setSessions((current) => {
      let next = current;
      for (const sessionId of normalized) {
        const existing = next.find((session) => session.id === sessionId);
        if (existing === undefined) {
          next = [
            ...next,
            createDraftSession(defaultSessionTitle, sessionId, "workspace-tab")
          ];
          continue;
        }
        if (existing.placement === "workspace-tab") {
          continue;
        }
        next = next.map((session) =>
          session.id === sessionId
            ? { ...session, placement: "workspace-tab" as const }
            : session
        );
      }
      return next;
    });
  }, [defaultSessionTitle]);

  const isSessionOpenInWorkspace = useCallback(
    (sessionId: AiPanelSessionId): boolean => workspaceSessionIds.includes(sessionId),
    [workspaceSessionIds]
  );

  const setComposerMode = useCallback((sessionId: AiPanelSessionId, mode: SidebarComposerMode): void => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId ? { ...session, mode } : session
      )
    );
  }, []);

  const setQuotedMessage = useCallback((sessionId: AiPanelSessionId, value: string | null): void => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId ? { ...session, quotedMessage: value } : session
      )
    );
  }, []);

  const sendMessage = useCallback((
    sessionId: AiPanelSessionId,
    payload: SidebarComposerSubmitPayload,
    mode: SidebarComposerMode
  ): void => {
    if (desktopApi === null) {
      publishAiError(sessionId, new Error("AI desktop bridge is unavailable"));
      return;
    }

    const text = payload.text.trim();
    if (text.length === 0 || mode !== "chat") {
      return;
    }

    void desktopApi.ai
      .sendChatTurn({
        sessionId,
        mode,
        text,
        tokens: payload.tokens,
        fallbackTitle: defaultSessionTitle
      })
      .then((response) => {
        applyNativeSession(response.session);
      })
      .catch((error: unknown) => {
        publishAiError(sessionId, error);
      });
  }, [applyNativeSession, defaultSessionTitle, desktopApi, publishAiError]);

  const sessionMap = useMemo(
    () => new Map(sessions.map((session) => [session.id, session] as const)),
    [sessions]
  );

  const pauseReplying = useCallback((sessionId: AiPanelSessionId): void => {
    if (desktopApi === null) {
      return;
    }
    const session = sessionMap.get(sessionId);
    if (session?.activeTurnId === null || session?.activeTurnId === undefined) {
      return;
    }
    void desktopApi.ai
      .cancelChatTurn({
        sessionId,
        turnId: session.activeTurnId
      })
      .then((nextSession) => {
        applyNativeSession(nextSession);
      })
      .catch((error: unknown) => {
        publishAiError(sessionId, error);
      });
  }, [applyNativeSession, desktopApi, publishAiError, sessionMap]);

  const startNewSidebarConversation = useCallback((): AiPanelSessionId => {
    const nextSession = createDraftSession(defaultSessionTitle);
    setSessions((current) => [...current, nextSession]);
    setSidebarSessionId(nextSession.id);
    return nextSession.id;
  }, [defaultSessionTitle]);

  const openSessionInSidebar = useCallback((sessionId: AiPanelSessionId): void => {
    ensureSession(sessionId, { placement: "sidebar-draft" });
    setSidebarSessionId(sessionId);
  }, [ensureSession]);

  const moveSidebarSessionToWorkspace = useCallback((): AiPanelSessionId => {
    const currentSessionId = sidebarSessionId;
    const nextSidebarSession = createDraftSession(defaultSessionTitle);

    setSessions((current) => {
      const withWorkspaceSession = current.map((session) =>
        session.id === currentSessionId
          ? { ...session, placement: "workspace-tab" as const }
          : session
      );
      return [...withWorkspaceSession, nextSidebarSession];
    });
    setWorkspaceSessionIds((current) =>
      current.includes(currentSessionId) ? current : [...current, currentSessionId]
    );
    setSidebarSessionId(nextSidebarSession.id);
    return currentSessionId;
  }, [defaultSessionTitle, sidebarSessionId]);

  const getSession = useCallback(
    (sessionId: AiPanelSessionId): AiPanelSession | null => sessionMap.get(sessionId) ?? null,
    [sessionMap]
  );

  const getSessionView = useCallback((sessionId: AiPanelSessionId): AiPanelSessionViewModel | null => {
    const session = sessionMap.get(sessionId);
    if (session === undefined) {
      return null;
    }
    return buildSessionView(
      session,
      buildHistoryItems(sessionId, historySummaries, sessions, workspaceSessionIds)
    );
  }, [historySummaries, sessionMap, sessions, workspaceSessionIds]);

  const sidebarSession = useMemo<AiPanelSessionViewModel>(() => {
    const session = sessionMap.get(sidebarSessionId) ?? createDraftSession(defaultSessionTitle, sidebarSessionId);
    return buildSessionView(
      session,
      buildHistoryItems(session.id, historySummaries, sessions, workspaceSessionIds)
    );
  }, [defaultSessionTitle, historySummaries, sessionMap, sessions, sidebarSessionId, workspaceSessionIds]);

  const noopWithSession = useCallback((_sessionId: AiPanelSessionId): void => {}, []);
  const noopQuestionNavigate = useCallback((
    _sessionId: AiPanelSessionId,
    _direction: "up" | "down"
  ): void => {}, []);
  const noopQuestionOption = useCallback((
    _sessionId: AiPanelSessionId,
    _questionId: string,
    _optionId: string
  ): void => {}, []);
  const noopQuestionDraft = useCallback((
    _sessionId: AiPanelSessionId,
    _questionId: string,
    _value: string
  ): void => {}, []);
  const noopQuestionSubmit = useCallback((
    _sessionId: AiPanelSessionId,
    _questionId: string
  ): void => {}, []);
  const noopChangeApproval = useCallback((
    _sessionId: AiPanelSessionId,
    _view: SidebarChangeApprovalView
  ): void => {}, []);
  const noopRuntimeItem = useCallback((
    _sessionId: AiPanelSessionId,
    _itemId: string
  ): void => {}, []);

  return {
    sidebarSessionId,
    sidebarSession,
    sessions,
    externalEditorInstanceIds: EMPTY_EDITOR_IDS,
    fileChangeReviewItems: EMPTY_FILE_CHANGE_ITEMS,
    getSessionView,
    getSession,
    ensureSession,
    syncWorkspaceTabSessions,
    isSessionOpenInWorkspace,
    sendMessage,
    pauseReplying,
    setComposerMode,
    setQuotedMessage,
    closeQuestionPanel: noopWithSession,
    navigateQuestion: noopQuestionNavigate,
    selectQuestionOption: noopQuestionOption,
    updateQuestionCustomDraft: noopQuestionDraft,
    submitQuestionCustomAnswer: noopQuestionSubmit,
    setChangeApprovalView: noopChangeApproval,
    acceptAllRuntimeFileChanges: noopWithSession,
    startNewSidebarConversation,
    openSessionInSidebar,
    moveSidebarSessionToWorkspace,
    activateRuntimeItem: noopRuntimeItem,
    acceptRuntimeItem: noopRuntimeItem,
    rejectRuntimeItem: noopRuntimeItem,
    undoRuntimeItemDecision: noopRuntimeItem
  };
};
