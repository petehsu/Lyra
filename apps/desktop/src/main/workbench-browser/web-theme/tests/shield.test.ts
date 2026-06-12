import { describe, expect, test } from "vitest";

import { SHIELD_STYLE_ID, buildShieldCss, buildShieldScript } from "../shield";
import { buildWebThemeSnapshot } from "../theme-bridge";

const makeSnapshot = (enabled = true) =>
  buildWebThemeSnapshot({
    vars: {
      "--lyra-app-bg": "#111111",
      "--lyra-app-surface-bg": "#1e1e1e",
      "--lyra-text-primary": "#eaeaea",
      "--lyra-app-primary-button": "#88aaff",
      "--lyra-app-border": "#2a2a2a",
      "--lyra-app-border-strong": "#6280ff"
    },
    enabled,
    previousRevision: 0
  });

describe("buildShieldCss", () => {
  test("tints html/body and sets color-scheme matching isDark", () => {
    const css = buildShieldCss({ snapshot: makeSnapshot() });
    expect(css).toContain("color-scheme: dark");
    expect(css).toContain("background-color: #111111 !important");
    expect(css).toContain("color: #eaeaea !important");
  });

  test("is conservative - only tints top-level elements", () => {
    const css = buildShieldCss({ snapshot: makeSnapshot() });
    // No universal selector, no `* { ... }` resets.
    expect(css).not.toContain("* {");
    expect(css).not.toContain("*,");
  });
});

describe("buildShieldScript", () => {
  test("embeds the shield stylesheet as JSON-safe literal", () => {
    const script = buildShieldScript({ snapshot: makeSnapshot() });
    expect(script).toContain(JSON.stringify(SHIELD_STYLE_ID));
    expect(script).toContain("background-color: #111111 !important");
  });

  test("installs via document.head or documentElement", () => {
    const script = buildShieldScript({ snapshot: makeSnapshot() });
    expect(script).toContain("document.head");
    expect(script).toContain("document.documentElement");
  });

  test("uses a MutationObserver to survive <head> teardown", () => {
    const script = buildShieldScript({ snapshot: makeSnapshot() });
    expect(script).toContain("new MutationObserver");
  });
});
