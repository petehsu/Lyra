import { CircleStop, PanelLeftOpen, PanelRightOpen } from "lucide-react";

import { createTranslator } from "../i18n";
import { AgentChatApp } from "./agent-chat-demo/AgentChatApp";
import type { AiPanelSurfaceProps } from "./types";
import { useLyraAgentDataProvider } from "./use-lyra-agent-data-provider";

export const AiPanelSurface = ({
  desktopApi,
  settingsAiModel,
  locale = "en-US",
  title,
  aiPanelSide = "left",
  onToggleAiPanelSide,
  movePanelToLeftLabel,
  movePanelToRightLabel
}: AiPanelSurfaceProps) => {
  const t = createTranslator(locale);
  const provider = useLyraAgentDataProvider(desktopApi, settingsAiModel);
  const moveLabel = aiPanelSide === "left"
    ? (movePanelToRightLabel ?? t("ai.movePanelToRight"))
    : (movePanelToLeftLabel ?? t("ai.movePanelToLeft"));
  const MoveIcon = aiPanelSide === "left" ? PanelRightOpen : PanelLeftOpen;
  const followLabel = provider.followRunning
    ? (provider.followActivity ?? "Running")
    : "Idle";

  return (
    <section className="lyra-ai-panel-shell" aria-label={title}>
      <header className="lyra-ai-panel-shell-header">
        <div className="lyra-ai-panel-shell-title-row">
          <div className="lyra-ai-panel-shell-title">{title}</div>
          <span className="lyra-ai-panel-status-pill" data-running={provider.followRunning}>
            {followLabel}
          </span>
        </div>
        <div className="lyra-ai-panel-shell-actions">
          {provider.followRunning ? (
            <button
              className="lyra-ai-panel-shell-icon-button"
              type="button"
              title="Cancel turn"
              aria-label="Cancel turn"
              onClick={() => void provider.cancel()}
            >
              <CircleStop aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          ) : null}
          {onToggleAiPanelSide === undefined ? null : (
            <button
              className="lyra-ai-panel-shell-icon-button"
              type="button"
              title={moveLabel}
              aria-label={moveLabel}
              onClick={onToggleAiPanelSide}
            >
              <MoveIcon aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </header>
      {provider.error === null ? null : (
        <div className="lyra-ai-panel-error" role="status">{provider.error}</div>
      )}
      <div className="lyra-ai-panel-agent-chat">
        <AgentChatApp data={provider.data} />
      </div>
    </section>
  );
};
