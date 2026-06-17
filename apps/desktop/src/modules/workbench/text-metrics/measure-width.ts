import { measureNaturalWidth, prepareWithSegments } from "./engine/layout";

export type EstimateSingleLineTextWidthConfig = {
  readonly font: string;
};

/**
 * Estimate single-line text width without DOM layout. Returns null when
 * measurement is unavailable. Never throws.
 */
export const estimateSingleLineTextWidth = (
  text: string,
  config: EstimateSingleLineTextWidthConfig
): number | null => {
  const body = text.trim();
  if (body.length === 0) return 0;
  try {
    const prepared = prepareWithSegments(body, config.font);
    const width = measureNaturalWidth(prepared);
    if (!Number.isFinite(width) || width < 0) return null;
    return Math.ceil(width);
  } catch {
    return null;
  }
};

export type TabTitleWidthEstimate = {
  readonly font: string;
  readonly baseWidthPx: number;
  readonly charWidthFallbackPx: number;
};

export const estimateTabTitleContentWidth = (
  title: string,
  estimate: TabTitleWidthEstimate
): number => {
  const trimmed = title.trim();
  const measured = estimateSingleLineTextWidth(trimmed, { font: estimate.font });
  const titleWidth =
    measured ?? trimmed.length * estimate.charWidthFallbackPx;
  return estimate.baseWidthPx + titleWidth;
};