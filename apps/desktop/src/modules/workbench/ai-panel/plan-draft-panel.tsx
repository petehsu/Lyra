import { useMemo, useState } from "react";

import type { AgentPlanState } from "../../../shared/desktop-bridge";
import { createTranslator, type WorkbenchLocale } from "../i18n";

type PlanDraftPanelProps = {
  readonly locale?: WorkbenchLocale;
  readonly plan: AgentPlanState;
  readonly onClose: () => void;
};

export const PlanDraftPanel = ({
  locale = "en-US",
  plan,
  onClose
}: PlanDraftPanelProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [expanded, setExpanded] = useState(true);
  const blocks = useMemo(
    () => [
      ...plan.artifact.assumptions,
      ...plan.artifact.steps,
      ...plan.artifact.interfaces,
      ...plan.artifact.risks,
      ...plan.artifact.tests,
      ...plan.artifact.acceptanceCriteria,
    ],
    [plan.artifact]
  );

  return (
    <div className="lyra-ai-plan-bar">
      <div className="lyra-ai-plan-bar__header">
        <span className="lyra-ai-plan-bar__eyebrow">{t("ai.planDraftTitle")}</span>
        <span className="lyra-ai-plan-bar__meta">v{plan.version} · {plan.status}</span>
      </div>
      <div className="lyra-ai-plan-bar__body">
        <div className="lyra-ai-plan-bar__summary">{plan.artifact.summary || t("ai.planDraftCurrentSummary")}</div>
        <div className="lyra-ai-plan-bar__diff">
          {plan.lastSubmittedVersion === null || plan.lastSubmittedVersion === undefined
            ? t("ai.planDraftNoProposal")
            : `${t("ai.planDraftLastProposal")}: v${plan.lastSubmittedVersion}`}
        </div>
        <button
          type="button"
          className="lyra-ai-plan-bar__details-toggle"
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          {expanded ? t("ai.planDraftHide") : t("ai.planDraftShow")}
        </button>
        {expanded ? (
          <div className="lyra-ai-plan-bar__markdown">
            <p>{plan.artifact.objective}</p>
            {blocks.map((block) => (
              <section key={block.id} className="lyra-ai-plan-card__block">
                <div className="lyra-ai-plan-card__block-title">{block.title}</div>
                <p>{block.body}</p>
              </section>
            ))}
          </div>
        ) : null}
      </div>
      <div className="lyra-ai-plan-bar__actions">
        <button
          type="button"
          className="lyra-ai-plan-bar__secondary"
          onClick={onClose}
        >
          {t("ai.planDraftClose")}
        </button>
      </div>
    </div>
  );
};
