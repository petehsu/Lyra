import { useEffect, useState, type RefObject } from "react";

const FOLD_SCROLL_ROOT = ".lyra-agents-chat-scroll";

const foldControl = (element: HTMLElement): HTMLElement => {
  const control = element.closest("button, [role='button']");
  return control instanceof HTMLElement ? control : element;
};

const foldClipRect = (element: HTMLElement): DOMRect => {
  const scroller = element.closest(FOLD_SCROLL_ROOT);
  if (scroller instanceof HTMLElement) {
    return scroller.getBoundingClientRect();
  }
  return new DOMRect(
    0,
    0,
    window.innerWidth || document.documentElement.clientWidth,
    window.innerHeight || document.documentElement.clientHeight
  );
};

const intersects = (a: DOMRect, b: DOMRect): boolean =>
  a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;

/** True when the fold toggle still sits in the chat viewport and can be clicked. */
export function isFoldAnchorVisuallyAvailable(element: HTMLElement): boolean {
  const rect = foldControl(element).getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  return intersects(rect, foldClipRect(element));
}

export function useFoldAnchorVisible(anchorRef: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let raf = 0;

    const update = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const anchor = anchorRef.current;
        setVisible(anchor ? isFoldAnchorVisuallyAvailable(anchor) : true);
      });
    };

    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorRef]);

  return visible;
}
