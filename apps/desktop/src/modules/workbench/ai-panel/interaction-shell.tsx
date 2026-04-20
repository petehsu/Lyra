import type { RefObject } from "react";

import {
  CommandApprovalBar,
  type CommandApprovalRequest,
  type CommandApprovalResponse,
} from "../command-approval-bar";
import type {
  PlanApprovalRequest,
  PlanInteractionResponse,
  PlanQuestionRequest
} from "../../../shared/desktop-bridge";
import { PlanApprovalBar } from "./plan-approval-bar";
import { PlanQuestionBar } from "./plan-question-bar";
import type { WorkbenchLocale } from "../i18n";
import type {
  ActiveInteractionPanel,
  PendingInteractionPanel,
} from "./interaction/pending-interaction-mappers";

type AiPanelInteractionShellProps = {
  readonly locale: WorkbenchLocale;
  readonly panelRef: RefObject<HTMLDivElement>;
  readonly activeInteractionPanel: ActiveInteractionPanel;
  readonly activePendingInteraction: PendingInteractionPanel | null;
  readonly pendingInteractionQueue: readonly PendingInteractionPanel[];
  readonly activeInteractionPosition: number;
  readonly pendingInteractionsLabel: string;
  readonly navPreviousLabel: string;
  readonly navNextLabel: string;
  readonly onSelectInteractionId: (interactionId: string | null) => void;
  readonly onCommandApprovalDecision: (response: CommandApprovalResponse) => Promise<void>;
  readonly onPlanQuestionSubmit: (
    payload: { readonly answers: Record<string, unknown>; readonly note?: string }
  ) => Promise<void>;
  readonly onPlanApprovalDecision: (response: PlanInteractionResponse) => Promise<void>;
};

export const AiPanelInteractionShell = ({
  locale,
  panelRef,
  activeInteractionPanel,
  activePendingInteraction,
  pendingInteractionQueue,
  activeInteractionPosition,
  pendingInteractionsLabel,
  navPreviousLabel,
  navNextLabel,
  onSelectInteractionId,
  onCommandApprovalDecision,
  onPlanQuestionSubmit,
  onPlanApprovalDecision,
}: AiPanelInteractionShellProps) => {
  if (activeInteractionPanel === null) {
    return null;
  }

  return (
    <div ref={panelRef} className="lyra-ai-interaction-shell">
      <div className="lyra-ai-interaction-shell__header">
        <span className="lyra-ai-interaction-shell__label">
          {pendingInteractionsLabel} {activeInteractionPosition}/
          {activePendingInteraction === null ? 1 : pendingInteractionQueue.length}
        </span>
        <div className="lyra-ai-interaction-shell__actions">
          {activePendingInteraction !== null && pendingInteractionQueue.length > 1 ? (
            <>
              <button
                type="button"
                className="lyra-ai-interaction-shell__button"
                disabled={activeInteractionPosition <= 1}
                onClick={() => {
                  const previous = pendingInteractionQueue[activeInteractionPosition - 2];
                  onSelectInteractionId(previous?.request.id ?? null);
                }}
              >
                {navPreviousLabel}
              </button>
              <button
                type="button"
                className="lyra-ai-interaction-shell__button"
                disabled={activeInteractionPosition >= pendingInteractionQueue.length}
                onClick={() => {
                  const next = pendingInteractionQueue[activeInteractionPosition];
                  onSelectInteractionId(next?.request.id ?? null);
                }}
              >
                {navNextLabel}
              </button>
            </>
          ) : null}
        </div>
      </div>
      {activeInteractionPanel.kind === "commandApproval" ? (
        <CommandApprovalBar
          locale={locale}
          request={activeInteractionPanel.request as CommandApprovalRequest}
          onDecision={(response) => {
            void onCommandApprovalDecision(response);
          }}
        />
      ) : null}
      {activeInteractionPanel.kind === "planQuestion" ? (
        <PlanQuestionBar
          locale={locale}
          request={activeInteractionPanel.request as PlanQuestionRequest}
          onSubmit={(payload) => {
            void onPlanQuestionSubmit(payload);
          }}
        />
      ) : null}
      {activeInteractionPanel.kind === "planApproval" ? (
        <PlanApprovalBar
          locale={locale}
          request={activeInteractionPanel.request as PlanApprovalRequest}
          onDecision={(response) => {
            void onPlanApprovalDecision(response);
          }}
        />
      ) : null}
    </div>
  );
};
