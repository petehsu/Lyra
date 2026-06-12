import { describe, expect, test } from "vitest";

import {
  DEFAULT_WEB_THEME_PALETTE,
  DEFAULT_WEB_THEME_SNAPSHOT,
  areSnapshotsEquivalent,
  buildWebThemeSnapshot,
  isDarkPaletteColor,
  resolveRelativeLuminance,
  resolveWebThemePalette
} from "../theme-bridge";

const darkVars = {
  "--lyra-app-bg": "#1a1b20",
  "--lyra-app-surface-bg": "#24262d",
  "--lyra-app-panel-bg": "#1e2026",
  "--lyra-text-primary": "#e6e7eb",
  "--lyra-text-secondary": "#b7bac3",
  "--lyra-text-muted": "#8b8f9b",
  "--lyra-app-primary-button": "#7aa7ff",
  "--lyra-app-border": "#353842",
  "--lyra-app-border-strong": "#5c78e2",
  "--lyra-status-success": "#87c07a",
  "--lyra-status-warning": "#dcba7a",
  "--lyra-status-error": "#e47878"
} as const;

const lightVars = {
  ...darkVars,
  "--lyra-app-bg": "#f1f2f5",
  "--lyra-text-primary": "#1a1b20"
} as const;

describe("resolveRelativeLuminance", () => {
  test("returns 0 for invalid inputs", () => {
    expect(resolveRelativeLuminance("not-a-color")).toBe(0);
    expect(resolveRelativeLuminance("")).toBe(0);
  });

  test("white is maximally luminous", () => {
    expect(resolveRelativeLuminance("#ffffff")).toBeCloseTo(1, 3);
  });

  test("black is minimally luminous", () => {
    expect(resolveRelativeLuminance("#000000")).toBeCloseTo(0, 3);
  });

  test("hex3 shorthand parses the same as hex6", () => {
    expect(resolveRelativeLuminance("#fff")).toBeCloseTo(
      resolveRelativeLuminance("#ffffff"),
      3
    );
  });

  test("rgb() notation is accepted", () => {
    expect(resolveRelativeLuminance("rgb(255, 255, 255)")).toBeCloseTo(1, 3);
    expect(resolveRelativeLuminance("rgba(0 0 0 / 1)")).toBeCloseTo(0, 3);
  });
});

describe("isDarkPaletteColor", () => {
  test("classifies dark and light colors correctly", () => {
    expect(isDarkPaletteColor("#111111")).toBe(true);
    expect(isDarkPaletteColor("#f0f0f0")).toBe(false);
  });
});

describe("resolveWebThemePalette", () => {
  test("projects Lyra vars into the web-palette shape", () => {
    const palette = resolveWebThemePalette(darkVars);
    expect(palette.bgApp).toBe("#1a1b20");
    expect(palette.textPrimary).toBe("#e6e7eb");
    expect(palette.textAccent).toBe("#7aa7ff");
  });

  test("falls back to defaults for missing or empty vars", () => {
    const palette = resolveWebThemePalette({ "--lyra-app-bg": "  " });
    expect(palette.bgApp).toBe(DEFAULT_WEB_THEME_PALETTE.bgApp);
    expect(palette.textPrimary).toBe(DEFAULT_WEB_THEME_PALETTE.textPrimary);
  });
});

describe("buildWebThemeSnapshot", () => {
  test("derives isDark from the app background luminance", () => {
    const darkSnapshot = buildWebThemeSnapshot({
      vars: darkVars,
      enabled: true,
      previousRevision: 0
    });
    const lightSnapshot = buildWebThemeSnapshot({
      vars: lightVars,
      enabled: true,
      previousRevision: darkSnapshot.revision
    });
    expect(darkSnapshot.isDark).toBe(true);
    expect(lightSnapshot.isDark).toBe(false);
  });

  test("bumps revision monotonically", () => {
    const a = buildWebThemeSnapshot({
      vars: darkVars,
      enabled: true,
      previousRevision: 5
    });
    const b = buildWebThemeSnapshot({
      vars: darkVars,
      enabled: true,
      previousRevision: a.revision
    });
    expect(a.revision).toBe(6);
    expect(b.revision).toBe(7);
  });

  test("respects the enabled flag", () => {
    const off = buildWebThemeSnapshot({
      vars: darkVars,
      enabled: false,
      previousRevision: 0
    });
    expect(off.enabled).toBe(false);
  });
});

describe("areSnapshotsEquivalent", () => {
  test("ignores the revision counter when palette and enabled flags match", () => {
    const a = buildWebThemeSnapshot({
      vars: darkVars,
      enabled: true,
      previousRevision: 1
    });
    const b = buildWebThemeSnapshot({
      vars: darkVars,
      enabled: true,
      previousRevision: 9
    });
    expect(areSnapshotsEquivalent(a, b)).toBe(true);
  });

  test("detects palette differences", () => {
    const a = buildWebThemeSnapshot({
      vars: darkVars,
      enabled: true,
      previousRevision: 0
    });
    const b = buildWebThemeSnapshot({
      vars: lightVars,
      enabled: true,
      previousRevision: 0
    });
    expect(areSnapshotsEquivalent(a, b)).toBe(false);
  });

  test("detects enabled toggle", () => {
    const a = buildWebThemeSnapshot({
      vars: darkVars,
      enabled: true,
      previousRevision: 0
    });
    const b = buildWebThemeSnapshot({
      vars: darkVars,
      enabled: false,
      previousRevision: 0
    });
    expect(areSnapshotsEquivalent(a, b)).toBe(false);
  });

  test("matches the default sentinel against itself", () => {
    expect(
      areSnapshotsEquivalent(DEFAULT_WEB_THEME_SNAPSHOT, DEFAULT_WEB_THEME_SNAPSHOT)
    ).toBe(true);
  });
});
