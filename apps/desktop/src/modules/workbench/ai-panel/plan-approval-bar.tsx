import { useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";

import type {
  AgentPlanBlock,
  PlanApprovalRequest,
  PlanInteractionResponse,
} from "../../../shared/desktop-bridge";
import { createTranslator, type WorkbenchLocale } from "../i18n";

type PlanApprovalBarProps = {
  readonly locale?: WorkbenchLocale;
  readonly request: PlanApprovalRequest;
  readonly onDecision: (response: PlanInteractionResponse) => void;
  readonly onOpenInWorkspace?: (request: PlanApprovalRequest) => void;
};

export const PlanApprovalBar = ({
  locale = "en-US",
  request,
  onDecision,
  onOpenInWorkspace,
}: PlanApprovalBarProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [feedback, setFeedback] = useState("");
  const blocks = useMemo(
    () => [
      ...request.artifact.assumptions,
      ...request.artifact.steps,
      ...request.artifact.interfaces,
      ...request.artifact.risks,
      ...request.artifact.tests,
      ...request.artifact.acceptanceCriteria,
    ],
    [request.artifact]
  );

  const trimmedFeedback = feedback.trim();
  const responseBase = {
    planId: request.planId,
    ...(trimmedFeedback.length === 0 ? {} : { feedback: trimmedFeedback }),
    artifactSnapshot: request.artifact,
  };

  return (
    <div className="lyra-ai-plan-bar">
      <div className="lyra-ai-plan-bar__body">
        <div className="lyra-ai-plan-bar__summary">{request.summary}</div>
        <div className="lyra-ai-plan-bar__diff">{request.artifact.title}</div>
        <div className="lyra-ai-plan-bar__markdown">
          <p>{request.artifact.objective}</p>
          {blocks.slice(0, 4).map((block: AgentPlanBlock) => (
            <section key={block.id} className="lyra-ai-plan-card__block">
              <div className="lyra-ai-plan-card__block-title">{block.title}</div>
              <p>{block.body}</p>
            </section>
          ))}
        </div>
        {onOpenInWorkspace === undefined ? (
          <textarea
            className="lyra-ai-plan-bar__note"
            placeholder={t("ai.planApprovalOptionalFeedback")}
            value={feedback}
            onChange={(event) => {
              setFeedback(event.target.value);
            }}
          />
        ) : null}
      </div>
      <div className="lyra-ai-plan-bar__actions">
        {onOpenInWorkspace === undefined ? (
          <>
            <button
              type="button"
              className="lyra-ai-plan-bar__submit"
              onClick={() => {
                onDecision({
                  ...responseBase,
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
                  ...responseBase,
                  decision: "keep_planning",
                });
              }}
            >
              {t("ai.planApprovalKeepPlanning")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="lyra-ai-plan-bar__icon-action lyra-ai-plan-bar__icon-action-submit"
            aria-label={t("ai.proposedPlanOpenInPanel")}
            title={t("ai.proposedPlanOpenInPanel")}
            onClick={() => {
              onOpenInWorkspace(request);
            }}
          >
            <ExternalLink size={15} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={
            onOpenInWorkspace === undefined
              ? "lyra-ai-plan-bar__danger"
              : "lyra-ai-plan-bar__icon-action lyra-ai-plan-bar__icon-action-danger"
          }
          aria-label={t("ai.planApprovalReject")}
          title={t("ai.planApprovalReject")}
          onClick={() => {
            onDecision({
              ...responseBase,
              decision: "reject",
            });
          }}
        >
          {onOpenInWorkspace === undefined ? t("ai.planApprovalReject") : <X size={15} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
};
