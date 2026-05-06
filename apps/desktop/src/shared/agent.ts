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

export type AgentLongWorkStatus =
  | "created"
  | "running"
  | "auto_resuming"
  | "blocked"
  | "stuck"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

export type AgentLongWorkTodoProgress = {
  readonly total: number;
  readonly completed: number;
  readonly blocked: number;
  readonly failed: number;
};

export type AgentWorkSliceSummary = {
  readonly workSliceId: string;
  readonly status: AgentLongWorkStatus;
  readonly sequence?: number;
  readonly todoListId: string;
  readonly executionRunId: string;
  readonly stopCause?: string;
  readonly checkpointIds: readonly string[];
  readonly blockerIds: readonly string[];
  readonly progressDelta?: unknown;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly closedAt?: number;
};

export type AgentLongWorkContinuationSummary = {
  readonly continuationId: string;
  readonly status: "queued" | "resuming" | "consumed" | "blocked" | "cancelled" | string;
  readonly recommendedAction: string;
  readonly previousSliceId: string;
  readonly nextSliceSequence: number;
  readonly reasonSummary?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentPrematureStopSummary = {
  readonly reportId: string;
  readonly isPrematureStop: boolean;
  readonly signals: readonly string[];
  readonly openTodoItemIds: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly recommendedAction: string;
  readonly suppressedMessageId?: string;
  readonly createdAt: number;
};

export type AgentStuckSummary = {
  readonly stuckReportId: string;
  readonly repeatedFailureCount: number;
  readonly noProgressSliceCount: number;
  readonly suspectedCause: string;
  readonly recommendedAction: string;
  readonly evidenceRefs: readonly string[];
  readonly reasonSummary?: string;
  readonly createdAt: number;
};

export type AgentLongWorkSummary = {
  readonly longWorkRunId: string;
  readonly goalId: string;
  readonly sessionId: AgentSessionId;
  readonly runtimeTurnId?: AgentTurnId;
  readonly userMessageId?: AgentMessageId;
  readonly planId?: string;
  readonly todoListId: string;
  readonly executionRunId: string;
  readonly status: AgentLongWorkStatus;
  readonly objectiveSummary: string;
  readonly todoProgress: AgentLongWorkTodoProgress;
  readonly blockerSummary?: string;
  readonly currentSlice?: AgentWorkSliceSummary;
  readonly continuation?: AgentLongWorkContinuationSummary | null;
  readonly prematureStop?: AgentPrematureStopSummary | null;
  readonly stuck?: AgentStuckSummary | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentFollowStatus =
  | "enabled"
  | "auto_following"
  | "paused_by_user"
  | "pinned_target"
  | "detached_view"
  | "closed"
  | "superseded_by_rollback"
  | string;

export type AgentFollowTargetSummary = {
  readonly followTargetId: string;
  readonly kind: string;
  readonly title: string;
  readonly resourceRef?: string;
  readonly workspaceUri?: string;
  readonly status: string;
  readonly toolOperationId?: string;
  readonly artifactRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly updatedAt: number;
};

export type AgentFollowEventSummary = {
  readonly followEventId: string;
  readonly followTargetId?: string;
  readonly eventType: string;
  readonly label: string;
  readonly status?: string;
  readonly createdAt: number;
};

export type AgentFollowSummary = {
  readonly followSessionId: string;
  readonly sessionId: AgentSessionId;
  readonly runtimeTurnId?: AgentTurnId;
  readonly longWorkRunId?: string;
  readonly status: AgentFollowStatus;
  readonly activeTargetId?: string;
  readonly activeTarget?: AgentFollowTargetSummary | null;
  readonly targets: readonly AgentFollowTargetSummary[];
  readonly recentEvents: readonly AgentFollowEventSummary[];
  readonly updatedAt: number;
};

export type AgentVerificationRunSummary = {
  readonly verificationRunId: string;
  readonly verificationPlanId?: string;
  readonly executionRunId?: string;
  readonly runtimeTurnId?: AgentTurnId;
  readonly kind: string;
  readonly status: "pending" | "running" | "passed" | "failed" | "blocked" | "not_run" | string;
  readonly command?: string;
  readonly cwd?: string;
  readonly exitCode?: number;
  readonly artifactId?: string;
  readonly evidenceRefs: readonly string[];
  readonly skipReason?: string;
  readonly residualRisk: unknown;
  readonly updatedAt: number;
};

export type AgentVerificationSummary = {
  readonly verificationPlanId: string;
  readonly sessionId: AgentSessionId;
  readonly runtimeTurnId?: AgentTurnId;
  readonly executionRunId?: string;
  readonly status: "pending" | "running" | "passed" | "failed" | "blocked" | "not_run" | string;
  readonly requiredRunCount: number;
  readonly passedRunCount: number;
  readonly failedRunCount: number;
  readonly blockedRunCount: number;
  readonly notRunCount: number;
  readonly runs: readonly AgentVerificationRunSummary[];
  readonly updatedAt: number;
};

export type AgentDeliveryProofSummary = {
  readonly deliveryProofId: string;
  readonly sessionId: AgentSessionId;
  readonly runtimeTurnId?: AgentTurnId;
  readonly executionRunId?: string;
  readonly status: "ready" | "partial" | "pending_verification" | "blocked" | "failed" | string;
  readonly verificationRunIds: readonly string[];
  readonly completionAuditId?: string;
  readonly artifactRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly unresolvedRisks: unknown;
  readonly summary: string;
  readonly updatedAt: number;
};

export type AgentCompletionAuditSummary = {
  readonly completionAuditId: string;
  readonly sessionId: AgentSessionId;
  readonly runtimeTurnId?: AgentTurnId;
  readonly executionRunId?: string;
  readonly status: "passed" | "partial_allowed" | "blocked" | "failed" | string;
  readonly missingTodoItemIds: readonly string[];
  readonly missingEvidenceRefs: readonly string[];
  readonly failedVerificationRunIds: readonly string[];
  readonly blockedVerificationRunIds: readonly string[];
  readonly notRunVerificationRunIds: readonly string[];
  readonly pendingApprovalTicketIds: readonly string[];
  readonly residualRisks: unknown;
  readonly summary: string;
  readonly updatedAt: number;
};

export type AgentPlanReviewAnnotationSummary = {
  readonly annotationId: string;
  readonly panelId: string;
  readonly blockId?: string;
  readonly anchor: string;
  readonly note: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentPlanningSummary = {
  readonly planId: string;
  readonly sessionId: AgentSessionId;
  readonly runtimeTurnId?: AgentTurnId;
  readonly status: "pending_review" | "approved" | "rejected" | "superseded" | string;
  readonly title: string;
  readonly objectiveSummary: string;
  readonly source: unknown;
  readonly activeVersionId: string;
  readonly panelId: string;
  readonly panelStatus: "pending_review" | "approved" | "rejected" | "superseded" | string;
  readonly versionNumber: number;
  readonly version: unknown;
  readonly annotations: readonly AgentPlanReviewAnnotationSummary[];
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentPlanCoverageSummary = {
  readonly coverageId: string;
  readonly sessionId: AgentSessionId;
  readonly runtimeTurnId?: AgentTurnId;
  readonly planId: string;
  readonly approvedVersionId: string;
  readonly todoListId?: string;
  readonly executionRunId?: string;
  readonly status:
    | "valid"
    | "missing_plan_step"
    | "extra_scope"
    | "risk_mismatch"
    | "verification_missing"
    | "reference_missing"
    | "reference_mismatch"
    | string;
  readonly coveredPlanStepIds: readonly string[];
  readonly missingPlanStepIds: readonly string[];
  readonly extraTodoItemIds: readonly string[];
  readonly riskMismatches: readonly unknown[];
  readonly verificationGaps: readonly string[];
  readonly missingReferenceIds: readonly string[];
  readonly mismatchedReferenceIds: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type AgentSessionDetail = {
  readonly session: AgentSession;
  readonly pendingInteractions: readonly AgentPendingInteraction[];
  readonly turns: readonly AgentTurn[];
  readonly messages: readonly AgentMessage[];
  readonly runtimeEvents: readonly AgentRuntimeEvent[];
  readonly planningSummary?: AgentPlanningSummary | null;
  readonly planCoverageSummary?: AgentPlanCoverageSummary | null;
  readonly activeTodo?: AgentExecutionTodoList | null;
  readonly executionSummary?: AgentExecutionSummary | null;
  readonly verificationSummary?: AgentVerificationSummary | null;
  readonly completionAudit?: AgentCompletionAuditSummary | null;
  readonly deliveryProof?: AgentDeliveryProofSummary | null;
  readonly longWorkSummary?: AgentLongWorkSummary | null;
  readonly followSummary?: AgentFollowSummary | null;
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
  readonly followEnabled?: boolean;
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

export type AgentReadFollowRequest = {
  readonly sessionId: string;
};

export type AgentPauseFollowRequest = {
  readonly sessionId: string;
  readonly followSessionId?: string;
};

export type AgentResumeFollowRequest = {
  readonly sessionId: string;
  readonly followSessionId?: string;
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

export type AgentCreatePlanRequest = {
  readonly sessionId: string;
  readonly title: string;
  readonly objectiveSummary: string;
  readonly source?: unknown;
  readonly version: unknown;
};

export type AgentCreatePlanResult = {
  readonly sessionId: string;
  readonly planId: string;
  readonly versionId: string;
  readonly panelId: string;
  readonly detail: AgentSessionDetail;
};

export type AgentResolvePlanReviewDecision = "approve" | "reject" | "annotate";

export type AgentResolvePlanReviewRequest = {
  readonly sessionId: string;
  readonly planId: string;
  readonly versionId: string;
  readonly decision: AgentResolvePlanReviewDecision;
  readonly annotationText?: string;
};

export type AgentResolvePlanReviewResult = {
  readonly sessionId: string;
  readonly planId: string;
  readonly versionId: string;
  readonly status: string;
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
  | "execution_step_updated"
  | "plan_review_created"
  | "plan_review_updated"
  | "todo.plan_coverage_validated"
  | "todo.plan_coverage_failed"
  | "todo.reference_coverage_validated"
  | "todo.reference_coverage_failed"
  | "long_work.created"
  | "long_work.slice_started"
  | "long_work.slice_stopped"
  | "long_work.premature_stop_detected"
  | "long_work.output_suppressed"
  | "long_work.continuation_queued"
  | "long_work.auto_resuming"
  | "long_work.recovery_detected"
  | "long_work.stuck"
  | "long_work.blocked"
  | "long_work.completed"
  | "verification_plan_created"
  | "verification_run_updated"
  | "completion_audit_updated"
  | "delivery_proof_updated";

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
