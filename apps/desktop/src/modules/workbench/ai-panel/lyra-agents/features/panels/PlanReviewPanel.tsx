import { BookText, Eye, Archive, Check } from "lucide-react";
import type {
  AgentPlanReviewRespondAction,
  AgentPlanSnapshot,
  OmaAgentMember
} from "../../../../../../shared/agent";
import { AppButton } from "@renderer/ui/components";
import { t } from "@workbench/i18n";
import { OmaPanelSource } from "./OmaPanelSource";

export function PlanReviewPanel({
  plan,
  onReview,
  onRespond,
  resolveOmaSource
}: {
  plan: AgentPlanSnapshot | null;
  onReview: (plan: AgentPlanSnapshot) => void | Promise<void>;
  onRespond: (action: AgentPlanReviewRespondAction, feedback?: string | null) => void | Promise<void>;
  resolveOmaSource?: (sourceSessionAgentId: string | null | undefined) => OmaAgentMember | undefined;
}) {
  if (plan === null || plan.phase !== "reviewing") return null;

  const summary = plan.review.summary?.trim() || plan.reason?.trim() || t("planReview.ready");
  const primaryAction: AgentPlanReviewRespondAction =
    plan.review.status === "changed" ? "request_revision" : "approve";
  const primaryLabel =
    plan.review.status === "changed" ? t("planReview.revise") : t("planReview.approve");
  const sourceAgent = resolveOmaSource?.(plan.omaSource?.sessionAgentId);

  return (
    <div className="lyra-agents-decision-panel lyra-agents-plan-review-panel">
      <div className="lyra-agents-decision-header">
        <span className="lyra-agents-decision-icon">
          <BookText size={14} strokeWidth={2} />
        </span>
        <div className="lyra-agents-decision-title-block">
          <p className="lyra-agents-decision-question">{plan.title}</p>
          <p className="lyra-agents-decision-detail">{summary}</p>
          <OmaPanelSource agent={sourceAgent} />
        </div>
      </div>
      <div className="lyra-agents-plan-review-actions">
        <AppButton
          variant="ghost"
          size="sm"
          type="button"
          className="lyra-agents-plan-review-btn"
          onClick={() => { void onReview(plan); }}
        >
          <Eye size={13} strokeWidth={2.1} />
          {t("planReview.review")}
        </AppButton>
        <AppButton
          variant="ghost"
          size="sm"
          type="button"
          className="lyra-agents-plan-review-btn lyra-agents-plan-review-btn-set-aside"
          onClick={() => { void onRespond("set_aside"); }}
        >
          <Archive size={13} strokeWidth={2.1} />
          {t("planReview.setAside")}
        </AppButton>
        <AppButton
          variant="ghost"
          size="sm"
          type="button"
          className="lyra-agents-plan-review-btn lyra-agents-plan-review-btn-approve"
          onClick={() => { void onRespond(primaryAction); }}
        >
          <Check size={13} strokeWidth={2.1} />
          {primaryLabel}
        </AppButton>
      </div>
    </div>
  );
}
