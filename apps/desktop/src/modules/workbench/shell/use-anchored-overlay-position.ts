import {
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject
} from "react";

export type AnchoredOverlayPlacement = "top" | "bottom";

type AnchoredOverlayPosition = {
  readonly placement: AnchoredOverlayPlacement;
  readonly style: CSSProperties;
};

type UseAnchoredOverlayPositionOptions = {
  readonly open: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly overlayRef: RefObject<HTMLElement | null>;
  readonly boundarySelector?: string;
  readonly offset?: number;
  readonly boundaryPadding?: number;
  readonly minWidth?: number;
  readonly preferredWidth?: number;
  readonly maxWidth?: number;
  readonly matchAnchorWidth?: boolean;
  readonly minHeight?: number;
  readonly maxHeight?: number;
};

const clamp = (value: number, min: number, max: number): number => {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
};

const readViewport = (): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} => {
  const viewport = window.visualViewport;
  if (viewport === undefined || viewport === null) {
    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight
    };
  }
  return {
    left: viewport.offsetLeft,
    top: viewport.offsetTop,
    width: viewport.width,
    height: viewport.height
  };
};

const readOverlayBoundary = (
  anchor: HTMLElement,
  boundarySelector: string | undefined
): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} => {
  const viewport = readViewport();
  const boundary =
    boundarySelector === undefined
      ? null
      : anchor.closest<HTMLElement>(boundarySelector);
  if (boundary === null) {
    return viewport;
  }
  const rect = boundary.getBoundingClientRect();
  const left = Math.max(viewport.left, rect.left);
  const top = Math.max(viewport.top, rect.top);
  const right = Math.min(viewport.left + viewport.width, rect.right);
  const bottom = Math.min(viewport.top + viewport.height, rect.bottom);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
};

export const useAnchoredOverlayPosition = ({
  open,
  anchorRef,
  overlayRef,
  boundarySelector,
  offset = 6,
  boundaryPadding = 8,
  minWidth = 220,
  preferredWidth,
  maxWidth,
  matchAnchorWidth = false,
  minHeight = 96,
  maxHeight = 360
}: UseAnchoredOverlayPositionOptions): AnchoredOverlayPosition => {
  const [position, setPosition] = useState<AnchoredOverlayPosition>({
    placement: "bottom",
    style: {
      position: "fixed",
      top: 0,
      left: 0,
      visibility: "hidden",
      pointerEvents: "none"
    }
  });

  const updatePosition = useCallback((): void => {
    if (!open) {
      return;
    }
    const anchor = anchorRef.current;
    const overlay = overlayRef.current;
    if (anchor === null || overlay === null) {
      return;
    }

    const viewport = readOverlayBoundary(anchor, boundarySelector);
    const anchorRect = anchor.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const viewportLeft = viewport.left + boundaryPadding;
    const viewportTop = viewport.top + boundaryPadding;
    const viewportRight = viewport.left + viewport.width - boundaryPadding;
    const viewportBottom = viewport.top + viewport.height - boundaryPadding;
    const maxAvailableWidth = Math.max(minWidth, viewportRight - viewportLeft);
    const targetWidth = matchAnchorWidth
      ? anchorRect.width
      : preferredWidth ?? overlayRect.width;
    const resolvedMaxWidth = Math.min(maxWidth ?? maxAvailableWidth, maxAvailableWidth);
    const width = clamp(
      Math.round(targetWidth > 0 ? targetWidth : minWidth),
      Math.min(minWidth, resolvedMaxWidth),
      resolvedMaxWidth
    );
    const left = clamp(
      Math.round(anchorRect.left),
      viewportLeft,
      viewportRight - width
    );

    const spaceBelow = viewportBottom - anchorRect.bottom - offset;
    const spaceAbove = anchorRect.top - viewportTop - offset;
    const naturalHeight = Math.max(
      minHeight,
      Math.round(overlayRect.height > 0 ? overlayRect.height : minHeight)
    );
    const canFitBelow = spaceBelow >= Math.min(naturalHeight, maxHeight);
    const placement: AnchoredOverlayPlacement =
      canFitBelow || spaceBelow >= spaceAbove ? "bottom" : "top";
    const boundaryHeight = Math.max(0, viewportBottom - viewportTop);
    const constrainedToBoundary = Math.max(spaceBelow, spaceAbove) < minHeight;
    const availableHeight = constrainedToBoundary
      ? boundaryHeight
      : Math.max(0, placement === "bottom" ? spaceBelow : spaceAbove);
    const heightLimit = Math.max(1, Math.min(maxHeight, availableHeight));
    const visibleHeight = Math.min(naturalHeight, heightLimit);
    const top = constrainedToBoundary
      ? Math.round(viewportTop)
      : placement === "bottom"
        ? Math.round(anchorRect.bottom + offset)
        : Math.round(anchorRect.top - offset - visibleHeight);

    setPosition({
      placement,
      style: {
        position: "fixed",
        top,
        left,
        width,
        maxHeight: Math.round(heightLimit),
        visibility: "visible",
        pointerEvents: "auto"
      }
    });
  }, [
    anchorRef,
    boundaryPadding,
    boundarySelector,
    matchAnchorWidth,
    maxHeight,
    maxWidth,
    minHeight,
    minWidth,
    offset,
    open,
    overlayRef,
    preferredWidth
  ]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition((current) => ({
        ...current,
        style: {
          ...current.style,
          visibility: "hidden",
          pointerEvents: "none"
        }
      }));
      return undefined;
    }

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    const viewport = window.visualViewport;
    const overlay = overlayRef.current;
    const anchor = anchorRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updatePosition);
    if (anchor !== null) resizeObserver?.observe(anchor);
    if (overlay !== null) resizeObserver?.observe(overlay);

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    viewport?.addEventListener("resize", updatePosition);
    viewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      viewport?.removeEventListener("resize", updatePosition);
      viewport?.removeEventListener("scroll", updatePosition);
      resizeObserver?.disconnect();
    };
  }, [anchorRef, open, overlayRef, updatePosition]);

  return position;
};
