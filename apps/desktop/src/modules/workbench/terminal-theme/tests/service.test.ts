import { describe, expect, test } from "vitest";

import {
  resolveTerminalThemePresetId,
  resolveTerminalThemePreviewSwatches,
  resolveTerminalThemeVars
} from "../service";

describe("terminal theme presets", () => {
  test("falls back to glacier-blocks when preset is invalid", () => {
    expect(resolveTerminalThemePresetId("invalid-preset")).toBe("glacier-blocks");
  });

  test("returns preview swatches for a preset", () => {
    const swatches = resolveTerminalThemePreviewSwatches("amber-forge");
    expect(swatches.length).toBeGreaterThan(0);
  });

  test("terminal theme vars no longer override global UI color tokens", () => {
    const vars = resolveTerminalThemeVars("ocean-matrix");
    expect(Object.keys(vars).length).toBe(0);
  });
});
