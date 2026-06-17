const escapeMessageId = (messageId: string): string => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(messageId);
  }
  return messageId.replace(/["\\]/g, "\\$&");
};

export const queryCitationMessageElement = (
  root: ParentNode,
  messageId: string
): HTMLElement | null => {
  const escaped = escapeMessageId(messageId);
  const message = root.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`);
  if (message !== null) return message;
  return root.querySelector<HTMLElement>(`[data-chat-message-id="${escaped}"]`);
};

export type RunCitationScrollOptions = {
  scrollEl: HTMLDivElement;
  messageId: string;
  estimatedTop: number;
  onViewportSync: (scrollTop: number) => void;
  onComplete: () => void;
};

export const runCitationScrollIntoView = ({
  scrollEl,
  messageId,
  estimatedTop,
  onViewportSync,
  onComplete
}: RunCitationScrollOptions): (() => void) => {
  let cancelled = false;
  let attempts = 0;
  const maxAttempts = 36;

  scrollEl.scrollTop = estimatedTop;
  onViewportSync(estimatedTop);

  const finish = (behavior: ScrollBehavior): void => {
    const delay = behavior === "smooth" ? 360 : 48;
    window.setTimeout(() => {
      if (cancelled) return;
      onViewportSync(scrollEl.scrollTop);
      onComplete();
    }, delay);
  };

  const step = (): void => {
    if (cancelled) return;
    attempts += 1;

    const domTarget = queryCitationMessageElement(scrollEl, messageId);
    if (domTarget !== null) {
      const behavior: ScrollBehavior = attempts <= 2 ? "auto" : "smooth";
      domTarget.scrollIntoView({ block: "center", behavior });
      onViewportSync(scrollEl.scrollTop);
      finish(behavior);
      return;
    }

    if (attempts >= maxAttempts) {
      scrollEl.scrollTop = estimatedTop;
      onViewportSync(estimatedTop);
      onComplete();
      return;
    }

    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
  return () => {
    cancelled = true;
  };
};