import { useCallback, type Dispatch, type SetStateAction } from "react";

import type {
  AgentSendTurnResult,
  LyraDesktopApi,
  PlanApprovalRequest,
  PlanInteractionResponse,
  PlanQuestionRequest,
} from "../../../shared/desktop-bridge";
import type {
  CommandApprovalRequest,
  CommandApprovalResponse,
} from "../command-approval-bar";
import type { ActiveInteractionPanel } from "./interaction/pending-interaction-mappers";

type UseAiPanelInteractionSubmitActionsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly activeInteractionPanel: ActiveInteractionPanel;
  readonly setIsInteractionSubmitting: Dispatch<SetStateAction<boolean>>;
  readonly setRuntimeError: Dispatch<SetStateAction<string | null>>;
  readonly loadSessionDetail: (sessionId: string) => Promise<void>;
  readonly loadSessions: () => Promise<void>;
};

type UseAiPanelInteractionSubmitActionsResult = {
  readonly handleApprovalDecision: (
    response: CommandApprovalResponse,
    requestOverride?: CommandApprovalRequest
  ) => Promise<void>;
  readonly handlePlanQuestionSubmit: (
    payload: { readonly answers: Record<string, unknown>; readonly note?: string },
    requestOverride?: PlanQuestionRequest
  ) => Promise<void>;
  readonly handlePlanApprovalDecision: (
    response: PlanInteractionResponse,
    requestOverride?: PlanApprovalRequest
  ) => Promise<void>;
};

export const useAiPanelInteractionSubmitActions = ({
  desktopApi,
  activeInteractionPanel,
  setIsInteractionSubmitting,
  setRuntimeError,
  loadSessionDetail,
  loadSessions,
}: UseAiPanelInteractionSubmitActionsParams): UseAiPanelInteractionSubmitActionsResult => {
  const handleApprovalDecision = useCallback(
    async (
      response: CommandApprovalResponse,
      requestOverride?: CommandApprovalRequest
    ) => {
      const request =
        requestOverride
        ?? (activeInteractionPanel?.kind === "commandApproval"
          ? activeInteractionPanel.request
          : null);
      if (desktopApi?.agent?.submitCommandApproval === undefined || request === null) {
        return;
      }
      if (response.requestId !== request.id) {
        return;
      }
      try {
        setIsInteractionSubmitting(true);
        const result = await desktopApi.agent.submitCommandApproval({
          sessionId: request.sessionId,
          turnId: request.turnId,
          toolCallId: request.toolCallId,
          decision: response.decision,
        });
        if (result !== null) {
          await loadSessionDetail(result.session.id);
          await loadSessions();
        }
      } catch (error) {
        setIsInteractionSubmitting(false);
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      activeInteractionPanel,
      desktopApi,
      loadSessionDetail,
      loadSessions,
      setIsInteractionSubmitting,
      setRuntimeError,
    ]
  );

  const handlePlanQuestionSubmit = useCallback(
    async (
      payload: { readonly answers: Record<string, unknown>; readonly note?: string },
      requestOverride?: PlanQuestionRequest
    ) => {
      const request =
        requestOverride
        ?? (activeInteractionPanel?.kind === "planQuestion"
          ? activeInteractionPanel.request
          : null);
      if (
        request === null
        || (
          desktopApi?.agent?.answerQuestion === undefined
          && desktopApi?.agent?.answerPlanQuestion === undefined
        )
      ) {
        return;
      }
      try {
        setIsInteractionSubmitting(true);
        const submit = desktopApi.agent.answerQuestion ?? desktopApi.agent.answerPlanQuestion;
        const result = await submit({
          sessionId: request.sessionId,
          turnId: request.turnId,
          requestId: request.id,
          answers: payload.answers,
          ...(payload.note === undefined ? {} : { note: payload.note }),
        });
        if (result !== null) {
          await loadSessionDetail(result.session.id);
          await loadSessions();
        }
      } catch (error) {
        setIsInteractionSubmitting(false);
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      activeInteractionPanel,
      desktopApi,
      loadSessionDetail,
      loadSessions,
      setIsInteractionSubmitting,
      setRuntimeError,
    ]
  );

  const handlePlanApprovalDecision = useCallback(
    async (
      response: PlanInteractionResponse,
      requestOverride?: PlanApprovalRequest
    ) => {
      const request =
        requestOverride
        ?? (activeInteractionPanel?.kind === "planApproval"
          ? activeInteractionPanel.request
          : null);
      if (desktopApi?.agent?.resolvePlanApproval === undefined || request === null) {
        return;
      }
      if (response.requestId !== request.id) {
        return;
      }
      try {
        setIsInteractionSubmitting(true);
        const result: AgentSendTurnResult | null = await desktopApi.agent.resolvePlanApproval({
          sessionId: request.sessionId,
          turnId: request.turnId,
          requestId: request.id,
          decision: response.decision,
          ...(response.feedback === undefined ? {} : { feedback: response.feedback }),
        });
        if (result !== null) {
          await loadSessionDetail(result.session.id);
          await loadSessions();
        }
      } catch (error) {
        setIsInteractionSubmitting(false);
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      activeInteractionPanel,
      desktopApi,
      loadSessionDetail,
      loadSessions,
      setIsInteractionSubmitting,
      setRuntimeError,
    ]
  );

  return {
    handleApprovalDecision,
    handlePlanQuestionSubmit,
    handlePlanApprovalDecision,
  };
};
