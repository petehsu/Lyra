import { memo, type RefObject } from "react";

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
import { SpinnerLabel, StatusBadge } from "./status-primitives";
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

export const AiPanelInteractionShell = memo(({
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

  const queueSize = activePendingInteraction === null ? 1 : pendingInteractionQueue.length;

  return (
    <div ref={panelRef} className="lyra-ai-interaction-shell">
      <div className="lyra-ai-interaction-shell__header">
        <div className="lyra-ai-interaction-shell__status">
          <SpinnerLabel
            variant="sand"
            tone="warning"
            size="sm"
            ariaLabel={pendingInteractionsLabel}
            className="lyra-ai-interaction-shell__spinner"
          />
          <span className="lyra-ai-interaction-shell__label">{pendingInteractionsLabel}</span>
          <StatusBadge
            tone="warning"
            label={`${String(activeInteractionPosition)}/${String(queueSize)}`}
            className="lyra-ai-interaction-shell__badge"
          />
        </div>
        <div className="lyra-ai-interaction-shell__actions">
          {activePendingInteraction !== null && queueSize > 1 ? (
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
                disabled={activeInteractionPosition >= queueSize}
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
});

AiPanelInteractionShell.displayName = "AiPanelInteractionShell";
