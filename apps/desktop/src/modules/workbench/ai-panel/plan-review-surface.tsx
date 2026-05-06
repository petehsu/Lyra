import { Check, ClipboardList, Loader2, MessageSquare, X } from "lucide-react";
import { useMemo, useState } from "react";

import type {
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
          v{String(summary.versionNumber)} · {statusLabel(summary)}
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

const statusLabel = (summary: AgentPlanningSummary): string => {
  if (summary.panelStatus === "approved" || summary.status === "approved") {
    return "Approved";
  }
  if (summary.panelStatus === "rejected" || summary.status === "rejected") {
    return "Rejected";
  }
  if (summary.panelStatus === "superseded" || summary.status === "superseded") {
    return "Superseded";
  }
  return "Pending review";
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
