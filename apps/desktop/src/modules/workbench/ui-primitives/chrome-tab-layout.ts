export type ChromeTabDensity = "regular" | "small" | "smaller" | "mini";

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
const TAB_CONTENT_OVERLAP_PX = 1;
const TAB_CONTENT_MIN_WIDTH_PX = 24;
const TAB_CONTENT_MAX_WIDTH_PX = 240;
const TAB_SIZE_SMALL_PX = 84;
const TAB_SIZE_SMALLER_PX = 60;
const TAB_SIZE_MINI_PX = 48;
const TAB_ADD_BUTTON_FALLBACK_WIDTH_PX = 32;
const STACKED_TAB_OVERLAP_PX = 8;
const STACKED_ACTIVE_TAB_WIDTH_PX = 156;
const STACKED_COLLAPSED_TAB_WIDTH_PX = 34;

const densityFromContentWidth = (contentWidth: number): ChromeTabDensity => {
  if (contentWidth < TAB_SIZE_MINI_PX) return "mini";
  if (contentWidth < TAB_SIZE_SMALLER_PX) return "smaller";
  if (contentWidth < TAB_SIZE_SMALL_PX) return "small";
  return "regular";
};

const computeRegularWidths = (
  tabCount: number,
  contentWidth: number
): readonly number[] => {
  if (tabCount <= 0 || contentWidth <= 0) return [];
  const cumulativeOverlap = Math.max(0, tabCount - 1) * TAB_CONTENT_OVERLAP_PX;
  const targetWidth =
    (contentWidth - TAB_CONTENT_MARGIN_PX * 2 + cumulativeOverlap) / tabCount;
  const clampedTargetWidth = Math.max(
    TAB_CONTENT_MIN_WIDTH_PX,
    Math.min(TAB_CONTENT_MAX_WIDTH_PX, targetWidth)
  );
  const flooredTargetWidth = Math.floor(clampedTargetWidth);
  const totalTabsWidth =
    flooredTargetWidth * tabCount + TAB_CONTENT_MARGIN_PX * 2 - cumulativeOverlap;
  let extraWidthRemaining = contentWidth - totalTabsWidth;

  return Array.from({ length: tabCount }, () => {
    const extraWidth =
      flooredTargetWidth < TAB_CONTENT_MAX_WIDTH_PX && extraWidthRemaining > 0 ? 1 : 0;
    if (extraWidthRemaining > 0) extraWidthRemaining -= 1;
    return flooredTargetWidth + extraWidth;
  });
};

const layoutFromContentWidths = (
  contentWidths: readonly number[],
  contentOverlap: number
): readonly ChromeTabLayoutItem[] => {
  let position = 0;
  return contentWidths.map((contentWidth, index) => {
    const x = position - index * contentOverlap;
    const width = contentWidth + TAB_CONTENT_MARGIN_PX * 2;
    position += contentWidth;
    return { width, x, contentWidth };
  });
};

const layoutStackedTabs = (
  tabCount: number,
  activeIndex: number
): readonly ChromeTabLayoutItem[] => {
  let x = 0;
  return Array.from({ length: tabCount }, (_, index) => {
    const width =
      index === activeIndex ? STACKED_ACTIVE_TAB_WIDTH_PX : STACKED_COLLAPSED_TAB_WIDTH_PX;
    const item = {
      width,
      x,
      contentWidth: Math.max(0, width - TAB_CONTENT_MARGIN_PX * 2)
    };
    x += width - STACKED_TAB_OVERLAP_PX;
    return item;
  });
};

export const computeChromeTabStripLayout = ({
  tabCount,
  stripWidth,
  addButtonWidth,
  activeIndex = 0,
  stackedMode = false
}: {
  readonly tabCount: number;
  readonly stripWidth: number;
  readonly addButtonWidth: number;
  readonly activeIndex?: number;
  readonly stackedMode?: boolean;
}): ChromeTabStripLayout => {
  const effectiveAddButtonWidth =
    addButtonWidth > 0 ? addButtonWidth : TAB_ADD_BUTTON_FALLBACK_WIDTH_PX;
  const contentWidth = Math.max(0, stripWidth - effectiveAddButtonWidth);
  const items = stackedMode
    ? layoutStackedTabs(tabCount, Math.max(0, Math.min(tabCount - 1, activeIndex)))
    : layoutFromContentWidths(
        computeRegularWidths(tabCount, contentWidth),
        TAB_CONTENT_OVERLAP_PX
      );
  const totalTabsWidth =
    items.length === 0
      ? 0
      : Math.max(...items.map((item) => item.x + item.width));
  const minContentWidth =
    items.length === 0
      ? TAB_CONTENT_MAX_WIDTH_PX
      : Math.min(...items.map((item) => item.contentWidth));

  return {
    density: stackedMode ? "regular" : densityFromContentWidth(minContentWidth),
    items,
    addButtonX: Math.min(totalTabsWidth, Math.max(0, stripWidth - effectiveAddButtonWidth)),
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
