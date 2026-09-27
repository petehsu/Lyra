import { describe, expect, test } from "vitest";

import { humanClickPoint } from "../view-manager-runtime/agent-action-runtime";

describe("humanClickPoint", () => {
  test("stays inside the control and off the edge", () => {
    const bounds = { x: 10, y: 20, width: 80, height: 40 };
    for (let index = 0; index < 40; index += 1) {
      const point = humanClickPoint(bounds, () => index / 40);
      expect(point.x).toBeGreaterThan(bounds.x);
      expect(point.x).toBeLessThan(bounds.x + bounds.width);
      expect(point.y).toBeGreaterThan(bounds.y);
      expect(point.y).toBeLessThan(bounds.y + bounds.height);
    }
  });

  test("uses the middle when the control is too small to wander", () => {
    const point = humanClickPoint({ x: 4, y: 8, width: 3, height: 3 }, () => 0);
    expect(point).toEqual({ x: 6, y: 10 });
  });
});
