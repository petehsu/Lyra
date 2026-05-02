import { Check, ExternalLink, RotateCcw, X } from "lucide-react";
import { useMemo } from "react";

import type { AgentPlanBlock } from "../../../shared/desktop-bridge";
import { createTranslator, type WorkbenchLocale } from "../i18n";
import type { LyraTurnPlanState } from "./use-lyra-thread-runtime";

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

const renderBlockList = (title: string, blocks: readonly AgentPlanBlock[]) => {
  if (blocks.length === 0) {
    return null;
  }
  return (
    <section className="lyra-ai-plan-card__section">
      <h4>{title}</h4>
      <div className="lyra-ai-plan-card__blocks">
        {blocks.map((block) => (
          <article key={block.id} className="lyra-ai-plan-card__block">
            <div className="lyra-ai-plan-card__block-title">{block.title}</div>
            <p>{block.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
};

export const PlanCard = ({
  locale,
  plan,
  showActions,
  onApprove,
  onKeepPlanning,
  onReject,
  onOpenInWorkspace,
}: PlanCardProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const artifact = plan.artifact;
  const title = artifact.status === "draft" ? t("ai.planDraftTitle") : t("ai.planProposedTitle");
  const canApprove = showActions && artifact.status === "proposed";

  return (
    <section className="lyra-ai-plan-card" aria-label={title}>
      <div className="lyra-ai-plan-card__header">
        <div className="lyra-ai-plan-card__title">
          <span>{title}</span>
        </div>
      </div>
      <div className="lyra-ai-plan-card__body">
        <h3>{artifact.title}</h3>
        <p>{artifact.summary}</p>
        <p>{artifact.objective}</p>
      </div>
      {renderBlockList(t("ai.planSectionAssumptions"), artifact.assumptions)}
      {renderBlockList(t("ai.planSectionSteps"), artifact.steps)}
      {renderBlockList(t("ai.planSectionInterfaces"), artifact.interfaces)}
      {renderBlockList(t("ai.planSectionRisks"), artifact.risks)}
      {renderBlockList(t("ai.planSectionTests"), artifact.tests)}
      {renderBlockList(t("ai.planSectionAcceptanceCriteria"), artifact.acceptanceCriteria)}
      {!canApprove ? null : (
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
