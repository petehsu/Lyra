export type ChromeTabDensity = "regular";

export type ChromeTabLayoutItem = {
  readonly width: number;
  readonly x: number;
  readonly contentWidth: number;
};

export type ChromeTabStripLayout = {
  readonly density: ChromeTabDensity;
  readonly items: readonly ChromeTabLayoutItem[];
  readonly addButtonX: number;
  readonly contentWidth: number;
  readonly totalTabsWidth: number;
};

const TAB_CONTENT_MARGIN_PX = 9;
const TAB_CONTENT_MAX_WIDTH_PX = 220;
const TAB_ADD_BUTTON_FALLBACK_WIDTH_PX = 32;

const TAB_FULL_MAX_WIDTH_PX = TAB_CONTENT_MAX_WIDTH_PX + TAB_CONTENT_MARGIN_PX * 2;

const roundPx = (value: number): number => Math.max(0, Math.round(value));

const layoutFromFullWidths = (widths: readonly number[]): readonly ChromeTabLayoutItem[] => {
  let x = 0;
  return widths.map((width) => {
    const nextWidth = roundPx(width);
    const item = {
      width: nextWidth,
      x,
      contentWidth: Math.max(0, nextWidth - TAB_CONTENT_MARGIN_PX * 2)
    };
    x += nextWidth;
    return item;
  });
};

export const chromeTabStripLayoutsEqual = (
  left: ChromeTabStripLayout,
  right: ChromeTabStripLayout
): boolean => {
  if (
    left.addButtonX !== right.addButtonX
    || left.contentWidth !== right.contentWidth
    || left.totalTabsWidth !== right.totalTabsWidth
    || left.items.length !== right.items.length
  ) {
    return false;
  }
  return left.items.every((item, index) => {
    const other = right.items[index];
    return other !== undefined
      && item.width === other.width
      && item.x === other.x
      && item.contentWidth === other.contentWidth;
  });
};

export const computeChromeTabStripLayout = ({
  tabCount,
  titles,
  stripWidth,
  addButtonWidth,
  titleFont,
  closeLockedTabWidth = null
}: {
  // Chrome-like: every tab shares one width regardless of its title, so
  // `titles`/`titleFont` only ride along for API compatibility and are not
  // used for sizing.
  readonly tabCount: number;
  readonly titles?: readonly string[];
  readonly stripWidth: number;
  readonly addButtonWidth: number;
  readonly titleFont?: string;
  readonly closeLockedTabWidth?: number | null;
}): ChromeTabStripLayout => {
  const effectiveAddButtonWidth = roundPx(
    addButtonWidth > 0 ? addButtonWidth : TAB_ADD_BUTTON_FALLBACK_WIDTH_PX
  );
  const contentWidth = Math.max(0, roundPx(stripWidth) - effectiveAddButtonWidth);
  const lockedWidth = closeLockedTabWidth === null ? null : roundPx(closeLockedTabWidth);
  // Roomy strips cap every tab at the max width (row left-aligned, extra
  // space between the last tab and the plus); tighter strips split the
  // space evenly and spread rounding leftovers one pixel per tab so the row
  // exactly fills the strip. The plus stays pinned to the trailing edge so
  // its gap to the overflow/menu on the right does not drift.
  const uniformFill = (budget: number): number[] => {
    const base = Math.max(1, Math.floor(budget / tabCount));
    const widths = Array.from({ length: tabCount }, () => base);
    let assigned = base * tabCount;
    for (let index = 0; index < tabCount && assigned < budget; index += 1) {
      widths[index]! += 1;
      assigned += 1;
    }
    return widths;
  };
  const widths =
    tabCount <= 0
      ? []
      : lockedWidth !== null && lockedWidth > 0
        ? Array.from({ length: tabCount }, () => lockedWidth)
        : contentWidth <= 0 || contentWidth / tabCount >= TAB_FULL_MAX_WIDTH_PX
          ? Array.from({ length: tabCount }, () => TAB_FULL_MAX_WIDTH_PX)
          : uniformFill(contentWidth);

  const items = layoutFromFullWidths(widths);
  const totalTabsWidth = items.length === 0
    ? 0
    : items[items.length - 1]!.x + items[items.length - 1]!.width;

  return {
    density: "regular",
    items,
    // Pin the plus to the trailing edge of the tab area so its gap to the
    // overflow/menu on the right stays constant as tabs appear, shrink, or
    // close-lock. Extra space sits between the last tab and the plus.
    addButtonX: contentWidth,
    contentWidth,
    totalTabsWidth
  };
};

export const closestChromeTabLayoutIndex = (
  value: number,
  items: readonly ChromeTabLayoutItem[]
): number => {
  let closestDistance = Infinity;
  let closestIndex = -1;
  items.forEach((item, index) => {
    const distance = Math.abs(value - item.x);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return closestIndex;
};
