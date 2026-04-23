const THREAD_SELECTED_EVENT = "lyra:thread/selected";

type ThreadSelectedDetail = {
  readonly threadId: string;
};

const sanitizeThreadId = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const emitThreadSelected = (threadId: string): void => {
  const normalized = sanitizeThreadId(threadId);
  if (normalized === null || typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ThreadSelectedDetail>(THREAD_SELECTED_EVENT, {
      detail: { threadId: normalized }
    })
  );
};

export const subscribeThreadSelected = (
  listener: (threadId: string) => void
): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event): void => {
    const customEvent = event as CustomEvent<Partial<ThreadSelectedDetail> | undefined>;
    const threadId =
      customEvent.detail !== undefined && typeof customEvent.detail.threadId === "string"
        ? sanitizeThreadId(customEvent.detail.threadId)
        : null;
    if (threadId === null) {
      return;
    }
    listener(threadId);
  };

  window.addEventListener(THREAD_SELECTED_EVENT, handler);
  return () => {
    window.removeEventListener(THREAD_SELECTED_EVENT, handler);
  };
};
