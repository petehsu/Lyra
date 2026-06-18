import { describe, expect, test } from "vitest";

import {
  buildHighlightRegionsFromElements,
  cssBoundsToDeviceBounds
} from "../view-manager-runtime/lumen-screenshot-highlights";

describe("lumen-screenshot-highlights", () => {
  test("cssBoundsToDeviceBounds scales and subtracts scroll", () => {
    expect(
      cssBoundsToDeviceBounds(
        { x: 120, y: 240, width: 80, height: 32 },
        { dpr: 2, scrollX: 20, scrollY: 40 }
      )
    ).toEqual({
      x: 200,
      y: 400,
      width: 160,
      height: 64
    });
  });

  test("buildHighlightRegionsFromElements keeps visible interactive elements", () => {
    const regions = buildHighlightRegionsFromElements([
      {
        id: 1,
        targetRef: "lumen:save",
        stableId: "save",
        target: {
          targetRef: "lumen:save",
          targetKind: "button",
          frameRef: "lumen-frame:1",
          frameChain: ["lumen-frame:1"],
          elementFingerprint: "fp",
          mapEpoch: 1,
          expiresAt: Date.now() + 60_000
        },
        frameRef: "lumen-frame:1",
        elementFingerprint: "fp",
        frameTreeNodeId: 1,
        tagName: "button",
        role: "button",
        label: "Save",
        selectorPreview: "button#save",
        bounds: { x: 10, y: 20, width: 80, height: 32 },
        focusable: true,
        disabled: false,
        editable: false,
        visibility: { visible: true, offscreen: false, covered: false, ariaHidden: false }
      }
    ], {
      dpr: 1,
      scrollX: 0,
      scrollY: 0
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]?.targetRef).toBe("lumen:save");
  });
});