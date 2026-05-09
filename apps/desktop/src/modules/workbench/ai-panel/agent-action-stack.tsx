import { ClarificationList } from "./clarification-list";
import { DeliveryStatusRow } from "./delivery-status-row";
import { LiveDiffPreview } from "./diff-preview";
import { LiveDraftStatusRow } from "./live-draft-status-row";
import { PendingApprovalList } from "./pending-approval-list";
import { AiPlanReviewSurface } from "./plan-review-surface";
import { PatchReviewStrip } from "./patch-review-strip";
import { RollbackPreviewRow } from "./rollback-preview-row";
import { SecurityStatusRow } from "./security-status-row";
import { VerificationSummaryList } from "./verification-summary-list";
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

type AgentActionStackProps = {
  readonly detail: AgentSessionDetail | null;
  readonly expandedPatchKey: string | null;
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
  readonly onPatchSelect: (key: string | null) => void;
};

export const AgentActionStack = ({
  detail,
  expandedPatchKey,
  resolveClarification,
  resolveApproval,
  resolvePlanReview,
  executeMessageRollback,
  onClarificationResolved,
  onRollbackExecuted,
  onPatchSelect,
}: AgentActionStackProps) => (
  <div className="lyra-ai-agent-action-stack" aria-label="Agent actions">
    <ClarificationList
      detail={detail}
      resolveClarification={resolveClarification}
      onResolved={onClarificationResolved}
    />
    <PendingApprovalList
      detail={detail}
      resolveApproval={resolveApproval}
    />
    <AiPlanReviewSurface
      detail={detail}
      resolvePlanReview={resolvePlanReview}
    />
    <SecurityStatusRow
      detail={detail}
      visibleKinds={["blocked", "approval_required"]}
    />
    <VerificationSummaryList detail={detail} onlyNeedsAttention />
    <DeliveryStatusRow detail={detail} onlyNeedsAttention />
    <LiveDiffPreview events={detail?.runtimeEvents ?? []} />
    <LiveDraftStatusRow detail={detail} />
    <RollbackPreviewRow
      detail={detail}
      executeMessageRollback={executeMessageRollback}
      onExecuteComplete={onRollbackExecuted}
    />
    <PatchReviewStrip
      detail={detail}
      expandedPatchKey={expandedPatchKey}
      onSelectPatch={onPatchSelect}
    />
  </div>
);
