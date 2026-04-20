import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { AgentApi, AgentSendTurnResult, AgentSessionDetail } from "../../../shared/desktop-bridge";
import { isSessionNotFoundError, trimOptionalText, type OptimisticUserMessage } from "./view-helpers";

type UseAiPanelSendTurnParams = {
  readonly agentApi: AgentApi | undefined;
  readonly activeSessionId: string | null;
  readonly setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  readonly activeDetail: AgentSessionDetail | null;
  readonly setActiveDetail: Dispatch<SetStateAction<AgentSessionDetail | null>>;
  readonly draftInput: string;
  readonly setDraftInput: Dispatch<SetStateAction<string>>;
  readonly isSending: boolean;
  readonly isPlanModeArmed: boolean;
  readonly activeComposerModel: string | null;
  readonly activeComposerModelOption: {
    readonly modelName: string;
    readonly profileId: string;
  } | null;
  readonly selectedComposerProfileId: string | null;
  readonly newSessionTitle: string;
  readonly boundProjectPathBySession: Readonly<Record<string, string>>;
  readonly setBoundProjectPathBySession: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  readonly setSelectedModelBySession: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  readonly setIsSending: Dispatch<SetStateAction<boolean>>;
  readonly setIsInteractionSubmitting: Dispatch<SetStateAction<boolean>>;
  readonly setRuntimeError: Dispatch<SetStateAction<string | null>>;
  readonly setFinalizingTurnId: Dispatch<SetStateAction<string | null>>;
  readonly setOptimisticUserMessages: Dispatch<SetStateAction<readonly OptimisticUserMessage[]>>;
  readonly startPendingInteractionPolling: (sessionId: string) => () => void;
  readonly loadSessionDetail: (sessionId: string) => Promise<void>;
  readonly loadSessions: () => Promise<void>;
};

type UseAiPanelSendTurnResult = {
  readonly sendTurn: () => Promise<void>;
};

