import { describe, expect, test } from "vitest";

import { pickComposerToolbarLabelMode } from "./composer-toolbar-labels";

describe("pickComposerToolbarLabelMode", () => {
  test("keeps both labels when they fit", () => {
    expect(pickComposerToolbarLabelMode({
      availablePx: 280,
      gapPx: 8,
      modelFullPx: 140,
      modelIconPx: 28,
      permissionFullPx: 96,
      permissionIconPx: 28
    })).toBe("both");
  });

  test("keeps a long model label so it can ellipsize beside the permission label", () => {
    expect(pickComposerToolbarLabelMode({
      availablePx: 140,
      gapPx: 8,
      modelFullPx: 160,
      modelIconPx: 28,
      permissionFullPx: 72,
      permissionIconPx: 28
    })).toBe("both");
  });

  test("keeps a long permission label so it can ellipsize beside the model label", () => {
    expect(pickComposerToolbarLabelMode({
      availablePx: 140,
      gapPx: 8,
      modelFullPx: 72,
      modelIconPx: 28,
      permissionFullPx: 160,
      permissionIconPx: 28
    })).toBe("both");
  });

  test("hides both labels only when the shorter labeled control still cannot fit", () => {
    expect(pickComposerToolbarLabelMode({
      availablePx: 80,
      gapPx: 8,
      modelFullPx: 160,
      modelIconPx: 28,
      permissionFullPx: 96,
      permissionIconPx: 28
    })).toBe("icons");
  });

  test("hides a lone model label only when it cannot fit", () => {
    expect(pickComposerToolbarLabelMode({
      availablePx: 120,
      gapPx: 8,
      modelFullPx: 100,
      modelIconPx: 28,
      permissionFullPx: null,
      permissionIconPx: null
    })).toBe("both");
    expect(pickComposerToolbarLabelMode({
      availablePx: 80,
      gapPx: 8,
      modelFullPx: 100,
      modelIconPx: 28,
      permissionFullPx: null,
      permissionIconPx: null
    })).toBe("icons");
  });

  test("equal widths stay labeled when one full label still fits beside an icon", () => {
    expect(pickComposerToolbarLabelMode({
      availablePx: 160,
      gapPx: 8,
      modelFullPx: 120,
      modelIconPx: 28,
      permissionFullPx: 120,
      permissionIconPx: 28
    })).toBe("both");
  });
});
