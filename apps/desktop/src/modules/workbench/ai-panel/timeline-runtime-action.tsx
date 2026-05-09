import { CircleDashed } from "lucide-react";
import type { ReactNode } from "react";

import { ClarificationList } from "./clarification-list";
import { DeliveryStatusRow } from "./delivery-status-row";
import { LiveDiffPreview } from "./diff-preview";
import type {
  AgentExecuteMessageRollbackRequest,
  AgentExecuteMessageRollbackResult,
  AgentResolveApprovalRequest,
  AgentResolveApprovalResult,
  AgentResolveClarificationRequest,
  AgentResolveClarificationResult,
  AgentResolvePlanReviewRequest,
  AgentResolvePlanReviewResult,
  AgentSessionDetail,
} from "./agent-ui-types";
import { hasPendingClarification } from "./clarification-model";
import { activeLiveDraft } from "./live-draft-model";
import { LiveDraftStatusRow } from "./live-draft-status-row";
import { PendingApprovalList, hasPendingApprovalRows } from "./pending-approval-list";
import { AiPlanReviewSurface } from "./plan-review-surface";
import { RollbackPreviewRow } from "./rollback-preview-row";
import { activeRollbackPreview } from "./rollback-preview-model";
import { createSecurityStatusModel } from "./security-status-model";
import { SecurityStatusRow } from "./security-status-row";
import { VerificationSummaryList } from "./verification-summary-list";

export type TimelineRuntimeActionKind =
  | "clarification"
  | "approval"
  | "planReview"
  | "security"
  | "verification"
  | "delivery"
  | "liveDiff"
  | "liveDraft"
  | "rollback";

export type TimelineRuntimeActionItem = {
  readonly kind: "runtimeAction";
  readonly id: string;
  readonly createdAt: number;
  readonly actionKind: TimelineRuntimeActionKind;
};

type TimelineRuntimeActionProps = {
  readonly actionKind: TimelineRuntimeActionKind;
  readonly detail: AgentSessionDetail | null;
  readonly resolveClarification?:
    | ((request: AgentResolveClarificationRequest) => Promise<AgentResolveClarificationResult>)
    | undefined;
  readonly resolveApproval?:
    | ((request: AgentResolveApprovalRequest) => Promise<AgentResolveApprovalResult>)
    | undefined;
  readonly resolvePlanReview?:
    | ((request: AgentResolvePlanReviewRequest) => Promise<AgentResolvePlanReviewResult>)
    | undefined;
  readonly executeMessageRollback?:
    | ((request: AgentExecuteMessageRollbackRequest) => Promise<AgentExecuteMessageRollbackResult>)
    | undefined;
  readonly onClarificationResolved?: (() => Promise<void> | void) | undefined;
  readonly onRollbackExecuted?: (() => Promise<void> | void) | undefined;
};

export const buildTimelineRuntimeActionItems = (
  detail: AgentSessionDetail | null
): readonly TimelineRuntimeActionItem[] => {
  if (detail === null) {
    return [];
  }
  const items: TimelineRuntimeActionItem[] = [];
  const clarificationAt = firstPendingInteractionAt(detail, "clarification");
  if (clarificationAt !== null && hasPendingClarification(detail)) {
    items.push({
      kind: "runtimeAction",
      id: "runtime-action:clarification",
      createdAt: clarificationAt,
      actionKind: "clarification",
    });
  }

  const approvalAt = firstPendingInteractionAt(detail, "tool_approval");
  if (approvalAt !== null && hasPendingApprovalRows(detail)) {
    items.push({
      kind: "runtimeAction",
      id: "runtime-action:approval",
      createdAt: approvalAt,
      actionKind: "approval",
    });
  }

  const plan = detail.planningSummary ?? null;
  if (plan !== null) {
    items.push({
      kind: "runtimeAction",
      id: `runtime-action:plan-review:${plan.planId}:${plan.activeVersionId}`,
      createdAt: plan.createdAt,
      actionKind: "planReview",
    });
  }

  const securityAt = securityNeedsAttentionAt(detail);
  if (securityAt !== null) {
    items.push({
      kind: "runtimeAction",
      id: "runtime-action:security",
      createdAt: securityAt,
      actionKind: "security",
    });
  }

  const verificationAt = verificationNeedsAttentionAt(detail);
  if (verificationAt !== null) {
    items.push({
      kind: "runtimeAction",
      id: "runtime-action:verification",
      createdAt: verificationAt,
      actionKind: "verification",
    });
  }

  const deliveryAt = deliveryNeedsAttentionAt(detail);
  if (deliveryAt !== null) {
    items.push({
      kind: "runtimeAction",
      id: "runtime-action:delivery",
      createdAt: deliveryAt,
      actionKind: "delivery",
    });
  }

  const liveDiffAt = latestLiveDiffEventAt(detail);
  if (liveDiffAt !== null) {
    items.push({
      kind: "runtimeAction",
      id: "runtime-action:live-diff",
      createdAt: liveDiffAt,
      actionKind: "liveDiff",
    });
  }

  const liveDraft = activeLiveDraft(detail.followSummary);
  if (liveDraft !== null) {
    items.push({
      kind: "runtimeAction",
      id: `runtime-action:live-draft:${liveDraft.liveEditId}`,
      createdAt: liveDraft.updatedAt,
      actionKind: "liveDraft",
    });
  }

  const rollbackPreview = activeRollbackPreview(detail.recoverySummary);
  if (rollbackPreview !== null) {
    items.push({
      kind: "runtimeAction",
      id: `runtime-action:rollback:${rollbackPreview.rollbackId}`,
      createdAt: rollbackPreview.updatedAt,
      actionKind: "rollback",
    });
  }

  return items;
};

