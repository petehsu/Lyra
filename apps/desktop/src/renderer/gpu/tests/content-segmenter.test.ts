// 自检: ContentSegmenter 文本分段逻辑

import { describe, it, expect } from "vitest";
import { createContentSegmenter, REGULAR_FONT } from "../content-segmenter";
import type { LineLayout, ViewportRange } from "../content-segmenter";

const makeLayout = (lineNumber: number, text: string): LineLayout => ({
  lineNumber,
  text,
  x: 0,
  y: (lineNumber - 1) * 18,
  lineHeight: 18,
  charWidth: 8
});

const FULL_VIEWPORT: ViewportRange = {
  startLine: 1,
  endLine: 100,
  startColumn: 1,
  endColumn: 200
};

describe("ContentSegmenter", () => {
  it("普通 ASCII 文本生成单个 GPU cell", () => {
    const segmenter = createContentSegmenter({ maxGpuLineColumns: 200 });
    const cells = segmenter.segmentLine(makeLayout(1, "hello world"), FULL_VIEWPORT);

    expect(cells).toHaveLength(1);
    expect(cells[0]!.fallbackToDom).toBe(false);
    expect(cells[0]!.text).toBe("hello world");
  });

  it("RTL 文本回退到 DOM", () => {
    const segmenter = createContentSegmenter({ maxGpuLineColumns: 200 });
    const cells = segmenter.segmentLine(makeLayout(1, "שלום"), FULL_VIEWPORT);

    expect(cells).toHaveLength(1);
    expect(cells[0]!.fallbackToDom).toBe(true);
    expect(cells[0]!.fallbackReason).toBe("rtl");
  });

  it("行宽超过阈值回退到 DOM", () => {
    const segmenter = createContentSegmenter({ maxGpuLineColumns: 10 });
    const longText = "a".repeat(15);
    const cells = segmenter.segmentLine(makeLayout(1, longText), FULL_VIEWPORT);

    expect(cells).toHaveLength(1);
    expect(cells[0]!.fallbackToDom).toBe(true);
    expect(cells[0]!.fallbackReason).toBe("wide-line");
  });

  it("行号不在视口内返回空数组", () => {
    const segmenter = createContentSegmenter({ maxGpuLineColumns: 200 });
    const cells = segmenter.segmentLine(makeLayout(200, "text"), {
      startLine: 1,
      endLine: 50,
      startColumn: 1,
      endColumn: 200
    });

    expect(cells).toHaveLength(0);
  });

  it("视口列裁剪: 只返回可见列范围内的文本", () => {
    const segmenter = createContentSegmenter({ maxGpuLineColumns: 200 });
    const cells = segmenter.segmentLine(makeLayout(1, "hello world"), {
      startLine: 1,
      endLine: 1,
      startColumn: 3,
      endColumn: 8
    });

    expect(cells).toHaveLength(1);
    expect(cells[0]!.text).toBe("llo wo");
    expect(cells[0]!.columnIndex).toBe(2);
    // x = 0 + 2 * 8 = 16
    expect(cells[0]!.x).toBe(16);
  });

  it("REGULAR_FONT 导出为默认字体配置", () => {
    expect(REGULAR_FONT.fontFamily).toBe("monospace");
    expect(REGULAR_FONT.fontSize).toBe(14);
    expect(REGULAR_FONT.fontWeight).toBe("normal");
  });
});