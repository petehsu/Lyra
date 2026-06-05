import { useLayoutEffect, useState, type RefObject } from "react";

import type { BrowserTabStripDensity } from "./tab-strip-render-model";
import {
  computeChromeTabStripLayout,
  type ChromeTabStripLayout
} from "../ui-primitives";

export const useBrowserTabStripLayoutState = (
  tabCount: number,
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
      tabCount,
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
        tabCount,
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

    const measure = (): void => {
      const nextLayout = computeChromeTabStripLayout({
        tabCount,
        stripWidth: strip?.getBoundingClientRect().width ?? 0,
        addButtonWidth: addButton?.getBoundingClientRect().width ?? 0,
        activeIndex,
        stackedMode
      });
      const nextDensity = nextLayout.density;
      setDensity((current) => current === nextDensity ? current : nextDensity);
      setLayout(nextLayout);
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
  }, [activeIndex, navRef, stackedMode, tabCount]);

  return { density, layout };
};
