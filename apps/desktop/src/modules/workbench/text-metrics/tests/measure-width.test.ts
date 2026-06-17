import { describe, expect, test } from "vitest";

import {
  estimateSingleLineTextWidth,
  estimateTabTitleContentWidth
} from "../measure-width";

const font = '13px "Geist Sans", system-ui, sans-serif';

const canvasAvailable = (): boolean => {
  const canvas = document.createElement("canvas");
  return canvas.getContext("2d") !== null;
};

describe("estimateSingleLineTextWidth", () => {
  test("returns zero for empty titles", () => {
    expect(estimateSingleLineTextWidth("   ", { font })).toBe(0);
  });

  test("measures wider glyphs for CJK than ASCII when canvas works", () => {
    if (!canvasAvailable()) return;
    const ascii = estimateSingleLineTextWidth("abc", { font });
    const cjk = estimateSingleLineTextWidth("文档", { font });
    expect(ascii).not.toBeNull();
    expect(cjk).not.toBeNull();
    expect(cjk!).toBeGreaterThan(ascii!);
  });
});

describe("estimateTabTitleContentWidth", () => {
  test("falls back to char width heuristic when measurement is unavailable", () => {
    const width = estimateTabTitleContentWidth("Hello", {
      font,
      baseWidthPx: 48,
      charWidthFallbackPx: 7
    });
    if (canvasAvailable()) {
      expect(width).toBeGreaterThan(48);
      return;
    }
    expect(width).toBe(48 + "Hello".length * 7);
  });
});