import { memo, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  CommandApprovalBar,
  type CommandApprovalRequest,
  type CommandApprovalResponse,
} from "../command-approval-bar";
import type { AgentQuestionRequest } from "../../../shared/desktop-bridge";
import { McpElicitationPanel } from "./mcp-elicitation-panel";
import { AgentQuestionBar } from "./plan-question-bar";
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
  readonly navPreviousLabel: string;
  readonly navNextLabel: string;
  readonly onSelectInteractionId: (interactionId: string | null) => void;
  readonly onCommandApprovalDecision: (response: CommandApprovalResponse) => Promise<void>;
  readonly onAgentQuestionSubmit: (
    payload: { readonly answers: Record<string, unknown>; readonly note?: string }
  ) => Promise<void>;
  readonly onMcpElicitationSubmit?: ((
    payload: {
      readonly action: "accept" | "decline" | "cancel";
      readonly content?: Record<string, unknown>;
      readonly meta?: Record<string, unknown>;
    }
  ) => Promise<void>) | undefined;
};

export const AiPanelInteractionShell = memo(({
  locale,
  panelRef,
  activeInteractionPanel,
  activePendingInteraction,
  pendingInteractionQueue,
  activeInteractionPosition,
  navPreviousLabel,
  navNextLabel,
  onSelectInteractionId,
  onCommandApprovalDecision,
  onAgentQuestionSubmit,
  onMcpElicitationSubmit,
}: AiPanelInteractionShellProps) => {
  if (activeInteractionPanel === null || activeInteractionPanel.kind === "planApproval") {
    return null;
  }

  const queueSize = activePendingInteraction === null ? 1 : pendingInteractionQueue.length;
  const showNavigation = activePendingInteraction !== null && queueSize > 1;

  return (
    <div ref={panelRef} className="lyra-ai-interaction-shell">
      {showNavigation ? (
        <div className="lyra-ai-interaction-shell__actions">
          <button
            type="button"
            className="lyra-ai-interaction-shell__button"
            disabled={activeInteractionPosition <= 1}
            aria-label={navPreviousLabel}
            title={navPreviousLabel}
            onClick={() => {
              const previous = pendingInteractionQueue[activeInteractionPosition - 2];
              onSelectInteractionId(previous?.request.id ?? null);
            }}
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lyra-ai-interaction-shell__button"
            disabled={activeInteractionPosition >= queueSize}
            aria-label={navNextLabel}
            title={navNextLabel}
            onClick={() => {
              const next = pendingInteractionQueue[activeInteractionPosition];
              onSelectInteractionId(next?.request.id ?? null);
            }}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {activeInteractionPanel.kind === "commandApproval" ? (
        <CommandApprovalBar
          locale={locale}
          request={activeInteractionPanel.request as CommandApprovalRequest}
          onDecision={(response) => {
            void onCommandApprovalDecision(response);
          }}
        />
      ) : null}
      {activeInteractionPanel.kind === "agentQuestion" ? (
        <AgentQuestionBar
          locale={locale}
          request={activeInteractionPanel.request as AgentQuestionRequest}
          onSubmit={(payload) => {
            void onAgentQuestionSubmit(payload);
          }}
        />
      ) : null}
      {activeInteractionPanel.kind === "mcpElicitation" ? (
        <McpElicitationPanel
          locale={locale}
          request={activeInteractionPanel.request}
          onSubmit={(payload) => {
            void onMcpElicitationSubmit?.(payload);
          }}
        />
      ) : null}
    </div>
  );
});

AiPanelInteractionShell.displayName = "AiPanelInteractionShell";
