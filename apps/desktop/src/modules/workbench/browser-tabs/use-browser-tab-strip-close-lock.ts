import {
  useCallback,
  useLayoutEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject
} from "react";

import {
  BROWSER_TAB_RESTORED_WIDTH_PX,
  BROWSER_TAB_OVERLAP_PX
} from "./tab-strip-layout-constants";

type UseBrowserTabStripCloseLockInput = {
  readonly tabCount: number;
  readonly navRef: RefObject<HTMLElement>;
  readonly onCloseTab: (tabId: string) => void;
};

const resolveRestoredWidthTabsTotal = (tabCount: number): number => {
  if (tabCount <= 0) {
    return 0;
  }
  return (
    BROWSER_TAB_RESTORED_WIDTH_PX * tabCount -
    BROWSER_TAB_OVERLAP_PX * Math.max(0, tabCount - 1)
  );
};

export const useBrowserTabStripCloseLock = ({
  tabCount,
  navRef,
  onCloseTab
}: UseBrowserTabStripCloseLockInput): {
  readonly closeLockedTabWidth: number | null;
  readonly onCloseTab: (
    tabId: string,
    event: ReactMouseEvent<HTMLElement>
  ) => void;
  readonly onClearCloseLock: () => void;
} => {
  const [closeLockedTabWidth, setCloseLockedTabWidth] = useState<number | null>(null);

  const onClearCloseLock = useCallback((): void => {
    setCloseLockedTabWidth(null);
  }, []);

  const closeTabWithLock = useCallback((
    tabId: string,
    event: ReactMouseEvent<HTMLElement>
  ): void => {
    const tabElement = event.currentTarget.closest<HTMLElement>(
      ".lyra-browser-tab-item[data-lyra-tab-id]"
    );
    const tabWidth = tabElement?.getBoundingClientRect().width ?? 0;
    setCloseLockedTabWidth(tabCount > 1 && tabWidth > 0 ? Math.round(tabWidth) : null);
    onCloseTab(tabId);
  }, [onCloseTab, tabCount]);

  useLayoutEffect(() => {
    if (closeLockedTabWidth === null || tabCount <= 1) {
      setCloseLockedTabWidth(null);
      return;
    }

    const host = navRef.current;
    const list = host?.querySelector<HTMLElement>(".lyra-browser-tab-list") ?? null;
    if (list === null) {
      return;
    }

    const clearWhenTabsFit = (): void => {
      const listWidth = list.getBoundingClientRect().width;
      if (resolveRestoredWidthTabsTotal(tabCount) <= listWidth) {
        setCloseLockedTabWidth(null);
      }
    };
    clearWhenTabsFit();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(clearWhenTabsFit);
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, [closeLockedTabWidth, navRef, tabCount]);

  return {
    closeLockedTabWidth,
    onCloseTab: closeTabWithLock,
    onClearCloseLock
  };
};
