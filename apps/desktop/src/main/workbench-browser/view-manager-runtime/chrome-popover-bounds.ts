export type ChromePopoverKind = "security" | "find" | "omnibox";

export type ChromePopoverAnchorRect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
};

export type ChromePopoverWindowBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const PADDING = 8;
const GAP = 6;

export const resolveChromePopoverWindowBounds = ({
  kind,
  anchor,
  windowSize,
  popoverWidth,
  popoverHeight
}: {
  readonly kind: ChromePopoverKind;
  readonly anchor: ChromePopoverAnchorRect | null;
  readonly windowSize: { readonly width: number; readonly height: number };
  readonly popoverWidth: number;
  readonly popoverHeight: number;
}): ChromePopoverWindowBounds => {
  const maxWidth = Math.max(220, windowSize.width - PADDING * 2);
  const width = Math.max(220, Math.min(Math.round(popoverWidth), maxWidth));
  const maxHeight = Math.max(54, windowSize.height - PADDING * 2);
  const height = Math.max(54, Math.min(Math.round(popoverHeight), maxHeight));
  const left = anchor?.left ?? PADDING;
  const top = anchor?.top ?? PADDING;
  const bottom = anchor?.bottom ?? top;
  const x = Math.max(
    PADDING,
    Math.min(Math.round(left), windowSize.width - width - PADDING)
  );
  const below = Math.round(bottom + GAP);
  const above = Math.round(top - height - GAP);
  const fitsBelow = below + height <= windowSize.height - PADDING;
  const y = kind === "find" && !fitsBelow && above >= PADDING
    ? above
    : fitsBelow
      ? below
      : Math.max(PADDING, above);
  return { x, y, width, height };
};
