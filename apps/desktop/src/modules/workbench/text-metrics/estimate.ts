import { layout, prepare } from "./engine/layout";

export type EstimateParagraphConfig = {
  /** CSS font shorthand, e.g. "15px Inter". */
  readonly font: string;
  /** Content width in px the text wraps within. */
  readonly contentWidth: number;
  /** Line height in px. */
  readonly lineHeight: number;
  /** Constant vertical padding/chrome added around the text block, in px. */
  readonly verticalPadding: number;
};

/**
 * Estimate wrapped plain-text height without DOM layout. Returns null when
 * measurement is unavailable or unreliable. Never throws.
 */
export const estimateParagraphHeight = (
  text: string,
  config: EstimateParagraphConfig
): number | null => {
  const body = text.trim();
  if (body.length === 0) return null;
  if (config.contentWidth <= 0) return null;
  try {
    const prepared = prepare(body, config.font);
    const { height } = layout(prepared, config.contentWidth, config.lineHeight);
    if (!Number.isFinite(height) || height <= 0) return null;
    return Math.round(height + config.verticalPadding);
  } catch {
    return null;
  }
};