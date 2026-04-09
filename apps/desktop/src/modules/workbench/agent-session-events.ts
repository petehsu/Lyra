const AGENT_SESSION_SELECTED_EVENT = "lyra:agent/session-selected";

type AgentSessionSelectedDetail = {
  readonly sessionId: string;
};

const sanitizeSessionId = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const emitAgentSessionSelected = (sessionId: string): void => {
  const normalized = sanitizeSessionId(sessionId);
  if (normalized === null || typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<AgentSessionSelectedDetail>(AGENT_SESSION_SELECTED_EVENT, {
      detail: { sessionId: normalized }
    })
  );
};

export const subscribeAgentSessionSelected = (
  listener: (sessionId: string) => void
): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event): void => {
    const customEvent = event as CustomEvent<Partial<AgentSessionSelectedDetail> | undefined>;
    const sessionId =
      customEvent.detail !== undefined && typeof customEvent.detail.sessionId === "string"
        ? sanitizeSessionId(customEvent.detail.sessionId)
        : null;
    if (sessionId === null) {
      return;
    }
    listener(sessionId);
  };

  window.addEventListener(AGENT_SESSION_SELECTED_EVENT, handler);
  return () => {
    window.removeEventListener(AGENT_SESSION_SELECTED_EVENT, handler);
  };
};
