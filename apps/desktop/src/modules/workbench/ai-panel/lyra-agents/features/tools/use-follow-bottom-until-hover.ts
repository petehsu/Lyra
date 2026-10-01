import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Pin a scroller to its latest line while `active`.
 * Hovering it leaves the pointer where the user put it; leaving pins again.
 */
export function useFollowBottomUntilHover(
  scrollerRef: RefObject<HTMLElement | null>,
  active: boolean,
  revision: unknown,
  onFollowed?: (scroller: HTMLElement) => void,
): {
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
} {
  const [hovering, setHovering] = useState(false);
  useLayoutEffect(() => {
    if (!active || hovering) {
      return;
    }
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
    onFollowed?.(scroller);
  }, [active, hovering, onFollowed, revision, scrollerRef]);
  return {
    onMouseEnter: () => setHovering(true),
    onMouseLeave: () => setHovering(false),
  };
}
