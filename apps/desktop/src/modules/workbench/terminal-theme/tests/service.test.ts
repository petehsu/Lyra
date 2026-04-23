import { describe, expect, test } from "vitest";

import {
  resolveTerminalThemePresetId,
  resolveTerminalThemePreviewSwatches,
  resolveTerminalThemeVars
} from "../service";

describe("terminal theme presets", () => {
  test("falls back to follow-app when mode is invalid", () => {
    expect(resolveTerminalThemePresetId("invalid-preset")).toBe("follow-app");
  });

  test("migrates legacy auto-detect to follow-app", () => {
    expect(resolveTerminalThemePresetId("auto-detect")).toBe("follow-app");
  });

  test("migrates legacy color presets to lyra-rich", () => {
    expect(resolveTerminalThemePresetId("glacier-blocks")).toBe("lyra-rich");
    expect(resolveTerminalThemePresetId("ocean-matrix")).toBe("lyra-rich");
    expect(resolveTerminalThemePresetId("amber-forge")).toBe("lyra-rich");
  });

  test("migrates mono-signal to lyra-minimal", () => {
    expect(resolveTerminalThemePresetId("mono-signal")).toBe("lyra-minimal");
  });

  test("returns preview swatches for a mode", () => {
    const swatches = resolveTerminalThemePreviewSwatches("lyra-rich");
    expect(swatches.length).toBeGreaterThan(0);
  });

  test("terminal theme vars no longer override global UI color tokens", () => {
    const vars = resolveTerminalThemeVars("lyra-standard");
    expect(Object.keys(vars).length).toBe(0);
  });
});
