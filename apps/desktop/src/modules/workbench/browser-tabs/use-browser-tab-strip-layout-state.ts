import { useLayoutEffect, useState, type RefObject } from "react";

import type { BrowserTabStripDensity } from "./tab-strip-render-model";
import {
  BROWSER_TAB_CONTENT_MARGIN_PX,
  BROWSER_TAB_OVERLAP_PX,
  BROWSER_TAB_SIZE_MINI_PX,
  BROWSER_TAB_SIZE_SMALLER_PX,
  BROWSER_TAB_SIZE_SMALL_PX
} from "./tab-strip-layout-constants";

const resolveDensity = (
  tabCount: number,
  listWidth: number
): BrowserTabStripDensity => {
  if (tabCount === 0 || listWidth <= 0) {
    return "regular";
  }

  const targetTabWidth =
    (listWidth + BROWSER_TAB_OVERLAP_PX * Math.max(0, tabCount - 1)) / tabCount;
  const targetContentWidth = targetTabWidth - BROWSER_TAB_CONTENT_MARGIN_PX * 2;
  if (targetContentWidth < BROWSER_TAB_SIZE_MINI_PX) {
    return "mini";
  }
  if (targetContentWidth < BROWSER_TAB_SIZE_SMALLER_PX) {
    return "smaller";
  }
  if (targetContentWidth < BROWSER_TAB_SIZE_SMALL_PX) {
    return "small";
  }
  return "regular";
};

export const useBrowserTabStripLayoutState = (
  tabCount: number,
  navRef: RefObject<HTMLElement>
): {
  readonly density: BrowserTabStripDensity;
} => {
  const [density, setDensity] = useState<BrowserTabStripDensity>("regular");

  useLayoutEffect(() => {
    const host = navRef.current;
    const list = host?.querySelector<HTMLElement>(".lyra-browser-tab-list") ?? null;
    if (list === null) {
      setDensity("regular");
      return;
    }

    const measure = (): void => {
      const nextDensity = resolveDensity(tabCount, list.getBoundingClientRect().width);
      setDensity((current) => current === nextDensity ? current : nextDensity);
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, [navRef, tabCount]);

  return { density };
};
