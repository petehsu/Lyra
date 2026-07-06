// ─── 文本分段 ───────────────────────────────────────────────────────────────
// 将 monaco model 的可见行拆成可渲染的 cells（每段连续文本 → 1 个 glyph instance batch）。
//
// 输入: line text + viewport range + font config
// 输出: GpuCell[]，每个 cell 包含: 字符序列、屏幕位置、字体变体 ID、是否需要 DOM fallback
//
// Per-line fallback 规则（vscode 同构）:
// - RTL 文本 → DOM（GPU 不处理 bidi reordering）
// - 行宽 > 2000 列 → DOM（避免 GPU buffer 爆炸）
// - 包含复杂装饰（非 Regular font）→ DOM

import type { FontConfiguration } from "./glyph-rasterizer";

export type GpuCell = {
  readonly text: string;
  readonly lineIndex: number;
  readonly columnIndex: number;
  readonly x: number; // 屏幕像素 x
  readonly y: number; // 屏幕像素 y
  readonly fontConfig: FontConfiguration;
  readonly fallbackToDom: boolean;
  readonly fallbackReason?: "rtl" | "wide-line" | "complex-decoration";
};

export type ViewportRange = {
  readonly startLine: number; // 1-based
  readonly endLine: number; // 1-based, inclusive
  readonly startColumn: number; // 1-based
  readonly endColumn: number; // 1-based, inclusive
};

export type LineLayout = {
  readonly lineNumber: number; // 1-based
  readonly text: string;
  readonly x: number; // 行起始屏幕像素 x
  readonly y: number; // 行起始屏幕像素 y
  readonly lineHeight: number;
  readonly charWidth: number;
};

export type ContentSegmenterOptions = {
  readonly maxGpuLineColumns: number;
};

const REGULAR_FONT: FontConfiguration = {
  fontFamily: "monospace",
  fontSize: 14,
  fontWeight: "normal",
  fontStyle: "normal",
  fontVariantSettings: ""
};

// RTL 检测: 基本范围检查。ponytail: 不处理复杂 bidi 算法，只是快速判断是否需要 DOM fallback。
// 升级路径: 集成 Intl.Segmenter 或 bidi 算法做更精确的判断。
const hasRtlChar = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Hebrew: 0x0590-0x05FF, Arabic: 0x0600-0x06FF, Syriac: 0x0700-0x074F
    if (
      (code >= 0x0590 && code <= 0x05ff) ||
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0700 && code <= 0x074f)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * 判断单行是否适合 GPU 渲染。
 * 返回 canRender=false 的行保留 DOM visibility: visible。
 */
export const canRenderLine = (
  text: string,
  maxGpuLineColumns: number
): { readonly canRender: boolean; readonly reason?: "rtl" | "wide-line" } => {
  if (text.length > maxGpuLineColumns) {
    return { canRender: false, reason: "wide-line" };
  }
  if (hasRtlChar(text)) {
    return { canRender: false, reason: "rtl" };
  }
  return { canRender: true };
};

export type ContentSegmenter = {
  readonly segmentLine: (layout: LineLayout, viewport: ViewportRange) => readonly GpuCell[];
};

export const createContentSegmenter = (
  options: ContentSegmenterOptions
): ContentSegmenter => {
  const { maxGpuLineColumns } = options;

  const segmentLine = (layout: LineLayout, viewport: ViewportRange): readonly GpuCell[] => {
    const { text, lineNumber, x, y, lineHeight, charWidth } = layout;

    // 行号不在视口内 → 空数组
    if (lineNumber < viewport.startLine || lineNumber > viewport.endLine) {
      return [];
    }

    // 行宽超过阈值 → DOM fallback
    if (text.length > maxGpuLineColumns) {
      return [
        {
          text,
          lineIndex: lineNumber - 1,
          columnIndex: 0,
          x,
          y,
          fontConfig: REGULAR_FONT,
          fallbackToDom: true,
          fallbackReason: "wide-line"
        }
      ];
    }

    // RTL 文本 → DOM fallback
    if (hasRtlChar(text)) {
      return [
        {
          text,
          lineIndex: lineNumber - 1,
          columnIndex: 0,
          x,
          y,
          fontConfig: REGULAR_FONT,
          fallbackToDom: true,
          fallbackReason: "rtl"
        }
      ];
    }

    // 裁剪到视口列范围
    const startCol = Math.max(0, viewport.startColumn - 1);
    const endCol = Math.min(text.length, viewport.endColumn);
    const visibleText = text.slice(startCol, endCol);

    if (visibleText.length === 0) {
      return [];
    }

    // 单个 cell: 整行可见部分作为一段连续文本
    // ponytail: 简化版，不做 token-level 分段（不同 token 可能用不同字体变体）。
    // 升级路径: 接入 monaco tokenization，按 token 分段，每段一个 cell。
    return [
      {
        text: visibleText,
        lineIndex: lineNumber - 1,
        columnIndex: startCol,
        x: x + startCol * charWidth,
        y,
        fontConfig: REGULAR_FONT,
        fallbackToDom: false
      }
    ];
  };

  return { segmentLine };
};

export { REGULAR_FONT };