export const TimelineRuntimeAction = ({
  actionKind,
  detail,
  resolveClarification,
  resolveApproval,
  resolvePlanReview,
  executeMessageRollback,
  onClarificationResolved,
  onRollbackExecuted,
}: TimelineRuntimeActionProps) => {
  const content = runtimeActionContent({
    actionKind,
    detail,
    resolveClarification,
    resolveApproval,
    resolvePlanReview,
    executeMessageRollback,
    onClarificationResolved,
    onRollbackExecuted,
  });
  if (content === null) {
    return null;
  }
  return (
    <div className="lyra-ai-agent-timeline-event" data-kind={actionKind}>
      <span className="lyra-ai-agent-timeline-event-marker" aria-hidden="true">
        <CircleDashed size={10} />
      </span>
      <div className="lyra-ai-agent-timeline-event-body">
        {content}
      </div>
    </div>
  );
};

const runtimeActionContent = ({
  actionKind,
  detail,
  resolveClarification,
  resolveApproval,
  resolvePlanReview,
  executeMessageRollback,
  onClarificationResolved,
  onRollbackExecuted,
}: TimelineRuntimeActionProps): ReactNode | null => {
  switch (actionKind) {
    case "clarification":
      return (
        <ClarificationList
          detail={detail}
          resolveClarification={resolveClarification}
          onResolved={onClarificationResolved}
        />
      );
    case "approval":
      return (
        <PendingApprovalList
          detail={detail}
          resolveApproval={resolveApproval}
        />
      );
    case "planReview":
      return (
        <AiPlanReviewSurface
          detail={detail}
          resolvePlanReview={resolvePlanReview}
        />
      );
    case "security":
      return (
        <SecurityStatusRow
          detail={detail}
          visibleKinds={["blocked", "approval_required"]}
        />
      );
    case "verification":
      return <VerificationSummaryList detail={detail} onlyNeedsAttention />;
    case "delivery":
      return <DeliveryStatusRow detail={detail} onlyNeedsAttention />;
    case "liveDiff":
      return <LiveDiffPreview events={detail?.runtimeEvents ?? []} />;
    case "liveDraft":
      return <LiveDraftStatusRow detail={detail} />;
    case "rollback":
      return (
        <RollbackPreviewRow
          detail={detail}
          executeMessageRollback={executeMessageRollback}
          onExecuteComplete={onRollbackExecuted}
        />
      );
    default:
      return null;
  }
};

const firstPendingInteractionAt = (
  detail: AgentSessionDetail,
  kind: string
): number | null => {
  const matching = detail.pendingInteractions.filter((interaction) =>
    interaction.kind === kind && interaction.status === "pending"
  );
  if (matching.length === 0) {
    return null;
  }
  return Math.min(...matching.map((interaction) => interaction.createdAt));
};

const securityNeedsAttentionAt = (detail: AgentSessionDetail): number | null => {
  const model = createSecurityStatusModel(detail);
  if (model === null || (model.kind !== "blocked" && model.kind !== "approval_required")) {
    return null;
  }
  const decisionAt = detail.securitySummary?.recentDecisions.at(-1)?.createdAt;
  return decisionAt ?? detail.session.updatedAt;
};

const verificationNeedsAttentionAt = (detail: AgentSessionDetail): number | null => {
  const summary = detail.verificationSummary ?? null;
  if (summary === null) {
    return null;
  }
  return summary.runs.some((run) =>
    run.status === "failed" || run.status === "blocked" || run.status === "not_run"
  )
    ? summary.updatedAt
    : null;
};

const deliveryNeedsAttentionAt = (detail: AgentSessionDetail): number | null => {
  const proof = detail.deliveryProof ?? null;
  const audit = detail.completionAudit ?? null;
  const status = proof?.status ?? audit?.status ?? null;
  if (
    status !== "blocked"
    && status !== "failed"
    && status !== "partial"
    && status !== "partial_allowed"
  ) {
    return null;
  }
  return Math.max(proof?.updatedAt ?? 0, audit?.updatedAt ?? 0, detail.session.updatedAt);
};

const latestLiveDiffEventAt = (detail: AgentSessionDetail): number | null => {
  const timestamps = detail.runtimeEvents
    .filter((event) =>
      event.phase === "follow_live_edit_delta"
      || event.phase === "follow_live_edit_finalized"
    )
    .map((event) => event.timestamp);
  if (timestamps.length === 0) {
    return null;
  }
  return Math.max(...timestamps);
};
