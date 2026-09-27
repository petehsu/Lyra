import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";

export const isMiddleClick = (event: { readonly button: number }): boolean =>
  event.button === 1;

export type ChromeTabCloseGestureEvent = {
  readonly currentTarget: EventTarget;
};

export const isChromeTabCloseTarget = (target: EventTarget | null): boolean =>
  target instanceof Element
  && target.closest(
    ".lyra-browser-tab-close, .lyra-agents-session-tab-close, .lyra-terminal-tab-close"
  ) !== null;

const CHROME_TAB_CLOSE_SELECTOR =
  "[data-lyra-tab-id], [data-ai-session-tab-id], [data-lyra-terminal-tab-id]";

export const handleChromeTabClosePointerDown = (
  event: ReactPointerEvent<HTMLElement>,
  onClose: (event: ChromeTabCloseGestureEvent) => void
): void => {
  if (event.button > 0) return;
  // Cancel the following mouse click. Closing on pointerdown so a cancelled
  // click, an :active scale, or a parent HTML5 drag cannot swallow the close.
  event.preventDefault();
  event.stopPropagation();
  onClose(event);
};

export const handleChromeTabCloseClick = (
  event: ReactMouseEvent<HTMLElement>,
  onClose: (event: ChromeTabCloseGestureEvent) => void
): void => {
  event.preventDefault();
  event.stopPropagation();
  // Mouse already closed on pointerdown. Keyboard activation uses click (detail 0).
  if (event.detail > 0) return;
  onClose(event);
};

type UseChromeTabStripCloseLockInput = {
  readonly tabCount: number;
  readonly onCloseTab: (tabId: string) => void;
};

export const useChromeTabStripCloseLock = ({
  tabCount,
  onCloseTab
}: UseChromeTabStripCloseLockInput): {
  readonly closeLockedTabWidth: number | null;
  readonly onCloseTab: (
    tabId: string,
    event: ChromeTabCloseGestureEvent
  ) => void;
  readonly onClearCloseLock: () => void;
} => {
  const [closeLockedTabWidth, setCloseLockedTabWidth] = useState<number | null>(null);
  const pendingIdsRef = useRef<string[]>([]);
  const pendingWidthRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const onCloseTabRef = useRef(onCloseTab);
  const tabCountRef = useRef(tabCount);
  onCloseTabRef.current = onCloseTab;
  tabCountRef.current = tabCount;

  const onClearCloseLock = useCallback((): void => {
    setCloseLockedTabWidth(null);
  }, []);

  const flushPendingCloses = useCallback((): void => {
    flushTimerRef.current = null;
    const ids = pendingIdsRef.current;
    const width = pendingWidthRef.current;
    pendingIdsRef.current = [];
    pendingWidthRef.current = null;
    if (ids.length === 0) {
      return;
    }
    if (width !== null) {
      setCloseLockedTabWidth(width);
    }
    for (const id of ids) {
      onCloseTabRef.current(id);
    }
  }, []);

  useEffect(() => () => {
    if (flushTimerRef.current === null) {
      return;
    }
    window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    const ids = pendingIdsRef.current;
    pendingIdsRef.current = [];
    pendingWidthRef.current = null;
    for (const id of ids) {
      onCloseTabRef.current(id);
    }
  }, []);

  const closeTabWithLock = useCallback((
    tabId: string,
    event: ChromeTabCloseGestureEvent
  ): void => {
    const host = event.currentTarget as Partial<Element>;
    const tabElement = typeof host.closest === "function"
      ? host.closest<HTMLElement>(CHROME_TAB_CLOSE_SELECTOR)
      : null;
    // Width is stamped at render. Reading layout here forces a reflow of the
    // whole dirty shell between closes and is what freezes the app.
    const stampedWidth = Number(tabElement?.dataset.lyraTabWidth ?? "");
    if (
      pendingWidthRef.current === null
      && tabCountRef.current > 1
      && Number.isFinite(stampedWidth)
      && stampedWidth > 0
    ) {
      pendingWidthRef.current = Math.round(stampedWidth);
    }
    if (pendingIdsRef.current.includes(tabId) === false) {
      pendingIdsRef.current.push(tabId);
    }
    if (flushTimerRef.current !== null) {
      return;
    }
    // Already-queued clicks run before this timer, so a burst is one commit.
    flushTimerRef.current = window.setTimeout(flushPendingCloses, 0);
  }, [flushPendingCloses]);

  return {
    closeLockedTabWidth,
    onCloseTab: closeTabWithLock,
    onClearCloseLock
  };
};
