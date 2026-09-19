import { useEffect, useState, type RefObject } from "react";

const STACKED_EDITOR_QUERY = "(max-width: 720px)";

const isStackedEditorLayout = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia(STACKED_EDITOR_QUERY).matches;

const paneRectState = (element: HTMLElement): { intersecting: boolean; inUpperHalf: boolean } => {
  const rect = element.getBoundingClientRect();
  return {
    intersecting: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight,
    inUpperHalf: rect.top < window.innerHeight * 0.5
  };
};

export const useEditorChromeVisible = (
  rootRef: RefObject<HTMLElement | null>
): boolean => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const element = rootRef.current;
    if (element === null) {
      return undefined;
    }
    const update = (): void => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setVisible(isStackedEditorLayout() === false);
        return;
      }
      const { intersecting, inUpperHalf } = paneRectState(element);
      setVisible(intersecting && inUpperHalf && isStackedEditorLayout() === false);
    };
    update();
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(() => {
          update();
        }, { threshold: [0, 0.01, 1] });
    observer?.observe(element);
    const media = typeof window.matchMedia === "function"
      ? window.matchMedia(STACKED_EDITOR_QUERY)
      : null;
    media?.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      media?.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, [rootRef]);

  return visible;
};

export const useEditorSurfaceVisible = (
  rootRef: RefObject<HTMLElement | null>
): boolean => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const element = rootRef.current;
    if (element === null || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((entries[0]?.intersectionRatio ?? 0) > 0);
      },
      { threshold: [0, 0.01, 1] }
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [rootRef]);

  return visible;
};
