import { useLayoutEffect, type RefObject } from "react";

import { useWindowResizeClass } from "./use-window-resize-class";

const LYRA_SCROLLBAR_HIDDEN_ATTR = "data-lyra-scrollbar-hidden";
const SCROLLBAR_VISIBILITY_THRESHOLD_PX = 40;

const isOverflowScrollable = (overflowValue: string): boolean =>
  overflowValue === "auto" || overflowValue === "scroll" || overflowValue === "overlay";

const shouldManageScrollbar = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);
  return isOverflowScrollable(style.overflowY) || isOverflowScrollable(style.overflowX);
};

const resolveScrollableDistance = (element: HTMLElement): number => {
  const verticalDistance = Math.max(0, element.scrollHeight - element.clientHeight);
  const horizontalDistance = Math.max(0, element.scrollWidth - element.clientWidth);
  return Math.max(verticalDistance, horizontalDistance);
};

const syncElementScrollbarVisibility = (element: HTMLElement): void => {
  if (shouldManageScrollbar(element) === false) {
    element.removeAttribute(LYRA_SCROLLBAR_HIDDEN_ATTR);
    return;
  }

  const scrollableDistance = resolveScrollableDistance(element);
  if (scrollableDistance <= SCROLLBAR_VISIBILITY_THRESHOLD_PX) {
    element.setAttribute(LYRA_SCROLLBAR_HIDDEN_ATTR, "true");
    return;
  }

  element.removeAttribute(LYRA_SCROLLBAR_HIDDEN_ATTR);
};

export const useScrollbarVisibilityGuard = (rootRef: RefObject<HTMLElement>): void => {
  // Drop heavy backdrop-filter blur during native window-edge resize (paired
  // shell-root global resize effect; panel-splitter drags are handled in
  // use-panel-layout.ts).
  useWindowResizeClass();

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }

    const observedElements = new Set<HTMLElement>();
    const pendingElements = new Set<HTMLElement>();
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLElement) {
          pendingElements.add(entry.target);
        }
      }
      schedulePendingSync();
    });
    const mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList")) {
        scheduleRediscover();
        return;
      }
      for (const record of records) {
        if (record.target instanceof HTMLElement) {
          pendingElements.add(record.target);
        }
      }
      schedulePendingSync();
    });

    let frameId = 0;
    // When true the next frame walks the whole subtree to (un)observe elements;
    // otherwise it only re-evaluates already-observed elements. Resize/scroll set
    // the cheap path; DOM mutations request the full (expensive) rediscovery.
    let needsRediscover = false;

    // Full pass: walk the subtree to start/stop observing scrollable elements.
    // Only triggered by structural DOM mutations, not by every resize/scroll tick.
    const rediscoverObservedElements = () => {
      const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];

      for (const candidate of candidates) {
        if (shouldManageScrollbar(candidate) === false) {
          candidate.removeAttribute(LYRA_SCROLLBAR_HIDDEN_ATTR);
          continue;
        }

        if (observedElements.has(candidate) === false) {
          observedElements.add(candidate);
          resizeObserver.observe(candidate);
        }
      }

      for (const element of observedElements) {
        if (root.contains(element) === false) {
          resizeObserver.unobserve(element);
          observedElements.delete(element);
          continue;
        }

        syncElementScrollbarVisibility(element);
      }
      pendingElements.clear();
    };

    // ResizeObserver already tells us exactly which boxes changed. Restricting
    // the pass to those targets prevents long chat transcripts from making an
    // unrelated panel drag walk every scrollable descendant in the workbench.
    const syncPendingElements = () => {
      for (const element of pendingElements) {
        if (root.contains(element) === false) {
          resizeObserver.unobserve(element);
          observedElements.delete(element);
          continue;
        }
        if (shouldManageScrollbar(element)) {
          if (observedElements.has(element) === false) {
            observedElements.add(element);
            resizeObserver.observe(element);
          }
          syncElementScrollbarVisibility(element);
        } else {
          resizeObserver.unobserve(element);
          observedElements.delete(element);
          element.removeAttribute(LYRA_SCROLLBAR_HIDDEN_ATTR);
        }
      }
      pendingElements.clear();
    };

    const runSync = () => {
      frameId = 0;
      if (needsRediscover) {
        needsRediscover = false;
        rediscoverObservedElements();
      } else {
        syncPendingElements();
      }
    };

    const schedulePendingSync = () => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(runSync);
    };

    const scheduleRediscover = () => {
      needsRediscover = true;
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(runSync);
    };

    mutationObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });

    // Initial pass must discover the elements to observe.
    needsRediscover = true;
    runSync();

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [rootRef]);
};
