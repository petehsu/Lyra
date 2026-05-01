import { useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";

import type {
  PlanApprovalRequest,
  PlanInteractionResponse,
} from "../../../shared/desktop-bridge";
import { createTranslator, type WorkbenchLocale } from "../i18n";
import { AiPanelRichContent } from "./rich-content";

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
  const diffLabel = useMemo(() => {
    if (request.draftMarkdown === undefined || request.draftMarkdown === request.proposedMarkdown) {
      return t("ai.planApprovalDraftMatches");
    }
    return t("ai.planApprovalDraftDiffers");
  }, [request.draftMarkdown, request.proposedMarkdown, t]);

  const trimmedFeedback = feedback.trim();

  return (
    <div className="lyra-ai-plan-bar">
      <div className="lyra-ai-plan-bar__body">
        <div className="lyra-ai-plan-bar__summary">{request.summary}</div>
        <div className="lyra-ai-plan-bar__diff">{diffLabel}</div>
        <div className="lyra-ai-plan-bar__markdown">
          <AiPanelRichContent locale={locale} content={request.proposedMarkdown} />
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
                  requestId: request.id,
                  decision: "approve_and_implement",
                  ...(trimmedFeedback.length === 0 ? {} : { feedback: trimmedFeedback }),
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
              requestId: request.id,
              decision: "reject",
              ...(trimmedFeedback.length === 0 ? {} : { feedback: trimmedFeedback }),
            });
          }}
        >
          {onOpenInWorkspace === undefined ? t("ai.planApprovalReject") : <X size={15} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
};
