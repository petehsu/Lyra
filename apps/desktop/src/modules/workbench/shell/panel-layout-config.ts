export const PANEL_LAYOUT_FALLBACK_VIEWPORT = {
  width: 1440,
  height: 900
} as const;

export const PANEL_LAYOUT_REFERENCE = {
  compactPhoneWidth: 320,
  iphone13MiniWidth: 375,
  iphone13Width: 390
} as const;

const WIDTH_BASE = PANEL_LAYOUT_FALLBACK_VIEWPORT.width;
const HEIGHT_BASE = PANEL_LAYOUT_FALLBACK_VIEWPORT.height;

export const PANEL_LAYOUT_RATIOS = {
  leftMinWidth: PANEL_LAYOUT_REFERENCE.compactPhoneWidth / WIDTH_BASE,
  leftMaxWidth: 0.5,
  leftDefaultWidth: 0.28,
  centerMinWidth: 0.5,
  bottomMinHeight: (PANEL_LAYOUT_REFERENCE.iphone13Width * 0.5) / HEIGHT_BASE,
  bottomMaxHeight: PANEL_LAYOUT_REFERENCE.iphone13Width / HEIGHT_BASE,
  bottomDefaultHeight: 0.24,
  workspaceMinHeight: 0.62
} as const;

export const PANEL_LAYOUT_COUPLING = {
  compressionFactor: 0.12,
  iterationCount: 2
} as const;
