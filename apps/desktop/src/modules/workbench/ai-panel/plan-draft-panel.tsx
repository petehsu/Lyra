import { useMemo, useState } from "react";

import type { AgentPlanState } from "../../../shared/desktop-bridge";
import { createTranslator, type WorkbenchLocale } from "../i18n";
import { AiPanelRichContent } from "./rich-content";

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
  const headline = useMemo(() => {
    const source =
      plan.draftMarkdown.trim().length > 0
        ? plan.draftMarkdown
        : plan.proposedMarkdown ?? plan.approvedMarkdown ?? "";
    return (
      source
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      ?? t("ai.planDraftCurrentSummary")
    );
  }, [plan, t]);

  const body =
    plan.draftMarkdown.trim().length > 0
      ? plan.draftMarkdown
      : plan.proposedMarkdown ?? plan.approvedMarkdown ?? "";

  return (
    <div className="lyra-ai-plan-bar">
      <div className="lyra-ai-plan-bar__header">
        <span className="lyra-ai-plan-bar__eyebrow">{t("ai.planDraftTitle")}</span>
        <span className="lyra-ai-plan-bar__meta">v{plan.version} · {plan.status}</span>
      </div>
      <div className="lyra-ai-plan-bar__body">
        <div className="lyra-ai-plan-bar__summary">{headline}</div>
        <div className="lyra-ai-plan-bar__diff">
          {plan.lastSubmittedVersion === null || plan.lastSubmittedVersion === undefined
            ? t("ai.planDraftNoSubmitted")
            : `${t("ai.planDraftLastSubmitted")}: v${plan.lastSubmittedVersion}`}
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
        {expanded && body.trim().length > 0 ? (
          <div className="lyra-ai-plan-bar__markdown">
            <AiPanelRichContent locale={locale} content={body} />
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
