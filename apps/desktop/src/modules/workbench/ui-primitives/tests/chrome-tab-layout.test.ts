import { describe, expect, test } from "vitest";

import { computeChromeTabStripLayout } from "../chrome-tab-layout";

describe("chrome tab layout", () => {
  test("keeps the add button inside the strip when its measured width is zero", () => {
    const layout = computeChromeTabStripLayout({
      tabCount: 3,
      stripWidth: 320,
      addButtonWidth: 0
    });

    expect(layout.addButtonX).toBeLessThanOrEqual(288);
    expect(layout.contentWidth).toBe(288);
  });
});
