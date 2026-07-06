// ─── 渲染策略接口 ───────────────────────────────────────────────────────────
// 两种策略:
//   FullFileRenderStrategy  — <3000 行，整文件上传，dirty line 增量更新
//   ViewportRenderStrategy  — ≥3000 行，每帧只上传视口内 cells

import type { GpuCell } from "./content-segmenter";
import type { ViewportRange } from "./content-segmenter";
import type { BufferDirtyTracker } from "./buffer-dirty-tracker";

export type RenderStrategyUpdateInput = {
  readonly cells: readonly GpuCell[];
  readonly viewport: ViewportRange;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly textColor: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
};

export type RenderStrategy = {
  readonly update: (input: RenderStrategyUpdateInput) => void;
  readonly render: (pass: GPURenderPassEncoder) => void;
  readonly dispose: () => void;
  readonly shouldRerender: () => boolean;
};

export const FULL_FILE_LINE_THRESHOLD = 3000;
export const MAX_COLUMN_THRESHOLD = 200;

/**
 * 根据文件行数和最大列数选择渲染策略。
 * <3000 行且 <200 列 → FullFile（整文件上传，增量更新）
 * 其他 → Viewport（视口渲染）
 */
export const selectRenderStrategy = (
  lineCount: number,
  maxColumn: number
): "full-file" | "viewport" =>
  lineCount < FULL_FILE_LINE_THRESHOLD && maxColumn < MAX_COLUMN_THRESHOLD
    ? "full-file"
    : "viewport";