export type AgentSessionId = string;
export type AgentTurnId = string;
export type AgentMessageId = string;
export type AgentToolCallId = string;
export type AgentCollaborationMode = "default" | "plan";
export type AgentPlanStatus = "draft" | "submitted" | "approved" | "rejected";

export type AgentUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
};

export type AgentSession = {
  readonly id: AgentSessionId;
  readonly title: string;
  readonly profileId?: string;
  readonly projectRoot?: string;
  readonly projectName?: string;
  readonly collaborationMode: AgentCollaborationMode;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentPlanState = {
  readonly status: AgentPlanStatus;
  readonly version: number;
  readonly draftMarkdown: string;
  readonly proposedMarkdown?: string;
  readonly approvedMarkdown?: string;
  readonly lastSubmittedVersion?: number;
  readonly updatedAt: number;
};

export type AgentPendingInteractionKind =
  | "command_execution_approval"
  | "file_change_approval"
  | "permissions_approval"
  | "tool_user_input"
  | "mcp_elicitation";
export type AgentPendingInteractionStatus = "pending" | "resolved" | "cancelled" | "expired";

export type AgentPendingInteractionPayload = {
  readonly requestId?: string;
  readonly agentCoreMethod?: string;
  readonly raw?: Record<string, unknown>;
  readonly [key: string]: unknown;
};

export type AgentPendingInteraction = {
  readonly id: string;
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly kind: AgentPendingInteractionKind;
  readonly status: AgentPendingInteractionStatus;
  readonly payload: AgentPendingInteractionPayload;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentExecutionPhase =
  | "idle"
  | "running"
  | "waiting_interaction"
  | "resumable"
  | "completed"
  | "failed"
  | "abandoned";

export type AgentExecutionCheckpointKind =
  | "turn_started"
  | "interaction_wait"
  | "interaction_resolved"
  | "turn_completed"
  | "turn_failed"
  | "manual_resume_anchor";

export type AgentGoalStatus = "pending" | "in_progress" | "blocked" | "completed" | "failed";

export type AgentGoalNode = {
  readonly id: string;
  readonly parentId?: string;
  readonly title: string;
  readonly status: AgentGoalStatus;
  readonly progressPercent: number;
  readonly blockingReason?: string;
  readonly updatedAt: number;
};

export type AgentExecutionState = {
  readonly id: string;
  readonly runId: string;
  readonly threadId: string;
  readonly sessionId: AgentSessionId;
  readonly collaborationMode: AgentCollaborationMode;
  readonly phase: AgentExecutionPhase;
  readonly activeTurnId?: AgentTurnId;
  readonly waitingInteractionId?: string;
  readonly waitingInteractionKind?: AgentPendingInteractionKind;
  readonly activeGoalNodeId?: string;
  readonly goalTreeJson: unknown;
  readonly latestCheckpointId?: string;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentExecutionCheckpointSummary = {
  readonly id: string;
  readonly executionId: string;
  readonly threadId: string;
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly kind: AgentExecutionCheckpointKind;
  readonly phaseBefore: AgentExecutionPhase;
  readonly phaseAfter: AgentExecutionPhase;
  readonly createdAt: number;
};

export type AgentTurnStatus = "running" | "completed" | "failed" | "paused";

export type AgentTurn = {
  readonly id: AgentTurnId;
  readonly sessionId: AgentSessionId;
  readonly profileId: string;
  readonly status: AgentTurnStatus;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly usage?: AgentUsage;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentMessageRole = "user" | "assistant";

export type AgentMessage = {
  readonly id: AgentMessageId;
  readonly sessionId: AgentSessionId;
  readonly turnId?: AgentTurnId;
  readonly role: AgentMessageRole | string;
  readonly content: string;
  readonly displayContent?: string;
  readonly createdAt: number;
};

export type AgentToolCallStatus = "running" | "completed" | "failed";

export type AgentToolCall = {
  readonly id: AgentToolCallId;
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly toolName: string;
  readonly input: unknown;
  readonly output?: unknown;
  readonly status: AgentToolCallStatus;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
};

export type AgentSessionDetail = {
  readonly session: AgentSession;
  readonly plan?: AgentPlanState;
  readonly executionState?: AgentExecutionState;
  readonly executionCheckpoints: readonly AgentExecutionCheckpointSummary[];
  readonly pendingInteractions: readonly AgentPendingInteraction[];
  readonly turns: readonly AgentTurn[];
  readonly messages: readonly AgentMessage[];
  readonly toolCalls: readonly AgentToolCall[];
  readonly runtimeEvents: readonly AgentRuntimeEvent[];
};

export type AgentCreateSessionRequest = {
  readonly title?: string;
  readonly profileId?: string;
};

export type AgentGetSessionRequest = {
  readonly sessionId: AgentSessionId;
};

export type AgentDeleteSessionRequest = {
  readonly sessionId: AgentSessionId;
};

export type AgentBindSessionProjectRequest = {
  readonly sessionId: AgentSessionId;
  readonly projectRoot: string;
};

export type AgentSendTurnRequest = {
  readonly sessionId: AgentSessionId;
  readonly input: string;
  readonly profileId?: string;
  readonly model?: string;
  readonly projectRoot?: string;
  readonly maxSteps?: number;
  readonly enablePlanning?: boolean;
  readonly planningMinChars?: number;
  readonly enableReflection?: boolean;
  readonly reflectionMinToolCalls?: number;
  readonly enableContextCollapse?: boolean;
};

export type AgentEnterPlanModeRequest = {
  readonly sessionId: AgentSessionId;
};

export type AgentGetPlanRequest = {
  readonly sessionId: AgentSessionId;
};

export type AgentGetPendingInteractionsRequest = {
  readonly sessionId: AgentSessionId;
};

export type AgentSubmitInteractionRequest = {
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly interactionId: string;
  readonly response: unknown;
};

export type AgentQuestionOption = {
  readonly label: string;
  readonly description: string;
  readonly preview?: string;
};

export type AgentQuestionItem = {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly options: readonly AgentQuestionOption[];
  readonly allowOther?: boolean;
};

export type AgentQuestionRequest = {
  readonly id: string;
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly questions: readonly AgentQuestionItem[];
  readonly allowNote?: boolean;
};

export type PlanQuestionOption = AgentQuestionOption;
export type PlanQuestionItem = AgentQuestionItem;
export type PlanQuestionRequest = AgentQuestionRequest;

export type AgentAnswerQuestionRequest = {
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly requestId: string;
  readonly answers: unknown;
  readonly note?: string;
};

export type PlanQuestionAnswerRequest = AgentAnswerQuestionRequest;
export type AgentAnswerPlanQuestionRequest = AgentAnswerQuestionRequest;

export type PlanApprovalDecision = "approve_and_implement" | "keep_planning" | "reject";

export type PlanApprovalRequest = {
  readonly id: string;
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly version: number;
  readonly status: AgentPlanStatus;
  readonly summary: string;
  readonly proposedMarkdown: string;
  readonly draftMarkdown?: string;
};

export type PlanInteractionResponse = {
  readonly requestId: string;
  readonly decision: PlanApprovalDecision;
  readonly feedback?: string;
};

export type AgentResolvePlanApprovalRequest = {
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly requestId: string;
  readonly decision: PlanApprovalDecision;
  readonly feedback?: string;
};

export type AgentResumeExecutionRequest = {
  readonly sessionId: AgentSessionId;
  readonly checkpointId?: string;
};

export type AiMemoryConfig = {
  readonly version: number;
  readonly defaultContextWindow: number;
  readonly memoryAnalysisProfileId?: string;
  readonly outputReserveMinTokens: number;
  readonly outputReserveMaxTokens: number;
  readonly systemReserveMinTokens: number;
  readonly systemReserveMaxTokens: number;
  readonly sharedInjectionMinTokens: number;
  readonly sharedInjectionMaxTokens: number;
  readonly toolHistoryMinTokens: number;
  readonly toolHistoryMaxTokens: number;
  readonly guardSlackMinTokens: number;
  readonly guardSlackMaxTokens: number;
  readonly liveBudgetCapTokens: number;
  readonly headRatio: number;
  readonly middleRatio: number;
  readonly tailRatio: number;
  readonly trimExtraMinTokens: number;
  readonly trimExtraRatio: number;
  readonly checkpointMinTokens: number;
  readonly checkpointRatio: number;
  readonly syntaxCooldownMs: number;
  readonly checkpointBatchSize: number;
  readonly checkpointCpuBudgetMs: number;
  readonly cutDedupeSimilarityThreshold: number;
  readonly cutsSizeTriggerBytes: number;
  readonly cutsSizeTargetBytes: number;
  readonly sharedClassifyScoreThreshold: number;
  readonly enableModelGuidedCompaction: boolean;
};

export type AgentSendTurnResult = {
  readonly session: AgentSession;
  readonly turn: AgentTurn;
  readonly assistantMessage?: AgentMessage;
  readonly toolCalls: readonly AgentToolCall[];
  readonly usage?: AgentUsage;
};

export type AgentRuntimePhase =
  | "accepted"
  | "started"
  | "assistant_delta"
  | "tool_started"
  | "tool_finished"
  | "paused"
  | "completed"
  | "failed"
  | "command_approval_request"
  | "memory_trimmed"
  | "memory_shared_updated"
  | "memory_frozen_updated"
  | "memory_prompt_cache_updated"
  | "plan_mode_entered"
  | "plan_mode_reentered"
  | "plan_draft_updated"
  | "plan_question_requested"
  | "plan_question_answered"
  | "plan_approval_requested"
  | "plan_approved"
  | "plan_rejected"
  | "plan_mode_exited"
  | "interaction_pending"
  | "interaction_submitted"
  | "interaction_resolved"
  | "interaction_queue_updated"
  | "execution_state_transition"
  | "execution_checkpoint_saved"
  | "execution_resume_triggered"
  | "execution_conflict_prompted"
  | "execution_abandoned"
  | "goal_tree_updated";

export type AgentToolOwner = "agent_core" | "lyra";

export type AgentInteractionKind =
  | "command_execution_approval"
  | "file_change_approval"
  | "permissions_approval"
  | "tool_user_input"
  | "mcp_elicitation";

export type AgentInteractionSubmittedPayload = {
  readonly requestId?: string;
  readonly toolCallId?: string;
  readonly interactionKind: AgentInteractionKind;
  readonly decision?: string;
  readonly feedback?: string;
};

type AgentRuntimeEventBase<Phase extends string, Payload> = {
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly phase: Phase;
  readonly payload: Payload;
  readonly timestamp: number;
  readonly toolOwner?: AgentToolOwner;
};

export type AgentRuntimeEvent =
  | AgentRuntimeEventBase<"interaction_submitted", AgentInteractionSubmittedPayload>
  | AgentRuntimeEventBase<Exclude<AgentRuntimePhase, "interaction_submitted">, unknown>
  | AgentRuntimeEventBase<string, unknown>;

export type CommandApprovalDecision = "allow_once" | "allow_always" | "deny";

export type CommandApprovalSubmitRequest = {
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly toolCallId: string;
  readonly decision: CommandApprovalDecision;
};
