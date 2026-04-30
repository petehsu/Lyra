import { Check, CheckCircle2, Circle, ExternalLink, Loader2, RotateCcw, X } from "lucide-react";
import { useMemo } from "react";

import { createTranslator, type WorkbenchLocale } from "../i18n";
import { AiPanelRichContent } from "./rich-content";
import { StatusIndicator } from "./status-primitives";
import type { LyraPlanStepStatus, LyraTurnPlanState } from "./use-lyra-thread-runtime";

type PlanCardProps = {
  readonly locale: WorkbenchLocale;
  readonly plan: LyraTurnPlanState;
  readonly richRenderingEnabled: boolean;
  readonly themeSignature?: string;
  readonly showActions: boolean;
  readonly onApprove?: () => void;
  readonly onKeepPlanning?: () => void;
  readonly onReject: () => void;
  readonly onOpenInWorkspace?: () => void;
};

const statusIcon = (status: LyraPlanStepStatus) => {
  if (status === "completed") {
    return <CheckCircle2 size={13} aria-hidden="true" />;
  }
  if (status === "inProgress") {
    return <Loader2 size={13} aria-hidden="true" className="lyra-ai-plan-card__step-spinner" />;
  }
  return <Circle size={12} aria-hidden="true" />;
};

const statusTone = (status: LyraPlanStepStatus) => {
  if (status === "completed") {
    return "success" as const;
  }
  if (status === "inProgress") {
    return "info" as const;
  }
  return "muted" as const;
};

export const PlanCard = ({
  locale,
  plan,
  richRenderingEnabled,
  themeSignature,
  showActions,
  onApprove,
  onKeepPlanning,
  onReject,
  onOpenInWorkspace,
}: PlanCardProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const bodyText = (plan.finalText ?? plan.draftText).trim();
  const hasChecklist = plan.steps.length > 0;
  const title = plan.finalText === null ? t("ai.planDraftTitle") : t("ai.planSubmittedTitle");

  if (bodyText.length === 0 && !hasChecklist && plan.explanation === null) {
    return null;
  }

  return (
    <section className="lyra-ai-plan-card" aria-label={title}>
      <div className="lyra-ai-plan-card__header">
        <div className="lyra-ai-plan-card__title">
          <StatusIndicator tone="info" variant="dot" ariaLabel={title} />
          <span>{title}</span>
        </div>
      </div>
      {plan.explanation === null ? null : (
        <p className="lyra-ai-plan-card__explanation">{plan.explanation}</p>
      )}
      {bodyText.length === 0 ? null : (
        <div className="lyra-ai-plan-card__body">
          {richRenderingEnabled ? (
            <AiPanelRichContent
              content={bodyText}
              locale={locale}
              {...(themeSignature === undefined ? {} : { themeSignature })}
            />
          ) : (
            <pre>{bodyText}</pre>
          )}
        </div>
      )}
      {!hasChecklist ? null : (
        <ol className="lyra-ai-plan-card__steps">
          {plan.steps.map((step, index) => (
            <li
              key={`${step.step}-${String(index)}`}
              className={`lyra-ai-plan-card__step lyra-ai-plan-card__step-${step.status}`}
            >
              <StatusIndicator
                tone={statusTone(step.status)}
                variant="icon"
                icon={statusIcon(step.status)}
                ariaLabel={step.status}
              />
              <span>{step.step}</span>
            </li>
          ))}
        </ol>
      )}
      {!showActions ? null : (
        <div className="lyra-ai-plan-card__actions">
          {onApprove === undefined ? null : (
            <button
              type="button"
              className="lyra-ai-plan-card__action lyra-ai-plan-card__action-primary"
              aria-label={t("ai.planApprovalApproveAndImplement")}
              title={t("ai.planApprovalApproveAndImplement")}
              onClick={onApprove}
            >
              <Check size={14} aria-hidden="true" />
            </button>
          )}
          {onKeepPlanning === undefined ? null : (
            <button
              type="button"
              className="lyra-ai-plan-card__action lyra-ai-plan-card__action-secondary"
              aria-label={t("ai.planApprovalKeepPlanning")}
              title={t("ai.planApprovalKeepPlanning")}
              onClick={onKeepPlanning}
            >
              <RotateCcw size={14} aria-hidden="true" />
            </button>
          )}
          {onOpenInWorkspace === undefined ? null : (
            <button
              type="button"
              className="lyra-ai-plan-card__action lyra-ai-plan-card__action-primary"
              aria-label={t("ai.proposedPlanOpenInPanel")}
              title={t("ai.proposedPlanOpenInPanel")}
              onClick={onOpenInWorkspace}
            >
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="lyra-ai-plan-card__action lyra-ai-plan-card__action-danger"
            aria-label={t("ai.proposedPlanReject")}
            title={t("ai.proposedPlanReject")}
            onClick={onReject}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
};
