import { describe, expect, test } from "vitest";

import { computeChromeTabStripLayout } from "../chrome-tab-layout";

describe("chrome tab layout", () => {
  test("keeps the add button inside the strip when its measured width is zero", () => {
    const layout = computeChromeTabStripLayout({
      tabCount: 3,
      titles: ["Home", "Long document title", "Settings"],
      stripWidth: 320,
      addButtonWidth: 0
    });

    expect(layout.addButtonX).toBeLessThanOrEqual(288);
    expect(layout.contentWidth).toBe(288);
  });

  test("uses title-sized tabs until space runs out, then keeps a readable minimum", () => {
    const spacious = computeChromeTabStripLayout({
      tabCount: 2,
      titles: ["A", "Very long page title"],
      stripWidth: 520,
      addButtonWidth: 32
    });
    expect(spacious.items[1]!.width).toBeGreaterThan(spacious.items[0]!.width);
    expect(spacious.totalTabsWidth).toBeLessThanOrEqual(spacious.contentWidth);

    const cramped = computeChromeTabStripLayout({
      tabCount: 6,
      titles: Array.from({ length: 6 }, (_, index) => `Long title ${index + 1}`),
      stripWidth: 260,
      addButtonWidth: 32
    });
    expect(cramped.items.every((item) => item.contentWidth >= 72)).toBe(true);
    expect(cramped.totalTabsWidth).toBeGreaterThan(cramped.contentWidth);
  });

  test("positions rectangular tabs by their full visual width", () => {
    const layout = computeChromeTabStripLayout({
      tabCount: 3,
      titles: ["DMIT", "文档", "Bold Glitch Effect"],
      stripWidth: 520,
      addButtonWidth: 32
    });

    for (let index = 1; index < layout.items.length; index += 1) {
      const previous = layout.items[index - 1]!;
      const current = layout.items[index]!;
      expect(current.x).toBeGreaterThanOrEqual(previous.x + previous.width);
    }
  });

  test("uses text-metrics title widths when titleFont is provided", () => {
    const canvas = document.createElement("canvas");
    const heuristic = computeChromeTabStripLayout({
      tabCount: 2,
      titles: ["文档", "A"],
      stripWidth: 520,
      addButtonWidth: 32
    });
    if (canvas.getContext("2d") === null) {
      return;
    }
    const measured = computeChromeTabStripLayout({
      tabCount: 2,
      titles: ["文档", "A"],
      stripWidth: 520,
      addButtonWidth: 32,
      titleFont: '13px "Geist Sans", system-ui, sans-serif'
    });
    expect(measured.items[0]!.contentWidth).toBeGreaterThan(heuristic.items[0]!.contentWidth);
  });
});
