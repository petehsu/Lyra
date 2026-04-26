import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { createTranslator, type WorkbenchLocale } from "../i18n";
import { AiPanelRichContent } from "./rich-content";
import { StatusBadge, StatusIndicator } from "./status-primitives";
import type { LyraPlanStepStatus, LyraTurnPlanState } from "./use-lyra-thread-runtime";

type PlanCardProps = {
  readonly locale: WorkbenchLocale;
  readonly plan: LyraTurnPlanState;
  readonly richRenderingEnabled: boolean;
  readonly themeSignature?: string;
  readonly showActions: boolean;
  readonly onApprove: () => void;
  readonly onKeepPlanning: () => void;
  readonly onReject: () => void;
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
}: PlanCardProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const bodyText = (plan.finalText ?? plan.draftText).trim();
  const hasChecklist = plan.steps.length > 0;

  if (bodyText.length === 0 && !hasChecklist && plan.explanation === null) {
    return null;
  }

  return (
    <section className="lyra-ai-plan-card" aria-label={t("ai.planDraftTitle")}>
      <div className="lyra-ai-plan-card__header">
        <div className="lyra-ai-plan-card__title">
          <StatusIndicator tone="info" variant="bar" ariaLabel={t("ai.planDraftTitle")} />
          <span>{t("ai.planDraftTitle")}</span>
        </div>
        <StatusBadge
          tone={plan.finalText === null ? "info" : "success"}
          label={plan.finalText === null ? t("ai.planStatusDraft") : t("ai.planStatusSubmitted")}
        />
      </div>
      {plan.explanation === null ? null : (
        <p className="lyra-ai-plan-card__explanation">{plan.explanation}</p>
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
      {bodyText.length === 0 || hasChecklist ? null : (
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
      {!showActions ? null : (
        <div className="lyra-ai-plan-card__actions">
          <button
            type="button"
            className="lyra-ai-plan-card__action lyra-ai-plan-card__action-primary"
            onClick={onApprove}
          >
            {t("ai.proposedPlanApprove")}
          </button>
          <button
            type="button"
            className="lyra-ai-plan-card__action"
            onClick={onKeepPlanning}
          >
            {t("ai.proposedPlanKeepPlanning")}
          </button>
          <button
            type="button"
            className="lyra-ai-plan-card__action lyra-ai-plan-card__action-danger"
            onClick={onReject}
          >
            {t("ai.proposedPlanReject")}
          </button>
        </div>
      )}
    </section>
  );
};
