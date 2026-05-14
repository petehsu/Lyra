// ============================================================================
// ChatView — scrollable message list + floating composer stack
// ============================================================================
//
// Wires together: messages, scroll-to-bottom button, panels (decision /
// permission), and composer. Drives the scroll-linked decision panel
// progress value.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { APP_CONFIG } from "../../core/config";
import { useData } from "../../data/DataProvider";
import { Message } from "./Message";
import { Composer } from "./Composer";
import { DecisionPanel, PermissionPanel } from "../panels";

interface ChatViewProps {
  /** When true, render the decision panel even if there are no questions. */
  showDecisions: boolean;
  showPermission: boolean;
}

export function ChatView({ showDecisions, showPermission }: ChatViewProps) {
  const {
    messages,
    decisions,
    permissions,
    sendMessage,
    submitDecisions,
    approvePermission,
    denyPermission,
  } = useData();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [panelProgress, setPanelProgress] = useState(1);

  const lastScrollTop = useRef(0);
  const rafId = useRef(0);
  const accumulatedDelta = useRef(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < APP_CONFIG.scroll.atBottomThreshold;
    setIsAtBottom(atBottom);

    const currentTop = el.scrollTop;
    const delta = currentTop - lastScrollTop.current;
    lastScrollTop.current = currentTop;

    if (Math.abs(delta) < APP_CONFIG.scroll.ignoreDeltaBelow) return;

    accumulatedDelta.current += delta;

    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        const totalDelta = accumulatedDelta.current;
        accumulatedDelta.current = 0;
        rafId.current = 0;

        if (Math.abs(totalDelta) < APP_CONFIG.scroll.ignoreDeltaBelow) return;

        setPanelProgress((prev) => {
          const change = totalDelta / APP_CONFIG.scroll.decisionPanelRange;
          const next = prev + change;
          if (next <= 0.03) return 0;
          if (next >= 0.97) return 1;
          return Math.max(0, Math.min(1, next));
        });
      });
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && isAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isAtBottom]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  };

  return (
    <>
      <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className="chat-inner">
          {messages.map((m) => (
            <Message key={m.id} message={m} />
          ))}
        </div>
      </div>

      <div className="composer-wrap">
        <button
          type="button"
          className={`scroll-to-bottom ${isAtBottom ? "out" : "in"}`}
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          aria-hidden={isAtBottom}
        >
          <svg className="scroll-circle" viewBox="0 0 34 34">
            <circle cx="17" cy="17" r="16" />
          </svg>
          <span className="scroll-arrow">
            <ArrowDown size={15} strokeWidth={2.2} />
          </span>
        </button>

        {showPermission && permissions.length > 0 && (
          <PermissionPanel
            requests={permissions}
            onApprove={approvePermission}
            onDeny={denyPermission}
            progress={panelProgress}
            onTap={() => setPanelProgress(1)}
          />
        )}

        {showDecisions && decisions.length > 0 && (
          <DecisionPanel
            questions={decisions}
            onSubmit={submitDecisions}
            onDismiss={() => submitDecisions({})}
            progress={panelProgress}
            onTap={() => setPanelProgress(1)}
          />
        )}

        <Composer onSend={sendMessage} />
      </div>
    </>
  );
}
