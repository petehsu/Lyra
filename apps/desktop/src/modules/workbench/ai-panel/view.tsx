import { useState, type FormEvent } from "react";
import {
  CircleStop,
  PanelLeftOpen,
  PanelRightOpen,
  Send,
  Sparkles,
  Terminal,
  Search,
  FileText
} from "lucide-react";

import { createTranslator } from "../i18n";
import type { AgentMessage, AgentToolActivity } from "../../../shared/agent";
import type { AiPanelSurfaceProps } from "./types";
import { useLyraAgentDataProvider } from "./use-lyra-agent-data-provider";

const toolIcon = (tool: AgentToolActivity) => {
  if (tool.name.includes("search")) return Search;
  if (tool.name.includes("shell")) return Terminal;
  return FileText;
};

const messageLabel = (message: AgentMessage): string =>
  message.role === "assistant" ? "Lyra" : message.role === "user" ? "You" : "System";

export const AiPanelSurface = ({
  desktopApi,
  locale = "en-US",
  title,
  emptyThreadLabel,
  aiPanelSide = "left",
  onToggleAiPanelSide,
  movePanelToLeftLabel,
  movePanelToRightLabel
}: AiPanelSurfaceProps) => {
  const t = createTranslator(locale);
  const provider = useLyraAgentDataProvider(desktopApi);
  const [draft, setDraft] = useState("");
  const moveLabel = aiPanelSide === "left"
    ? (movePanelToRightLabel ?? t("ai.movePanelToRight"))
    : (movePanelToLeftLabel ?? t("ai.movePanelToLeft"));
  const MoveIcon = aiPanelSide === "left" ? PanelRightOpen : PanelLeftOpen;
  const followLabel = provider.follow.running
    ? (provider.follow.activity ?? "Running")
    : "Idle";

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
    void provider.sendMessage(text);
  };

  return (
    <section className="lyra-ai-panel-shell" aria-label={title}>
      <header className="lyra-ai-panel-shell-header">
        <div className="lyra-ai-panel-shell-title-row">
          <Sparkles aria-hidden="true" size={15} strokeWidth={1.8} />
          <div className="lyra-ai-panel-shell-title">{provider.session?.title ?? title}</div>
          <span className="lyra-ai-panel-status-pill" data-running={provider.follow.running}>
            {followLabel}
          </span>
        </div>
        <div className="lyra-ai-panel-shell-actions">
          {provider.follow.running ? (
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
      <div className="lyra-ai-panel-shell-body">
        {provider.error === null ? null : (
          <div className="lyra-ai-panel-error" role="status">{provider.error}</div>
        )}
        {provider.messages.length === 0 && provider.toolGroups.length === 0 ? (
          <div className="lyra-ai-panel-empty">{emptyThreadLabel}</div>
        ) : (
          <div className="lyra-ai-panel-thread">
            {provider.messages.map((message) => (
              <article
                className="lyra-ai-panel-message"
                data-role={message.role}
                key={message.id}
              >
                <div className="lyra-ai-panel-message-meta">{messageLabel(message)}</div>
                <div className="lyra-ai-panel-message-text">
                  {message.text.length === 0 ? "..." : message.text}
                </div>
              </article>
            ))}
            {provider.toolGroups.length === 0 ? null : (
              <div className="lyra-ai-panel-tool-list" aria-label="Agent activity">
                {provider.toolGroups.map((tool) => {
                  const Icon = toolIcon(tool);
                  return (
                    <div
                      className="lyra-ai-panel-tool-row"
                      data-status={tool.status}
                      key={tool.id}
                    >
                      <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
                      <div className="lyra-ai-panel-tool-copy">
                        <span>{tool.label}</span>
                        <small>{tool.status === "running" ? "Running..." : tool.status}</small>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      <form className="lyra-ai-panel-composer" onSubmit={submit}>
        <textarea
          aria-label="Message Lyra Agent"
          value={draft}
          placeholder="Ask Lyra to work in this workspace"
          rows={3}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <button
          className="lyra-ai-panel-send-button"
          type="submit"
          disabled={draft.trim().length === 0}
          aria-label="Send message"
          title="Send message"
        >
          <Send aria-hidden="true" size={16} strokeWidth={1.9} />
        </button>
      </form>
    </section>
  );
};
