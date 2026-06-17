import {
  estimateTabTitleContentWidth,
  type TabTitleWidthEstimate
} from "../text-metrics";

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
const TAB_CONTENT_OVERLAP_PX = 0;
const TAB_CONTENT_MIN_WIDTH_PX = 72;
const TAB_CONTENT_MAX_WIDTH_PX = 220;
const TAB_CONTENT_TITLE_CHAR_WIDTH_PX = 7;
const TAB_CONTENT_TITLE_BASE_WIDTH_PX = 48;
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

const preferredTitleContentWidth = (
  title: string,
  titleWidthEstimate?: TabTitleWidthEstimate
): number => {
  if (titleWidthEstimate === undefined) {
    return (
      TAB_CONTENT_TITLE_BASE_WIDTH_PX
      + title.trim().length * TAB_CONTENT_TITLE_CHAR_WIDTH_PX
    );
  }
  return estimateTabTitleContentWidth(title, titleWidthEstimate);
};

const computeRegularWidths = (
  titles: readonly string[],
  contentWidth: number,
  titleWidthEstimate?: TabTitleWidthEstimate
): readonly number[] => {
  const tabCount = titles.length;
  if (tabCount <= 0 || contentWidth <= 0) return [];
  const preferredWidths = titles.map((title) =>
    Math.max(
      TAB_CONTENT_MIN_WIDTH_PX,
      Math.min(
        TAB_CONTENT_MAX_WIDTH_PX,
        preferredTitleContentWidth(title, titleWidthEstimate)
      )
    )
  );
  const availableContentWidth = Math.max(
    0,
    contentWidth - TAB_CONTENT_MARGIN_PX * 2
  );
  const preferredTotalWidth = preferredWidths.reduce((sum, width) => sum + width, 0);
  if (preferredTotalWidth <= availableContentWidth) {
    return preferredWidths.map(Math.floor);
  }

  const minTotalWidth = TAB_CONTENT_MIN_WIDTH_PX * tabCount;
  if (availableContentWidth <= minTotalWidth) {
    return Array.from({ length: tabCount }, () => TAB_CONTENT_MIN_WIDTH_PX);
  }

  const shrinkableTotal = preferredWidths.reduce(
    (sum, width) => sum + Math.max(0, width - TAB_CONTENT_MIN_WIDTH_PX),
    0
  );
  const shrinkTarget = preferredTotalWidth - availableContentWidth;
  return preferredWidths.map((width) => {
    const shrinkable = Math.max(0, width - TAB_CONTENT_MIN_WIDTH_PX);
    const shrink = shrinkableTotal <= 0
      ? 0
      : shrinkTarget * (shrinkable / shrinkableTotal);
    return Math.floor(Math.max(TAB_CONTENT_MIN_WIDTH_PX, width - shrink));
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
    position += width;
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
  titles,
  stripWidth,
  addButtonWidth,
  activeIndex = 0,
  stackedMode = false,
  titleFont
}: {
  readonly tabCount: number;
  readonly titles?: readonly string[];
  readonly stripWidth: number;
  readonly addButtonWidth: number;
  readonly activeIndex?: number;
  readonly stackedMode?: boolean;
  /** When set, tab widths use text-metrics instead of the char-width heuristic. */
  readonly titleFont?: string;
}): ChromeTabStripLayout => {
  const effectiveAddButtonWidth =
    addButtonWidth > 0 ? addButtonWidth : TAB_ADD_BUTTON_FALLBACK_WIDTH_PX;
  const contentWidth = Math.max(0, stripWidth - effectiveAddButtonWidth);
  const effectiveTitles = Array.from({ length: tabCount }, (_, index) => titles?.[index] ?? "");
  const titleWidthEstimate =
    titleFont === undefined
      ? undefined
      : {
          font: titleFont,
          baseWidthPx: TAB_CONTENT_TITLE_BASE_WIDTH_PX,
          charWidthFallbackPx: TAB_CONTENT_TITLE_CHAR_WIDTH_PX
        };
  const items = stackedMode
    ? layoutStackedTabs(tabCount, Math.max(0, Math.min(tabCount - 1, activeIndex)))
    : layoutFromContentWidths(
        computeRegularWidths(effectiveTitles, contentWidth, titleWidthEstimate),
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
