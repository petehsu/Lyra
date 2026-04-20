import type { Dispatch, SetStateAction } from "react";

import type { AiProviderProfile } from "../../../shared/ai";
import type {
  AgentApi,
  AgentPendingInteraction,
  AgentSessionDetail,
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
import { useAiPanelBindProject } from "./use-ai-panel-bind-project";
import { useAiPanelInteractionSubmitActions } from "./use-ai-panel-interaction-submit-actions";
import { useAiPanelSendTurn } from "./use-ai-panel-send-turn";
import { useAiPanelSessionLoaders } from "./use-ai-panel-session-loaders";
import type { OptimisticUserMessage } from "./view-helpers";

type UseAiPanelSessionActionsParams = {
  readonly agentApi: AgentApi | undefined;
  readonly desktopApi: LyraDesktopApi | null;
  readonly defaultProfileId?: string | null | undefined;
  readonly newSessionTitle: string;
  readonly activeSessionId: string | null;
  readonly setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  readonly activeDetail: AgentSessionDetail | null;
  readonly setActiveDetail: Dispatch<SetStateAction<AgentSessionDetail | null>>;
  readonly activeInteractionPanel: ActiveInteractionPanel;
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
  readonly setSelectedModelBySession: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  readonly boundProjectPathBySession: Readonly<Record<string, string>>;
  readonly setBoundProjectPathBySession: Dispatch<
    SetStateAction<Readonly<Record<string, string>>>
  >;
  readonly setProfiles: Dispatch<SetStateAction<readonly AiProviderProfile[]>>;
  readonly setIsLoading: Dispatch<SetStateAction<boolean>>;
  readonly setIsSending: Dispatch<SetStateAction<boolean>>;
  readonly setIsInteractionSubmitting: Dispatch<SetStateAction<boolean>>;
  readonly setRuntimeError: Dispatch<SetStateAction<string | null>>;
  readonly setFinalizingTurnId: Dispatch<SetStateAction<string | null>>;
  readonly setOptimisticUserMessages: Dispatch<
    SetStateAction<readonly OptimisticUserMessage[]>
  >;
  readonly mergePendingInteractionsForSession: (
    sessionId: string,
    interactions: readonly AgentPendingInteraction[]
  ) => void;
  readonly startPendingInteractionPolling: (sessionId: string) => () => void;
  readonly onRequestProjectBind?: (currentPath?: string) => Promise<string | null>;
  readonly isBindingProject: boolean;
  readonly setIsBindingProject: Dispatch<SetStateAction<boolean>>;
};

type UseAiPanelSessionActionsResult = {
  readonly loadProfiles: () => Promise<void>;
  readonly loadSessions: () => Promise<void>;
  readonly loadSessionDetail: (sessionId: string) => Promise<void>;
  readonly invalidateSessionDetailRequests: () => void;
  readonly sendTurn: () => Promise<void>;
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
  readonly bindProject: () => Promise<void>;
};

export const useAiPanelSessionActions = ({
  agentApi,
  desktopApi,
  defaultProfileId,
  newSessionTitle,
  activeSessionId,
  setActiveSessionId,
  activeDetail,
  setActiveDetail,
  activeInteractionPanel,
  draftInput,
  setDraftInput,
  isSending,
  isPlanModeArmed,
  activeComposerModel,
  activeComposerModelOption,
  selectedComposerProfileId,
  setSelectedModelBySession,
  boundProjectPathBySession,
  setBoundProjectPathBySession,
  setProfiles,
  setIsLoading,
  setIsSending,
  setIsInteractionSubmitting,
  setRuntimeError,
  setFinalizingTurnId,
  setOptimisticUserMessages,
  mergePendingInteractionsForSession,
  startPendingInteractionPolling,
  onRequestProjectBind,
  isBindingProject,
  setIsBindingProject,
}: UseAiPanelSessionActionsParams): UseAiPanelSessionActionsResult => {
  const {
    loadProfiles,
    loadSessions,
    loadSessionDetail,
    invalidateSessionDetailRequests,
  } = useAiPanelSessionLoaders({
    agentApi,
    desktopApi,
    defaultProfileId,
    newSessionTitle,
    setProfiles,
    setIsLoading,
    setActiveSessionId,
    setActiveDetail,
    setRuntimeError,
    mergePendingInteractionsForSession,
  });

  const { sendTurn } = useAiPanelSendTurn({
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
  });

  const {
    handleApprovalDecision,
    handlePlanQuestionSubmit,
    handlePlanApprovalDecision,
  } = useAiPanelInteractionSubmitActions({
    desktopApi,
    activeInteractionPanel,
    setIsInteractionSubmitting,
    setRuntimeError,
    loadSessionDetail,
    loadSessions,
  });

  const { bindProject } = useAiPanelBindProject({
    agentApi,
    ...(onRequestProjectBind === undefined ? {} : { onRequestProjectBind }),
    isBindingProject,
    setIsBindingProject,
    activeSessionId,
    setActiveSessionId,
    activeDetail,
    activeComposerModel,
    selectedComposerProfileId,
    newSessionTitle,
    boundProjectPathBySession,
    setBoundProjectPathBySession,
    setSelectedModelBySession,
    setRuntimeError,
    loadSessionDetail,
    loadSessions,
  });

  return {
    loadProfiles,
    loadSessions,
    loadSessionDetail,
    invalidateSessionDetailRequests,
    sendTurn,
    handleApprovalDecision,
    handlePlanQuestionSubmit,
    handlePlanApprovalDecision,
    bindProject,
  };
};
