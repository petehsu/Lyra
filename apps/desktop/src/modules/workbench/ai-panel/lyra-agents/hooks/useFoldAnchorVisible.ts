import { useEffect, useState, type RefObject } from "react";

function isElementVisuallyAvailable(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.right <= 0 ||
    rect.bottom <= 0 ||
    rect.left >= viewportWidth ||
    rect.top >= viewportHeight
  ) {
    return false;
  }

  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), viewportWidth - 1);
  const y = Math.min(Math.max(rect.top + rect.height / 2, 0), viewportHeight - 1);
  const topElement = document.elementFromPoint(x, y);

  return !!topElement && (element === topElement || element.contains(topElement));
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
        setVisible(anchor ? isElementVisuallyAvailable(anchor) : true);
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
