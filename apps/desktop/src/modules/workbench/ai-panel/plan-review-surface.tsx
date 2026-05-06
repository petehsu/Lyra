import { Check, ClipboardList, Loader2, MessageSquare, X } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  AgentPlanCoverageSummary,
  AgentPlanningSummary,
  AgentResolvePlanReviewRequest,
  AgentResolvePlanReviewResult,
  AgentSessionDetail,
} from "./agent-ui-types";
import type { AiPlanReviewModel } from "./plan-review-types";
import { isRecord, readString } from "./patch-artifact";

export type AiPlanReviewSurfaceProps = {
  readonly instanceId?: string;
  readonly model?: AiPlanReviewModel;
  readonly detail?: AgentSessionDetail | null;
  readonly resolvePlanReview?: ((request: AgentResolvePlanReviewRequest) => Promise<AgentResolvePlanReviewResult>) | undefined;
};

type ActionState = "approving" | "rejecting" | "annotating" | null;

type PlanStep = {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
};

export const AiPlanReviewSurface = ({
  instanceId,
  model,
  detail = null,
  resolvePlanReview,
}: AiPlanReviewSurfaceProps) => {
  void instanceId;
  void model;

  const summary = detail?.planningSummary ?? null;
  const coverage = matchingCoverage(detail, summary);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [annotationText, setAnnotationText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const steps = useMemo(() => planSteps(summary), [summary]);
  if (summary === null) {
    return null;
  }

  const pending = summary.panelStatus === "pending_review";
  const disabled = resolvePlanReview === undefined || actionState !== null || !pending;
  const resolve = async (decision: AgentResolvePlanReviewRequest["decision"]) => {
    if (resolvePlanReview === undefined) {
      return;
    }
    if (decision === "annotate" && annotationText.trim().length === 0) {
      return;
    }
    setActionState(
      decision === "approve" ? "approving" : decision === "reject" ? "rejecting" : "annotating"
    );
    setError(null);
    try {
      await resolvePlanReview({
        sessionId: summary.sessionId,
        planId: summary.planId,
        versionId: summary.activeVersionId,
        decision,
        ...(decision === "annotate" ? { annotationText: annotationText.trim() } : {}),
      });
      if (decision === "annotate") {
        setAnnotationText("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setActionState(null);
    }
  };

  return (
    <section className="lyra-ai-plan-review-compact" aria-label="Plan review">
      <div className="lyra-ai-plan-review-compact-header">
        <ClipboardList size={13} aria-hidden="true" />
        <span className="lyra-ai-plan-review-compact-title">{summary.title}</span>
        <span className="lyra-ai-plan-review-compact-state">
          v{String(summary.versionNumber)} · {statusLabel(summary, coverage)}
        </span>
      </div>
      <p className="lyra-ai-plan-review-compact-objective">
        {summary.objectiveSummary}
      </p>
      {steps.length === 0 ? null : (
        <ol className="lyra-ai-plan-review-compact-steps">
          {steps.slice(0, 5).map((step) => (
            <li key={step.id} className="lyra-ai-plan-review-compact-step">
              <span className="lyra-ai-plan-review-compact-step-title">{step.title}</span>
              {step.detail === null ? null : (
                <span className="lyra-ai-plan-review-compact-step-detail">{step.detail}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      {summary.annotations.length === 0 ? null : (
        <div className="lyra-ai-plan-review-compact-annotations">
          <MessageSquare size={12} aria-hidden="true" />
          <span>
            {String(summary.annotations.length)} note{summary.annotations.length === 1 ? "" : "s"}
          </span>
          <small>{summary.annotations.at(-1)?.note}</small>
        </div>
      )}
      {coverage === null ? null : (
        <div
          className="lyra-ai-plan-review-compact-coverage"
          data-status={coverage.status}
        >
          <span>{coverageTitle(coverage)}</span>
          <small>{coverageDetail(coverage)}</small>
        </div>
      )}
      {error === null ? null : (
        <span className="lyra-ai-plan-review-compact-error" role="alert">{error}</span>
      )}
      <div className="lyra-ai-plan-review-compact-actions">
        <input
          className="lyra-ai-plan-review-compact-input"
          value={annotationText}
          disabled={!pending || actionState !== null}
          placeholder="Add note"
          onChange={(event) => {
            setAnnotationText(event.currentTarget.value);
          }}
        />
        <button
          type="button"
          className="lyra-ai-plan-review-compact-button"
          disabled={disabled || annotationText.trim().length === 0}
          onClick={() => {
            void resolve("annotate");
          }}
        >
          {actionState === "annotating" ? <Loader2 size={12} aria-hidden="true" /> : <MessageSquare size={12} aria-hidden="true" />}
          <span>{actionState === "annotating" ? "Saving" : "Note"}</span>
        </button>
        <button
          type="button"
          className="lyra-ai-plan-review-compact-button lyra-ai-plan-review-compact-button-primary"
          disabled={disabled}
          onClick={() => {
            void resolve("approve");
          }}
        >
          {actionState === "approving" ? <Loader2 size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
          <span>{actionState === "approving" ? "Approving" : "Approve"}</span>
        </button>
        <button
          type="button"
          className="lyra-ai-plan-review-compact-button lyra-ai-plan-review-compact-button-danger"
          disabled={disabled}
          onClick={() => {
            void resolve("reject");
          }}
        >
          {actionState === "rejecting" ? <Loader2 size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
          <span>{actionState === "rejecting" ? "Rejecting" : "Reject"}</span>
        </button>
      </div>
    </section>
  );
};

const matchingCoverage = (
  detail: AgentSessionDetail | null,
  summary: AgentPlanningSummary | null
): AgentPlanCoverageSummary | null => {
  const coverage = detail?.planCoverageSummary ?? null;
  if (summary === null || coverage === null) {
    return null;
  }
  return coverage.planId === summary.planId && coverage.approvedVersionId === summary.activeVersionId
    ? coverage
    : null;
};

const statusLabel = (
  summary: AgentPlanningSummary,
  coverage: AgentPlanCoverageSummary | null
): string => {
  if (summary.panelStatus === "approved" || summary.status === "approved") {
    return coverage === null ? "Approved" : `Approved · ${coverageShortLabel(coverage)}`;
  }
  if (summary.panelStatus === "rejected" || summary.status === "rejected") {
    return "Rejected";
  }
  if (summary.panelStatus === "superseded" || summary.status === "superseded") {
    return "Superseded";
  }
  return "Pending review";
};

const coverageShortLabel = (coverage: AgentPlanCoverageSummary): string =>
  coverage.status === "valid" ? "Coverage valid" : `Coverage blocked · ${coverageReason(coverage)}`;

const coverageTitle = (coverage: AgentPlanCoverageSummary): string =>
  coverage.status === "valid" ? "Coverage valid" : "Coverage blocked";

const coverageDetail = (coverage: AgentPlanCoverageSummary): string => {
  if (coverage.status === "valid") {
    return `${String(coverage.coveredPlanStepIds.length)} step${coverage.coveredPlanStepIds.length === 1 ? "" : "s"} mapped to Todo`;
  }
  if (coverage.missingPlanStepIds.length > 0) {
    return `Missing ${coverage.missingPlanStepIds.slice(0, 3).join(", ")}`;
  }
  if (coverage.extraTodoItemIds.length > 0) {
    return `Extra scope ${coverage.extraTodoItemIds.slice(0, 3).join(", ")}`;
  }
  if (coverage.missingReferenceIds.length > 0) {
    return `Missing refs ${coverage.missingReferenceIds.slice(0, 3).join(", ")}`;
  }
  if (coverage.mismatchedReferenceIds.length > 0) {
    return `Mismatched refs ${coverage.mismatchedReferenceIds.slice(0, 3).join(", ")}`;
  }
  if (coverage.verificationGaps.length > 0) {
    return `Missing verification ${coverage.verificationGaps.slice(0, 3).join(", ")}`;
  }
  if (coverage.riskMismatches.length > 0) {
    return `${String(coverage.riskMismatches.length)} risk mismatch${coverage.riskMismatches.length === 1 ? "" : "es"}`;
  }
  return coverage.status.replaceAll("_", " ");
};

const coverageReason = (coverage: AgentPlanCoverageSummary): string => {
  if (coverage.status === "reference_missing" || coverage.missingReferenceIds.length > 0) {
    return "missing references";
  }
  if (coverage.status === "reference_mismatch" || coverage.mismatchedReferenceIds.length > 0) {
    return "reference mismatch";
  }
  if (coverage.status === "verification_missing" || coverage.verificationGaps.length > 0) {
    return "verification missing";
  }
  if (coverage.status === "risk_mismatch" || coverage.riskMismatches.length > 0) {
    return "risk mismatch";
  }
  if (coverage.status === "missing_plan_step" || coverage.missingPlanStepIds.length > 0) {
    return "missing steps";
  }
  if (coverage.status === "extra_scope" || coverage.extraTodoItemIds.length > 0) {
    return "extra scope";
  }
  return coverage.status.replaceAll("_", " ");
};

const planSteps = (summary: AgentPlanningSummary | null): readonly PlanStep[] => {
  if (summary === null || !isRecord(summary.version)) {
    return [];
  }
  const rawSteps = Array.isArray(summary.version.steps)
    ? summary.version.steps
    : Array.isArray(summary.version.items)
      ? summary.version.items
      : [];
  return rawSteps
    .map((step, index): PlanStep | null => {
      if (!isRecord(step)) {
        return null;
      }
      const title = readString(step.title) ?? readString(step.summary) ?? readString(step.name);
      if (title === null) {
        return null;
      }
      return {
        id: readString(step.id) ?? `step-${String(index + 1)}`,
        title,
        detail: readString(step.detail) ?? readString(step.body) ?? readString(step.description),
      };
    })
    .filter((step): step is PlanStep => step !== null);
};
