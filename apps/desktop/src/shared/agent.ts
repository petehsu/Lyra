export type AgentSessionId = string;
export type AgentTurnId = string;
export type AgentMessageId = string;
export type AgentToolCallId = string;
export type AgentCollaborationMode = "default" | "plan";
export type AgentPlanStatus = "draft" | "proposed" | "approved" | "rejected";

export type AgentPlanBlock = {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
};

export type AgentPlanArtifact = {
  readonly planId: string;
  readonly status: AgentPlanStatus;
  readonly title: string;
  readonly summary: string;
  readonly objective: string;
  readonly assumptions: readonly AgentPlanBlock[];
  readonly steps: readonly AgentPlanBlock[];
  readonly interfaces: readonly AgentPlanBlock[];
  readonly risks: readonly AgentPlanBlock[];
  readonly tests: readonly AgentPlanBlock[];
  readonly acceptanceCriteria: readonly AgentPlanBlock[];
};

export type PlanAnnotation = {
  readonly blockId?: string;
  readonly anchor: string;
  readonly comment: string;
};

export type AgentUsage = {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly totalTokens?: number;
  readonly modelContextWindow?: number;
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

export type AgentPendingInteractionKind =
  | "command_execution_approval"
  | "file_change_approval"
  | "permissions_approval"
  | "plan_approval"
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

export type AgentMessageContentPart =
  | {
    readonly type: "text";
    readonly text: string;
  }
  | {
    readonly type: "attachment";
    readonly name: string;
    readonly path: string;
    readonly kind?: "file" | "directory" | "local_image" | "image";
  };

export type AgentMessage = {
  readonly id: AgentMessageId;
  readonly sessionId: AgentSessionId;
  readonly turnId?: AgentTurnId;
  readonly role: AgentMessageRole | string;
  readonly content: string;
  readonly contentParts?: readonly AgentMessageContentPart[];
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
  readonly pendingInteractions: readonly AgentPendingInteraction[];
  readonly turns: readonly AgentTurn[];
  readonly messages: readonly AgentMessage[];
  readonly toolCalls: readonly AgentToolCall[];
  readonly runtimeEvents: readonly AgentRuntimeEvent[];
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
  readonly isSecret?: boolean;
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

export type PlanApprovalDecision = "approve_and_implement" | "keep_planning" | "reject";

export type PlanApprovalRequest = {
  readonly id: string;
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly planId: string;
  readonly version: number;
  readonly status: AgentPlanStatus;
  readonly summary: string;
  readonly artifact: AgentPlanArtifact;
  readonly annotations?: readonly PlanAnnotation[];
};

export type PlanInteractionResponse = {
  readonly planId: string;
  readonly decision: PlanApprovalDecision;
  readonly feedback?: string;
  readonly annotations?: readonly PlanAnnotation[];
  readonly artifactSnapshot?: AgentPlanArtifact;
};

export type AgentToolOwner = "agent_core" | "lyra";

export type AgentRuntimeEvent = {
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly phase: string;
  readonly payload: unknown;
  readonly timestamp: number;
  readonly toolOwner?: AgentToolOwner;
};
