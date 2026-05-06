export type AgentSessionId = string;
export type AgentTurnId = string;
export type AgentMessageId = string;
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
  | "plan_approval"
  | "agent_question"
  | "mcp_elicitation"
  | "tool_approval";
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

export type AgentTurnStatus = "running" | "completed" | "failed" | "paused" | "cancelled";

export type AgentTurn = {
  readonly id: AgentTurnId;
  readonly sessionId: AgentSessionId;
  readonly profileId: string;
  readonly status: AgentTurnStatus;
  readonly collaborationMode?: AgentCollaborationMode;
  readonly permissionMode?: "sandbox" | "full_access" | string;
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
    readonly kind?: "file" | "directory" | "local_image" | "image" | "workbench_tab" | "ai_thread";
    readonly text?: string;
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

export type AgentRuntimeEvent = {
  readonly sessionId: AgentSessionId;
  readonly turnId: AgentTurnId;
  readonly phase: string;
  readonly payload: unknown;
  readonly timestamp: number;
};

export type AgentTodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped"
  | "active"
  | "running"
  | string;

export type AgentTodoItem = {
  readonly todoItemId: string;
  readonly todoListId: string;
  readonly status: AgentTodoStatus;
  readonly title: string;
  readonly actions: readonly string[];
  readonly expectedTools: readonly string[];
  readonly riskLevel: string;
  readonly completionCriteria: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly blockers: unknown;
  readonly source: unknown;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentExecutionTodoList = {
  readonly todoListId: string;
  readonly sessionId: AgentSessionId;
  readonly runtimeTurnId?: AgentTurnId;
  readonly kind: "mini" | "plan_bound" | "recovery" | string;
  readonly status: AgentTodoStatus;
  readonly title: string;
  readonly source: unknown;
  readonly items: readonly AgentTodoItem[];
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentExecutionSummary = {
  readonly executionRunId: string;
  readonly sessionId: AgentSessionId;
  readonly runtimeTurnId?: AgentTurnId;
  readonly todoListId: string;
  readonly status: AgentTodoStatus;
  readonly stepCount: number;
  readonly completedStepCount: number;
  readonly failedStepCount: number;
  readonly blockedStepCount: number;
  readonly updatedAt: number;
};

export type AgentSessionDetail = {
  readonly session: AgentSession;
  readonly pendingInteractions: readonly AgentPendingInteraction[];
  readonly turns: readonly AgentTurn[];
  readonly messages: readonly AgentMessage[];
  readonly runtimeEvents: readonly AgentRuntimeEvent[];
  readonly activeTodo?: AgentExecutionTodoList | null;
  readonly executionSummary?: AgentExecutionSummary | null;
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
  readonly reason?: string;
  readonly source?: {
    readonly agentThreadId?: string;
    readonly agentNickname?: string;
    readonly agentRole?: string;
  };
  readonly questions: readonly AgentQuestionItem[];
  readonly allowNote?: boolean;
};

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

export type AgentRuntimeTurnAttachment = {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory" | "local_image" | "image" | "workbench_tab" | "ai_thread";
  readonly contextText?: string;
};

export type AgentRuntimeTurnInputPart =
  | {
    readonly type: "text";
    readonly text: string;
  }
  | {
    readonly type: "attachment";
    readonly attachment: AgentRuntimeTurnAttachment;
  };

export type AgentRuntimeTurnInput = {
  readonly text: string;
  readonly attachments: readonly AgentRuntimeTurnAttachment[];
  readonly parts?: readonly AgentRuntimeTurnInputPart[];
};

export type AgentRuntimeThreadOptions = {
  readonly profileId?: string;
  readonly model?: string;
  readonly modelProvider?: string | null;
  readonly cwd?: string | null;
  readonly collaborationMode?: AgentCollaborationMode;
  readonly effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly verbosity?: "low" | "medium" | "high";
  readonly approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
  readonly approvalsReviewer?: "user" | "auto_review";
  readonly permissionMode?: "sandbox" | "full_access";
};

export type AgentCreateSessionRequest = {
  readonly title?: string;
  readonly profileId?: string;
  readonly projectRoot?: string | null;
  readonly cwd?: string | null;
  readonly collaborationMode?: AgentCollaborationMode;
};

export type AgentReadSessionRequest = {
  readonly sessionId: string;
};

export type AgentUpdateSessionRequest = {
  readonly sessionId: string;
  readonly title?: string;
  readonly projectRoot?: string | null;
  readonly collaborationMode?: AgentCollaborationMode;
};

export type AgentSendTurnRequest = {
  readonly sessionId?: string | null;
  readonly input: AgentRuntimeTurnInput;
  readonly options?: AgentRuntimeThreadOptions;
};

export type AgentSendTurnResult = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly detail: AgentSessionDetail;
};

export type AgentCancelTurnRequest = {
  readonly sessionId: string;
  readonly turnId: string;
};

export type AgentCancelTurnResult = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly cancelled: boolean;
};

export type AgentCreateTodoItemInput = {
  readonly title: string;
  readonly actions?: readonly string[];
  readonly expectedTools?: readonly string[];
  readonly riskLevel?: string;
  readonly completionCriteria?: readonly string[];
  readonly source?: unknown;
};

export type AgentCreateTodoRequest = {
  readonly sessionId: string;
  readonly kind: "mini" | "plan_bound" | "recovery" | string;
  readonly title: string;
  readonly source?: unknown;
  readonly items: readonly AgentCreateTodoItemInput[];
};

export type AgentCreateTodoResult = {
  readonly sessionId: string;
  readonly todoListId: string;
  readonly executionRunId: string;
  readonly detail: AgentSessionDetail;
};

export type AgentReadArtifactRequest = {
  readonly sessionId: string;
  readonly artifactId?: string;
  readonly patchRef?: string;
};

export type AgentApplyPatchRequest = {
  readonly sessionId: string;
  readonly artifactId?: string;
  readonly patchRef?: string;
  readonly permissionMode?: "sandbox" | "full_access";
};

export type AgentResolveApprovalDecision = "approve" | "deny";

export type AgentResolveApprovalRequest = {
  readonly sessionId: string;
  readonly approvalTicketId: string;
  readonly decision: AgentResolveApprovalDecision;
};

export type AgentPatchChangedFile = {
  readonly path: string;
  readonly changeType: "created" | "modified" | "deleted" | string;
  readonly additions: number;
  readonly deletions: number;
};

export type AgentArtifactContent = {
  readonly kind: "diff" | string;
  readonly artifactId: string;
  readonly evidenceId?: string;
  readonly patchRef: string;
  readonly title: string;
  readonly content: string;
  readonly contentSha256: string;
  readonly contentBytes: number;
  readonly changedFiles: readonly AgentPatchChangedFile[];
  readonly approvalPreview?: unknown;
  readonly createdAt: number;
};

export type AgentApplyPatchResult = {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly status: string;
  readonly detail: string;
  readonly approvalTicketId: string;
  readonly artifactId: string;
  readonly evidenceId: string;
  readonly patchRef: string;
  readonly changedFiles: readonly AgentPatchChangedFile[];
};

export type AgentResolveApprovalResult = {
  readonly sessionId: string;
  readonly approvalTicketId: string;
  readonly status: string;
  readonly detail: string;
  readonly toolPath: string;
  readonly artifactId?: string;
  readonly evidenceId?: string;
  readonly patchRef?: string;
  readonly changedFiles: readonly AgentPatchChangedFile[];
};

export type AgentRuntimeEventType =
  | "session_updated"
  | "runtime_turn_created"
  | "model_text_delta"
  | "model_message_end"
  | "runtime_turn_completed"
  | "runtime_turn_cancelled"
  | "runtime_error"
  | "runtime_state_changed"
  | "tool_operation_requested"
  | "tool_operation_started"
  | "tool_operation_completed"
  | "tool_operation_failed"
  | "approval_ticket_resolved"
  | "todo_list_created"
  | "todo_item_updated"
  | "execution_step_updated";

export type AgentRuntimeStreamEvent = {
  readonly schemaVersion: "v1" | string;
  readonly eventId: string;
  readonly sequence: number;
  readonly sessionId: string;
  readonly runtimeTurnId?: string;
  readonly eventType: AgentRuntimeEventType | string;
  readonly payload: unknown;
  readonly createdAt: string;
};
