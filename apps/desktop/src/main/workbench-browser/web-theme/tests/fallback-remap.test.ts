import { describe, expect, test } from "vitest";

import {
  FALLBACK_STYLE_ID,
  buildFallbackRemapCss,
  buildFallbackRemapScript
} from "../fallback-remap";
import { buildWebThemeSnapshot } from "../theme-bridge";

const snapshot = buildWebThemeSnapshot({
  vars: {
    "--lyra-bg-app": "#101112",
    "--lyra-bg-surface": "#1e1f22",
    "--lyra-bg-editor": "#181a1e",
    "--lyra-text-primary": "#f0f1f3",
    "--lyra-text-secondary": "#cbccd2",
    "--lyra-text-muted": "#9e9fa6",
    "--lyra-text-accent": "#8faaff",
    "--lyra-line-default": "#2a2b30",
    "--lyra-line-focused": "#6583ff",
    "--lyra-status-error": "#e47878"
  },
  enabled: true,
  previousRevision: 0
});

describe("buildFallbackRemapCss", () => {
  test("remaps the shadcn/Tailwind core tokens", () => {
    const css = buildFallbackRemapCss({ snapshot });
    expect(css).toContain("--background: #101112 !important");
    expect(css).toContain("--foreground: #f0f1f3 !important");
    expect(css).toContain("--border: #2a2b30 !important");
    expect(css).toContain("--ring: #6583ff !important");
  });

  test("remaps Chakra + MUI common tokens", () => {
    const css = buildFallbackRemapCss({ snapshot });
    expect(css).toContain("--chakra-colors-bg: #101112 !important");
    expect(css).toContain("--mui-palette-background-default: #101112 !important");
    expect(css).toContain("--mui-palette-text-primary: #f0f1f3 !important");
  });
});

describe("buildFallbackRemapScript", () => {
  test("embeds style with stable id + waits for DOMContentLoaded when needed", () => {
    const script = buildFallbackRemapScript({ snapshot });
    expect(script).toContain(JSON.stringify(FALLBACK_STYLE_ID));
    expect(script).toContain("DOMContentLoaded");
    expect(script).toContain("--foreground: #f0f1f3 !important");
  });
});
