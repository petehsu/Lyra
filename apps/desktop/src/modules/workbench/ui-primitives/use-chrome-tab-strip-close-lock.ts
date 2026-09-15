import {
  useCallback,
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

  const onClearCloseLock = useCallback((): void => {
    setCloseLockedTabWidth(null);
  }, []);

  const closeTabWithLock = useCallback((
    tabId: string,
    event: ChromeTabCloseGestureEvent
  ): void => {
    const host = event.currentTarget as Partial<Element>;
    const tabElement = typeof host.closest === "function"
      ? host.closest<HTMLElement>(CHROME_TAB_CLOSE_SELECTOR)
      : null;
    const tabWidth = tabElement?.getBoundingClientRect().width ?? 0;
    setCloseLockedTabWidth(tabCount > 1 && tabWidth > 0 ? Math.round(tabWidth) : null);
    onCloseTab(tabId);
  }, [onCloseTab, tabCount]);

  return {
    closeLockedTabWidth,
    onCloseTab: closeTabWithLock,
    onClearCloseLock
  };
};
