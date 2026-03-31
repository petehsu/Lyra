import { useState } from "react";

import { actionStatusLabel, planStateLabel } from "./service";
import type { AiTowerProps } from "./types";

export const AiTower = ({
  mode,
  plan,
  actions,
  approvals,
  thread,
  onModeChange,
  onSendMessage,
  onApprove,
  onReject
}: AiTowerProps) => {
  const [draft, setDraft] = useState("");

  const send = (): void => {
    const value = draft.trim();
    if (value.length === 0) {
      return;
    }
    onSendMessage(value);
    setDraft("");
  };

  return (
    <aside className="lyra-ai-tower" aria-label="ai-tower">
      <header className="lyra-ai-header">
        <div className="lyra-ai-title-row">
          <strong>New Thread</strong>
          <span>Thread #A2</span>
        </div>
        <div className="lyra-ai-mode">
          <button
            className={mode === "assist" ? "lyra-toggle lyra-toggle-active" : "lyra-toggle"}
            onClick={() => onModeChange("assist")}
          >
            Assist
          </button>
          <button
            className={mode === "agent" ? "lyra-toggle lyra-toggle-active" : "lyra-toggle"}
            onClick={() => onModeChange("agent")}
          >
            Agent
          </button>
        </div>
      </header>

      <section className="lyra-ai-section">
        <h4>Plan</h4>
        <ul>
          {plan.map((step) => (
            <li key={step.id}>
              <span>{step.label}</span>
              <em>{planStateLabel(step.state)}</em>
            </li>
          ))}
        </ul>
      </section>

      <section className="lyra-ai-section">
        <h4>Action Timeline</h4>
        <ul>
          {actions.map((item) => (
            <li key={item.id}>
              <div>
                <span>{item.action}</span>
                <em>{item.timestamp}</em>
              </div>
              <small>{actionStatusLabel(item.status)}</small>
            </li>
          ))}
        </ul>
      </section>

      <section className="lyra-ai-section">
        <h4>Approval Queue</h4>
        <ul>
          {approvals.map((item) => (
            <li key={item.id}>
              <div>
                <span>{item.summary}</span>
                <em>{item.status}</em>
              </div>
              <div className="lyra-approval-buttons">
                <button className="lyra-secondary-button" onClick={() => onApprove(item.id)}>
                  Approve
                </button>
                <button className="lyra-secondary-button" onClick={() => onReject(item.id)}>
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="lyra-ai-thread">
        <h4>Messages</h4>
        <div className="lyra-ai-messages">
          {thread.map((message) => (
            <div
              key={message.id}
              className={
                message.role === "assistant"
                  ? "lyra-ai-message lyra-ai-message-assistant"
                  : "lyra-ai-message lyra-ai-message-user"
              }
            >
              {message.content}
            </div>
          ))}
        </div>
        <div className="lyra-ai-composer">
          <input
            value={draft}
            placeholder="给 AI 发送消息（Enter）"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                send();
              }
            }}
          />
          <button className="lyra-primary-button" onClick={send}>
            Send
          </button>
        </div>
      </section>
    </aside>
  );
};
