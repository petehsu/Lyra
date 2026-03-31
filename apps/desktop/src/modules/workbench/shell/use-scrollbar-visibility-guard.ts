import { useEffect, type RefObject } from "react";

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
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }

    const observedElements = new Set<HTMLElement>();
    const resizeObserver = new ResizeObserver(() => {
      scheduleSync();
    });
    const mutationObserver = new MutationObserver(() => {
      scheduleSync();
    });

    let frameId = 0;

    const refreshObservedElements = () => {
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
    };

    const runSync = () => {
      frameId = 0;
      refreshObservedElements();
    };

    const scheduleSync = () => {
      if (frameId !== 0) {
        return;
      }

      frameId = window.requestAnimationFrame(runSync);
    };

    mutationObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });
    window.addEventListener("resize", scheduleSync);
    root.addEventListener("scroll", scheduleSync, true);

    scheduleSync();

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleSync);
      root.removeEventListener("scroll", scheduleSync, true);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [rootRef]);
};

