// ============================================================================
// text-metrics — workbench-wide DOM-free text measurement
// ============================================================================
//
// Engine sources under ./engine are vendored from the Pretext library (MIT, see
// engine/LICENSE) and adapted as internal modules per the workbench boundary
// rule (no external text-layout dependency).
//
// RENDERER-ONLY: measurement uses OffscreenCanvas / DOM canvas and
// Intl.Segmenter. Never import this from the Electron main or preload processes.
//
// This layer provides height/width estimates for virtualization seeds and
// similar opt-in use cases. Measured DOM heights always win once content mounts.

export { estimateParagraphHeight } from "./estimate";
export type { EstimateParagraphConfig } from "./estimate";
export { estimateTextareaHeight } from "./estimate-textarea";
export type { EstimateTextareaHeightConfig } from "./estimate-textarea";
export {
  estimateSingleLineTextWidth,
  estimateTabTitleContentWidth
} from "./measure-width";
export type {
  EstimateSingleLineTextWidthConfig,
  TabTitleWidthEstimate
} from "./measure-width";
export {
  syncTextareaAutoHeight,
  TEXTAREA_AUTO_HEIGHT_MAX_PX,
  TEXTAREA_AUTO_HEIGHT_MIN_PX,
  useTextareaAutoHeight
} from "./use-textarea-auto-height";
export { prepare, layout } from "./engine/layout";
export type { PreparedText, LayoutResult } from "./engine/layout";