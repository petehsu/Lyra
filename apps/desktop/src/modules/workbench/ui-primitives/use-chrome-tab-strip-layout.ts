import { useLayoutEffect, useState, type RefObject } from "react";

import { createRafCoalescer } from "../shell/raf-coalesce";
import { subscribeLayoutResizeEnd } from "../shell/use-panel-layout";
import {
  chromeTabStripLayoutsEqual,
  computeChromeTabStripLayout,
  type ChromeTabStripLayout
} from "./chrome-tab-layout";

const readObservedWidth = (entry: ResizeObserverEntry): number => {
  const box = entry.borderBoxSize?.[0];
  if (box !== undefined && Number.isFinite(box.inlineSize)) {
    return Math.round(box.inlineSize);
  }
  return Math.round(entry.contentRect.width);
};

export const useChromeTabStripLayout = ({
  titles,
  hostRef,
  stripSelector,
  addButtonSelector,
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

    let observedStripWidth = strip === null ? 0 : Math.round(strip.clientWidth);
    let observedAddButtonWidth = addButton === null ? 0 : Math.round(addButton.clientWidth);
    let lastStripWidth = -1;
    let lastAddButtonWidth = -1;
    let lastTitlesKey = "";
    let lastCloseLockedTabWidth: number | null = null;
    const publish = (): void => {
      const stripWidth = observedStripWidth;
      const addButtonWidth = observedAddButtonWidth;
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
      const nextLayout = computeChromeTabStripLayout({
        tabCount: titles.length,
        titles,
        stripWidth,
        addButtonWidth,
        closeLockedTabWidth
      });
      setLayout((current) => chromeTabStripLayoutsEqual(current, nextLayout) ? current : nextLayout);
    };
    publish();

    if (typeof ResizeObserver === "undefined") {
      return subscribeLayoutResizeEnd(() => {
        observedStripWidth = strip === null ? 0 : Math.round(strip.clientWidth);
        observedAddButtonWidth = addButton === null ? 0 : Math.round(addButton.clientWidth);
        publish();
      });
    }

    const coalescer = createRafCoalescer(publish);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = readObservedWidth(entry);
        if (entry.target === strip) {
          observedStripWidth = width;
        } else if (entry.target === addButton) {
          observedAddButtonWidth = width;
        }
      }
      coalescer.schedule();
    });
    if (strip !== null) {
      observer.observe(strip);
    }
    if (addButton !== null) {
      observer.observe(addButton);
    }
    const unsubscribeResizeEnd = subscribeLayoutResizeEnd(publish);
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
    titles
  ]);

  return layout;
};
