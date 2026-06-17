import { layout, prepare } from "./engine/layout";

export type EstimateTextareaHeightConfig = {
  /** CSS font shorthand, e.g. '14px "Geist Sans", system-ui, sans-serif'. */
  readonly font: string;
  /** Inner content width in px (client width minus horizontal padding). */
  readonly contentWidth: number;
  /** Line height in px. */
  readonly lineHeight: number;
  /** Vertical padding in px (top + bottom). */
  readonly verticalPadding: number;
  readonly minHeight: number;
  readonly maxHeight: number;
};

const isEmptyTextareaValue = (text: string): boolean =>
  text.length === 0 || (text.trim().length === 0 && !text.includes("\n"));

/**
 * Estimate a textarea's rendered height without reading scrollHeight.
 * Clamps to [minHeight, maxHeight]. Never throws.
 */
export const estimateTextareaHeight = (
  text: string,
  config: EstimateTextareaHeightConfig
): number => {
  if (isEmptyTextareaValue(text)) {
    return config.minHeight;
  }
  if (config.contentWidth <= 0) {
    return config.minHeight;
  }
  try {
    const prepared = prepare(text, config.font);
    const { height } = layout(prepared, config.contentWidth, config.lineHeight);
    if (!Number.isFinite(height) || height <= 0) {
      return config.minHeight;
    }
    const total = Math.round(height + config.verticalPadding);
    return Math.min(config.maxHeight, Math.max(config.minHeight, total));
  } catch {
    return config.minHeight;
  }
};