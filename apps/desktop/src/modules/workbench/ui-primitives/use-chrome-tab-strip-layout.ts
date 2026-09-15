import { useLayoutEffect, useState, type RefObject } from "react";

import { createRafCoalescer } from "../shell/raf-coalesce";
import {
  getIsLayoutResizing,
  subscribeLayoutResizeEnd
} from "../shell/use-panel-layout";
import {
  chromeTabStripLayoutsEqual,
  computeChromeTabStripLayout,
  type ChromeTabStripLayout
} from "./chrome-tab-layout";

const readTitleFont = (host: HTMLElement, titleSelector: string): string | undefined => {
  const sample = host.querySelector<HTMLElement>(titleSelector);
  if (sample === null) return undefined;
  const font = getComputedStyle(sample).font;
  return font.length > 0 ? font : undefined;
};

export const useChromeTabStripLayout = ({
  titles,
  hostRef,
  stripSelector,
  addButtonSelector,
  titleSelector,
  closeLockedTabWidth = null
}: {
  readonly titles: readonly string[];
  readonly hostRef: RefObject<HTMLElement | null>;
  readonly stripSelector: string;
  readonly addButtonSelector: string;
  readonly titleSelector: string;
  readonly closeLockedTabWidth?: number | null;
}): ChromeTabStripLayout => {
  const [layout, setLayout] = useState<ChromeTabStripLayout>(() =>
    computeChromeTabStripLayout({
      tabCount: titles.length,
      titles,
      stripWidth: 0,
      addButtonWidth: 0,
      closeLockedTabWidth
    })
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      const emptyLayout = computeChromeTabStripLayout({
        tabCount: titles.length,
        titles,
        stripWidth: 0,
        addButtonWidth: 0,
        closeLockedTabWidth
      });
      setLayout((current) => chromeTabStripLayoutsEqual(current, emptyLayout) ? current : emptyLayout);
      return;
    }
    const strip = host.querySelector<HTMLElement>(stripSelector);
    const addButton = host.querySelector<HTMLElement>(addButtonSelector);

    let lastStripWidth = -1;
    let lastAddButtonWidth = -1;
    let lastTitlesKey = "";
    let lastCloseLockedTabWidth: number | null = null;
    const measure = (): void => {
      if (getIsLayoutResizing()) {
        return;
      }
      const stripWidth = Math.round(strip?.getBoundingClientRect().width ?? 0);
      const addButtonWidth = Math.round(addButton?.getBoundingClientRect().width ?? 0);
      const titlesKey = titles.join("\0");
      if (
        stripWidth === lastStripWidth
        && addButtonWidth === lastAddButtonWidth
        && titlesKey === lastTitlesKey
        && closeLockedTabWidth === lastCloseLockedTabWidth
      ) {
        return;
      }
      lastStripWidth = stripWidth;
      lastAddButtonWidth = addButtonWidth;
      lastTitlesKey = titlesKey;
      lastCloseLockedTabWidth = closeLockedTabWidth;
      const titleFont = readTitleFont(host, titleSelector);
      const nextLayout = computeChromeTabStripLayout({
        tabCount: titles.length,
        titles,
        stripWidth,
        addButtonWidth,
        closeLockedTabWidth,
        ...(titleFont === undefined ? {} : { titleFont })
      });
      setLayout((current) => chromeTabStripLayoutsEqual(current, nextLayout) ? current : nextLayout);
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      return subscribeLayoutResizeEnd(measure);
    }

    const coalescer = createRafCoalescer(measure);
    const observer = new ResizeObserver(() => coalescer.schedule());
    if (strip !== null) {
      observer.observe(strip);
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
  }, [
    addButtonSelector,
    closeLockedTabWidth,
    hostRef,
    stripSelector,
    titleSelector,
    titles
  ]);

  return layout;
};
