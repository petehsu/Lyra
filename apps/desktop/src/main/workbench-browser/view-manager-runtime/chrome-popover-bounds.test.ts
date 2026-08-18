import { describe, expect, test } from "vitest";

import { resolveChromePopoverWindowBounds } from "./chrome-popover-bounds";

describe("chrome popover window bounds", () => {
  test("places omnibox suggestions below the address bar in window space", () => {
    const bounds = resolveChromePopoverWindowBounds({
      kind: "omnibox",
      anchor: {
        left: 120,
        top: 36,
        right: 520,
        bottom: 68,
        width: 400,
        height: 32
      },
      windowSize: { width: 1280, height: 800 },
      popoverWidth: 400,
      popoverHeight: 180
    });

    expect(bounds).toEqual({
      x: 120,
      y: 74,
      width: 400,
      height: 180
    });
  });

  test("does not clamp an above-the-page address bar into the web contents", () => {
    const bounds = resolveChromePopoverWindowBounds({
      kind: "omnibox",
      anchor: {
        left: 80,
        top: 24,
        right: 500,
        bottom: 54,
        width: 420,
        height: 30
      },
      windowSize: { width: 1100, height: 720 },
      popoverWidth: 420,
      popoverHeight: 200
    });

    expect(bounds.y).toBe(60);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
  });
});
