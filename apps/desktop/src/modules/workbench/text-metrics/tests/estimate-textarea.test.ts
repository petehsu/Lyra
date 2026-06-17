import { describe, expect, test } from "vitest";

import { estimateTextareaHeight } from "../estimate-textarea";

const config = {
  font: '14px "Geist Sans", system-ui, sans-serif',
  contentWidth: 280,
  lineHeight: 22,
  verticalPadding: 16,
  minHeight: 64,
  maxHeight: 200
} as const;

const canvasAvailable = (): boolean => {
  const canvas = document.createElement("canvas");
  return canvas.getContext("2d") !== null;
};

describe("estimateTextareaHeight", () => {
  test("returns min height for empty text", () => {
    expect(estimateTextareaHeight("", config)).toBe(config.minHeight);
    expect(estimateTextareaHeight("   ", config)).toBe(config.minHeight);
  });

  test("returns a taller height for multi-line text when canvas measurement works", () => {
    const height = estimateTextareaHeight("Line one\nLine two\nLine three", config);
    if (!canvasAvailable()) {
      expect(height).toBe(config.minHeight);
      return;
    }
    expect(height).toBeGreaterThan(config.minHeight);
    expect(height).toBeLessThanOrEqual(config.maxHeight);
  });

  test("clamps to max height", () => {
    const longText = Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join("\n");
    const height = estimateTextareaHeight(longText, config);
    expect(height).toBeLessThanOrEqual(config.maxHeight);
  });
});