import { describe, expect, test } from "vitest";

import { estimateParagraphHeight } from "../estimate";

const config = {
  font: '15px "Geist Sans", system-ui, sans-serif',
  contentWidth: 320,
  lineHeight: 22,
  verticalPadding: 48
} as const;

const canvasAvailable = (): boolean => {
  const canvas = document.createElement("canvas");
  return canvas.getContext("2d") !== null;
};

describe("estimateParagraphHeight", () => {
  test("returns a positive height for plain text when canvas measurement works", () => {
    const height = estimateParagraphHeight("Hello from Lyra.", config);
    if (!canvasAvailable()) {
      expect(height).toBeNull();
      return;
    }
    expect(height).not.toBeNull();
    expect(height!).toBeGreaterThan(config.verticalPadding);
  });

  test("returns null for empty text", () => {
    expect(estimateParagraphHeight("   ", config)).toBeNull();
  });

  test("returns null for non-positive content width", () => {
    expect(estimateParagraphHeight("hello", { ...config, contentWidth: 0 })).toBeNull();
  });
});