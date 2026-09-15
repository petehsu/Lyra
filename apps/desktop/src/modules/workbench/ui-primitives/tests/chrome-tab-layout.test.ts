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

  test("keeps every tab the same width like Chrome when space is roomy", () => {
    const spacious = computeChromeTabStripLayout({
      tabCount: 2,
      titles: ["A", "Very long page title"],
      stripWidth: 520,
      addButtonWidth: 32
    });
    expect(spacious.items[0]!.width).toBe(spacious.items[1]!.width);
    expect(spacious.items[0]!.width).toBe(238);
    expect(spacious.totalTabsWidth).toBeLessThan(spacious.contentWidth);
    expect(spacious.addButtonX).toBe(spacious.contentWidth);
  });

  test("squeezes many tabs to equal widths that fit the strip", () => {
    const cramped = computeChromeTabStripLayout({
      tabCount: 6,
      titles: Array.from({ length: 6 }, (_, index) => `Long title ${index + 1}`),
      stripWidth: 260,
      addButtonWidth: 32
    });
    expect(new Set(cramped.items.map((item) => item.width)).size).toBe(1);
    expect(cramped.totalTabsWidth).toBeLessThanOrEqual(cramped.contentWidth);
    expect(cramped.items[0]!.width).toBe(Math.floor(228 / 6));
  });

  test("fills the strip exactly when squeezed so the add button stays pinned", () => {
    const cramped = computeChromeTabStripLayout({
      tabCount: 7,
      titles: Array.from({ length: 7 }, (_, index) => `Long title ${index + 1}`),
      stripWidth: 400,
      addButtonWidth: 32
    });
    // 368px across 7 tabs leaves a remainder: it must be spread, not dropped.
    expect(cramped.totalTabsWidth).toBe(cramped.contentWidth);
    expect(cramped.addButtonX).toBe(cramped.contentWidth);
    const widths = cramped.items.map((item) => item.width);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  });

  test("stays continuous at the cap boundary instead of jumping", () => {
    const titles = ["A", "A very very long page title that fills space"];
    const capped = computeChromeTabStripLayout({
      tabCount: 2,
      titles,
      stripWidth: 2000,
      addButtonWidth: 32
    });
    expect(capped.items[0]!.width).toBe(238);
    expect(capped.items[1]!.width).toBe(238);
    // 8px tighter than two maxed tabs: both shrink a little, stay equal,
    // and still exactly fill the strip.
    const tightened = computeChromeTabStripLayout({
      tabCount: 2,
      titles,
      stripWidth: 2 * 238 + 32 - 8,
      addButtonWidth: 32
    });
    expect(tightened.items[0]!.width).toBe(tightened.items[1]!.width);
    expect(tightened.items[0]!.width).toBeGreaterThanOrEqual(238 - 8);
    expect(tightened.totalTabsWidth).toBe(tightened.contentWidth);
    expect(tightened.addButtonX).toBe(tightened.contentWidth);
  });

  test("keeps close-lock widths so the next close stays under the cursor", () => {
    const locked = computeChromeTabStripLayout({
      tabCount: 3,
      titles: ["A", "B", "C"],
      stripWidth: 520,
      addButtonWidth: 32,
      closeLockedTabWidth: 88
    });
    expect(locked.items.every((item) => item.width === 88)).toBe(true);
    expect(locked.items[1]!.x).toBe(88);
    expect(locked.totalTabsWidth).toBe(264);
    expect(locked.addButtonX).toBe(locked.contentWidth);
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

  test("ignores title length when sharing width like Chrome", () => {
    const layout = computeChromeTabStripLayout({
      tabCount: 2,
      titles: ["文档", "A"],
      stripWidth: 520,
      addButtonWidth: 32,
      titleFont: '13px "Geist Sans", system-ui, sans-serif'
    });
    expect(layout.items[0]!.width).toBe(layout.items[1]!.width);
  });
});
