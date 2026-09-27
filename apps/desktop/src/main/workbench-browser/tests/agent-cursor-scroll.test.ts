import { describe, expect, test } from "vitest";

import { scrollDeltaToPlacePoint } from "../view-manager-runtime/agent-action-runtime";

const viewport = {
  width: 800,
  height: 600,
  scrollX: 0,
  scrollY: 0,
  maxScrollX: 0,
  maxScrollY: 2_000
};

describe("scrollDeltaToPlacePoint", () => {
  test("nudges a clipped cursor back inside without centering", () => {
    const delta = scrollDeltaToPlacePoint({ x: 400, y: 580 }, viewport, "center");
    expect(delta.deltaX).toBe(0);
    expect(delta.deltaY).toBeGreaterThan(0);
    expect(delta.deltaY).toBeLessThan(80);
  });

  test("leaves a cursor that already fits", () => {
    expect(scrollDeltaToPlacePoint({ x: 400, y: 300 }, viewport, "center")).toEqual({
      deltaX: 0,
      deltaY: 0
    });
  });

  test("still brings a far target into view", () => {
    const delta = scrollDeltaToPlacePoint({ x: 400, y: 1_400 }, viewport, "center");
    expect(delta.deltaY).toBeGreaterThan(800);
  });
});
