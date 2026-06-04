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

const resolveAvailableTabListWidth = (host: HTMLElement): number => {
  const strip = host.querySelector<HTMLElement>(".lyra-browser-tab-strip");
  const list = host.querySelector<HTMLElement>(".lyra-browser-tab-list");
  if (strip === null) {
    return list?.getBoundingClientRect().width ?? 0;
  }
  const addButton = strip.querySelector<HTMLElement>(".lyra-browser-tab-add");
  const stripWidth = strip.getBoundingClientRect().width;
  const addButtonWidth = addButton?.getBoundingClientRect().width ?? 0;
  if (stripWidth <= 0) {
    return list?.getBoundingClientRect().width ?? 0;
  }
  return Math.max(0, stripWidth - addButtonWidth);
};

export const useBrowserTabStripLayoutState = (
  tabCount: number,
  navRef: RefObject<HTMLElement>,
  stackedMode: boolean
): {
  readonly density: BrowserTabStripDensity;
} => {
  const [density, setDensity] = useState<BrowserTabStripDensity>("regular");

  useLayoutEffect(() => {
    const host = navRef.current;
    if (host === null) {
      setDensity("regular");
      return;
    }
    const strip = host.querySelector<HTMLElement>(".lyra-browser-tab-strip");
    const list = host.querySelector<HTMLElement>(".lyra-browser-tab-list");
    const addButton = host.querySelector<HTMLElement>(".lyra-browser-tab-add");

    const measure = (): void => {
      const nextDensity = stackedMode
        ? "regular"
        : resolveDensity(tabCount, resolveAvailableTabListWidth(host));
      setDensity((current) => current === nextDensity ? current : nextDensity);
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(measure);
    if (strip !== null) {
      observer.observe(strip);
    }
    if (list !== null) {
      observer.observe(list);
    }
    if (addButton !== null) {
      observer.observe(addButton);
    }
    return () => {
      observer.disconnect();
    };
  }, [navRef, stackedMode, tabCount]);

  return { density };
};