export const useAiPanelSendTurn = ({
  agentApi,
  activeSessionId,
  setActiveSessionId,
  activeDetail,
  setActiveDetail,
  draftInput,
  setDraftInput,
  isSending,
  isPlanModeArmed,
  activeComposerModel,
  activeComposerModelOption,
  selectedComposerProfileId,
  newSessionTitle,
  boundProjectPathBySession,
  setBoundProjectPathBySession,
  setSelectedModelBySession,
  setIsSending,
  setIsInteractionSubmitting,
  setRuntimeError,
  setFinalizingTurnId,
  setOptimisticUserMessages,
  startPendingInteractionPolling,
  loadSessionDetail,
  loadSessions,
}: UseAiPanelSendTurnParams): UseAiPanelSendTurnResult => {
  const applySendTurnResult = useCallback(
    (result: AgentSendTurnResult): void => {
      const assistantTurnId = result.assistantMessage?.turnId;
      if (typeof assistantTurnId === "string") {
        setFinalizingTurnId((current) => (current === assistantTurnId ? null : current));
      }
      setActiveDetail((current) => {
        if (current === null || current.session.id !== result.session.id) {
          return current;
        }
        const nextTurns = [...current.turns];
        const turnIndex = nextTurns.findIndex((turn) => turn.id === result.turn.id);
        if (turnIndex >= 0) {
          nextTurns[turnIndex] = result.turn;
        } else {
          nextTurns.push(result.turn);
        }

        const nextToolCalls = [...current.toolCalls];
        for (const call of result.toolCalls) {
          const callIndex = nextToolCalls.findIndex((entry) => entry.id === call.id);
          if (callIndex >= 0) {
            nextToolCalls[callIndex] = call;
          } else {
            nextToolCalls.push(call);
          }
        }

        const nextMessages = [...current.messages];
        if (result.assistantMessage !== undefined) {
          const messageIndex = nextMessages.findIndex(
            (message) => message.id === result.assistantMessage!.id
          );
          if (messageIndex >= 0) {
            nextMessages[messageIndex] = result.assistantMessage;
          } else {
            nextMessages.push(result.assistantMessage);
          }
        }

        return {
          ...current,
          session: result.session,
          turns: nextTurns,
          toolCalls: nextToolCalls,
          messages: nextMessages,
        };
      });
    },
    [setActiveDetail, setFinalizingTurnId]
  );

  const sendTurn = useCallback(async (): Promise<void> => {
    if (agentApi === undefined || activeSessionId === null) {
      return;
    }
    const rawInput = draftInput.trim();
    const planCommandMatch = rawInput.match(/^\/plan(?:\s+([\s\S]+))?$/);
    const enteringPlanMode = planCommandMatch !== null || isPlanModeArmed;
    const input = (planCommandMatch?.[1] ?? rawInput).trim();
    const selectedModel = activeComposerModelOption === null ? null : activeComposerModel;
    const ensurePlanMode = async (sessionId: string): Promise<string> => {
      let targetSessionId = sessionId;
      let detail: AgentSessionDetail | null = null;
      try {
        detail = await agentApi.enterPlanMode({ sessionId: targetSessionId });
      } catch (error) {
        if (!isSessionNotFoundError(error)) {
          throw error;
        }
        const created = await agentApi.createSession({
          title: newSessionTitle,
          ...(selectedComposerProfileId === null
            ? {}
            : { profileId: selectedComposerProfileId }),
        });
        if (selectedModel !== null) {
          setSelectedModelBySession((current) => ({
            ...current,
            [created.id]: selectedModel,
          }));
        }
        targetSessionId = created.id;
        detail = await agentApi.enterPlanMode({ sessionId: targetSessionId });
      }
      setActiveSessionId(detail.session.id);
      setActiveDetail(detail);
      await loadSessions();
      return detail.session.id;
    };
    if (input.length === 0 || isSending) {
      if (planCommandMatch !== null) {
        setIsSending(true);
        try {
          await ensurePlanMode(activeSessionId);
          setDraftInput("");
        } catch (error) {
          setRuntimeError(error instanceof Error ? error.message : String(error));
        } finally {
          setIsSending(false);
        }
      }
      return;
    }

    const boundProjectRoot =
      trimOptionalText(boundProjectPathBySession[activeSessionId])
      ?? trimOptionalText(activeDetail?.session.projectRoot);

    setIsSending(true);
    setIsInteractionSubmitting(false);
    setRuntimeError(null);
    setFinalizingTurnId(null);
    const optimisticMessage: OptimisticUserMessage = {
      id: `optimistic-user-${String(Date.now())}`,
      role: "user",
      content: input,
      createdAt: Date.now(),
      optimistic: true,
    };
    setOptimisticUserMessages((current) => [...current, optimisticMessage].slice(-2));
    setDraftInput("");

    let stopPendingInteractionPolling = () => {};
    const restartPendingInteractionPolling = (sessionId: string): void => {
      stopPendingInteractionPolling();
      stopPendingInteractionPolling = startPendingInteractionPolling(sessionId);
    };

    try {
      let targetSessionId = activeSessionId;
      if (enteringPlanMode || activeDetail?.session.collaborationMode === "plan") {
        targetSessionId = await ensurePlanMode(targetSessionId);
      }
      restartPendingInteractionPolling(targetSessionId);
      const buildRequest = (sessionId: string) => ({
        sessionId,
        input,
        ...(boundProjectRoot === null ? {} : { projectRoot: boundProjectRoot }),
        ...(selectedComposerProfileId === null ? {} : { profileId: selectedComposerProfileId }),
        ...(selectedModel === null ? {} : { model: selectedModel }),
        enablePlanning: true,
        enableReflection: false,
        reflectionMinToolCalls: 3,
        enableContextCollapse: true,
      });
      try {
        const result = await agentApi.sendTurn(buildRequest(targetSessionId));
        applySendTurnResult(result);
      } catch (error) {
        if (!isSessionNotFoundError(error)) {
          stopPendingInteractionPolling();
          throw error;
        }
        const created = await agentApi.createSession({
          title: newSessionTitle,
          ...(selectedComposerProfileId === null
            ? {}
            : { profileId: selectedComposerProfileId }),
        });
        if (selectedModel !== null) {
          setSelectedModelBySession((current) => ({
            ...current,
            [created.id]: selectedModel,
          }));
        }
        targetSessionId = created.id;
        setActiveSessionId(created.id);
        if (boundProjectRoot !== null) {
          setBoundProjectPathBySession((current) => ({
            ...current,
            [created.id]: boundProjectRoot,
          }));
        }
        restartPendingInteractionPolling(targetSessionId);
        const result = await agentApi.sendTurn(buildRequest(targetSessionId));
        applySendTurnResult(result);
      }
      stopPendingInteractionPolling();
      await loadSessionDetail(targetSessionId);
      await loadSessions();
      setOptimisticUserMessages([]);
    } catch (error) {
      stopPendingInteractionPolling();
      setDraftInput(input);
      setOptimisticUserMessages([]);
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      stopPendingInteractionPolling();
      setIsSending(false);
    }
  }, [
    activeSessionId,
    activeDetail?.session.collaborationMode,
    activeDetail?.session.projectRoot,
    activeComposerModel,
    activeComposerModelOption,
    agentApi,
    boundProjectPathBySession,
    draftInput,
    isPlanModeArmed,
    isSending,
    loadSessionDetail,
    loadSessions,
    newSessionTitle,
    selectedComposerProfileId,
    setActiveDetail,
    setActiveSessionId,
    setBoundProjectPathBySession,
    setDraftInput,
    setFinalizingTurnId,
    setIsInteractionSubmitting,
    setIsSending,
    setOptimisticUserMessages,
    setRuntimeError,
    setSelectedModelBySession,
    startPendingInteractionPolling,
    applySendTurnResult,
  ]);

  return {
    sendTurn,
  };
};
