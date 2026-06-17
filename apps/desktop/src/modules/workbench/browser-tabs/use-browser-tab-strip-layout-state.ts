import { useLayoutEffect, useState, type RefObject } from "react";

import type { BrowserTabStripDensity } from "./tab-strip-render-model";
import {
  computeChromeTabStripLayout,
  type ChromeTabStripLayout
} from "../ui-primitives";
import { createRafCoalescer } from "../shell/raf-coalesce";
import {
  getIsLayoutResizing,
  subscribeLayoutResizeEnd
} from "../shell/use-panel-layout";

const readBrowserTabTitleFont = (host: HTMLElement): string | undefined => {
  const sample = host.querySelector<HTMLElement>(".lyra-browser-tab-title");
  if (sample === null) return undefined;
  const font = getComputedStyle(sample).font;
  return font.length > 0 ? font : undefined;
};

export const useBrowserTabStripLayoutState = (
  tabTitles: readonly string[],
  activeIndex: number,
  navRef: RefObject<HTMLElement>,
  stackedMode: boolean
): {
  readonly density: BrowserTabStripDensity;
  readonly layout: ChromeTabStripLayout;
} => {
  const [density, setDensity] = useState<BrowserTabStripDensity>("regular");
  const [layout, setLayout] = useState<ChromeTabStripLayout>(() =>
    computeChromeTabStripLayout({
      tabCount: tabTitles.length,
      titles: tabTitles,
      stripWidth: 0,
      addButtonWidth: 0,
      activeIndex,
      stackedMode
    })
  );

  useLayoutEffect(() => {
    const host = navRef.current;
    if (host === null) {
      const emptyLayout = computeChromeTabStripLayout({
        tabCount: tabTitles.length,
        titles: tabTitles,
        stripWidth: 0,
        addButtonWidth: 0,
        activeIndex,
        stackedMode
      });
      setDensity(emptyLayout.density);
      setLayout(emptyLayout);
      return;
    }
    const strip = host.querySelector<HTMLElement>(".lyra-browser-tab-strip");
    const list = host.querySelector<HTMLElement>(".lyra-browser-tab-list");
    const addButton = host.querySelector<HTMLElement>(".lyra-browser-tab-add");

    // Skip recompute when neither measured width changed across a resize burst.
    let lastStripWidth = -1;
    let lastAddButtonWidth = -1;
    const measure = (): void => {
      if (getIsLayoutResizing()) {
        return;
      }
      const stripWidth = strip?.getBoundingClientRect().width ?? 0;
      const addButtonWidth = addButton?.getBoundingClientRect().width ?? 0;
      if (stripWidth === lastStripWidth && addButtonWidth === lastAddButtonWidth) {
        return;
      }
      lastStripWidth = stripWidth;
      lastAddButtonWidth = addButtonWidth;
      const titleFont = readBrowserTabTitleFont(host);
      const nextLayout = computeChromeTabStripLayout({
        tabCount: tabTitles.length,
        titles: tabTitles,
        stripWidth,
        addButtonWidth,
        activeIndex,
        stackedMode,
        ...(titleFont === undefined ? {} : { titleFont })
      });
      const nextDensity = nextLayout.density;
      setDensity((current) => current === nextDensity ? current : nextDensity);
      setLayout(nextLayout);
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      return subscribeLayoutResizeEnd(measure);
    }

    // Coalesce the resize storm into one measure per animation frame.
    const coalescer = createRafCoalescer(measure);
    const observer = new ResizeObserver(() => coalescer.schedule());
    if (strip !== null) {
      observer.observe(strip);
    }
    if (list !== null) {
      observer.observe(list);
    }
    if (addButton !== null) {
      observer.observe(addButton);
    }
    const unsubscribeResizeEnd = subscribeLayoutResizeEnd(() => {
      lastStripWidth = -1;
      lastAddButtonWidth = -1;
      measure();
    });
    return () => {
      observer.disconnect();
      coalescer.cancel();
      unsubscribeResizeEnd();
    };
  }, [activeIndex, navRef, stackedMode, tabTitles]);

  return { density, layout };
};
