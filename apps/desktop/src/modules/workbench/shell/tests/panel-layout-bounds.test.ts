import { describe, expect, test } from "vitest";

import { resolveCoupledPanelSizes, resolvePanelSizeBounds } from "../service";

describe("panel layout bounds", () => {
  test("falls back to default viewport when incoming size is invalid", () => {
    const bounds = resolvePanelSizeBounds({
      width: Number.NaN,
      height: 0
    });

    expect(bounds.viewportWidth).toBe(1440);
    expect(bounds.viewportHeight).toBe(900);
    expect(bounds.leftMinWidth).toBeGreaterThan(0);
    expect(bounds.bottomMinHeight).toBeGreaterThan(0);
  });

  test("allows the AI panel and workspace to reach an equal-width split", () => {
    const bounds = resolvePanelSizeBounds({
      width: 1440,
      height: 900
    });

    expect(bounds.leftMinWidth).toBe(320);
    expect(bounds.leftMaxWidth).toBe(720);
    expect(bounds.centerMinWidth).toBe(720);
    expect(bounds.leftDefaultWidth).toBeGreaterThanOrEqual(bounds.leftMinWidth);
    expect(bounds.leftDefaultWidth).toBeLessThanOrEqual(bounds.leftMaxWidth);
    expect(bounds.leftMaxWidth + bounds.centerMinWidth).toBe(bounds.viewportWidth);
  });

  test("keeps the coupled AI panel close to half the viewport", () => {
    const bounds = resolvePanelSizeBounds({
      width: 1440,
      height: 900
    });
    const stabilized = resolveCoupledPanelSizes(
      {
        leftWidth: bounds.leftMaxWidth,
        bottomHeight: bounds.bottomDefaultHeight
      },
      bounds
    );

    expect(stabilized.leftWidth).toBeGreaterThanOrEqual(
      Math.round(bounds.viewportWidth * 0.49)
    );
    expect(stabilized.leftWidth).toBeLessThanOrEqual(bounds.viewportWidth / 2);
  });

  test("derives terminal height bounds from iphone-like ratio", () => {
    const bounds = resolvePanelSizeBounds({
      width: 1440,
      height: 900
    });

    expect(bounds.bottomMinHeight).toBe(195);
    expect(bounds.bottomMaxHeight).toBe(279);
    expect(bounds.bottomMaxHeight).toBeLessThanOrEqual(Math.floor(bounds.workspaceMinHeight / 2));
    expect(bounds.bottomDefaultHeight).toBeGreaterThanOrEqual(bounds.bottomMinHeight);
    expect(bounds.bottomDefaultHeight).toBeLessThanOrEqual(bounds.bottomMaxHeight);
    expect(bounds.bottomMaxHeight + bounds.workspaceMinHeight).toBeLessThanOrEqual(
      bounds.viewportHeight
    );
  });

  test("keeps center workspace reserve on smaller windows", () => {
    const bounds = resolvePanelSizeBounds({
      width: 1160,
      height: 720
    });

    expect(bounds.leftMinWidth).toBeGreaterThan(0);
    expect(bounds.leftMaxWidth).toBeGreaterThanOrEqual(bounds.leftMinWidth);
    expect(bounds.leftMaxWidth + bounds.centerMinWidth).toBeLessThanOrEqual(
      bounds.viewportWidth
    );
    expect(bounds.bottomMaxHeight + bounds.workspaceMinHeight).toBeLessThanOrEqual(
      bounds.viewportHeight
    );
  });

  test("auto-couples sibling panels to avoid over-compression", () => {
    const bounds = resolvePanelSizeBounds({
      width: 1440,
      height: 900
    });

    const stabilized = resolveCoupledPanelSizes(
      {
        leftWidth: bounds.leftMaxWidth,
        bottomHeight: bounds.bottomMaxHeight
      },
      bounds
    );

    expect(stabilized.leftWidth).toBeLessThanOrEqual(bounds.leftMaxWidth);
    expect(stabilized.bottomHeight).toBeLessThanOrEqual(bounds.bottomMaxHeight);
    expect(stabilized.leftWidth).toBeGreaterThanOrEqual(bounds.leftMinWidth);
    expect(stabilized.bottomHeight).toBeGreaterThanOrEqual(bounds.bottomMinHeight);
    expect(
      stabilized.leftWidth !== bounds.leftMaxWidth ||
        stabilized.bottomHeight !== bounds.bottomMaxHeight
    ).toBe(true);
  });
});
