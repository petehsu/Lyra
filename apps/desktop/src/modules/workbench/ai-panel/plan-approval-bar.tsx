import { useMemo, useState } from "react";

import type {
  PlanApprovalRequest,
  PlanInteractionResponse,
} from "../../../shared/desktop-bridge";
import { createTranslator, type WorkbenchLocale } from "../i18n";

type PlanApprovalBarProps = {
  readonly locale?: WorkbenchLocale;
  readonly request: PlanApprovalRequest;
  readonly onDecision: (response: PlanInteractionResponse) => void;
};

export const PlanApprovalBar = ({
  locale = "en-US",
  request,
  onDecision
}: PlanApprovalBarProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState("");
  const diffLabel = useMemo(() => {
    if (request.draftMarkdown === undefined || request.draftMarkdown === request.proposedMarkdown) {
      return t("ai.planApprovalDraftMatches");
    }
    return t("ai.planApprovalDraftDiffers");
  }, [request.draftMarkdown, request.proposedMarkdown, t]);

  const trimmedFeedback = feedback.trim();

  return (
    <div className="lyra-ai-plan-bar">
      <div className="lyra-ai-plan-bar__header">
        <span className="lyra-ai-plan-bar__eyebrow">{t("ai.planApprovalTitle")}</span>
        <span className="lyra-ai-plan-bar__meta">v{request.version} · {request.status}</span>
      </div>
      <div className="lyra-ai-plan-bar__body">
        <div className="lyra-ai-plan-bar__summary">{request.summary}</div>
        <div className="lyra-ai-plan-bar__diff">{diffLabel}</div>
        <button
          type="button"
          className="lyra-ai-plan-bar__details-toggle"
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          {expanded ? t("ai.planApprovalHidePlan") : t("ai.planApprovalShowPlan")}
        </button>
        {expanded ? (
          <pre className="lyra-ai-plan-bar__markdown">{request.proposedMarkdown}</pre>
        ) : null}
        <textarea
          className="lyra-ai-plan-bar__note"
          placeholder={t("ai.planApprovalOptionalFeedback")}
          value={feedback}
          onChange={(event) => {
            setFeedback(event.target.value);
          }}
        />
      </div>
      <div className="lyra-ai-plan-bar__actions">
        <button
          type="button"
          className="lyra-ai-plan-bar__submit"
          onClick={() => {
            onDecision({
              requestId: request.id,
              decision: "approve_and_implement",
            });
          }}
        >
          {t("ai.planApprovalApproveAndImplement")}
        </button>
        <button
          type="button"
          className="lyra-ai-plan-bar__secondary"
          onClick={() => {
            onDecision({
              requestId: request.id,
              decision: "keep_planning",
              ...(trimmedFeedback.length === 0 ? {} : { feedback: trimmedFeedback }),
            });
          }}
        >
          {t("ai.planApprovalKeepPlanning")}
        </button>
        <button
          type="button"
          className="lyra-ai-plan-bar__danger"
          onClick={() => {
            onDecision({
              requestId: request.id,
              decision: "reject",
              ...(trimmedFeedback.length === 0 ? {} : { feedback: trimmedFeedback }),
            });
          }}
        >
          {t("ai.planApprovalReject")}
        </button>
      </div>
    </div>
  );
};
