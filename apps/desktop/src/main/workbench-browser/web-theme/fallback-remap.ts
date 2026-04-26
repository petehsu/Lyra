import type { WebThemeSnapshot } from "./types";

/**
 * The "fallback remap" stage: a higher-specificity stylesheet that also
 * re-maps the most widely used CSS variable conventions (Tailwind, shadcn,
 * Radix, Material, Chakra, ...) onto Lyra's palette. Runs after DOMContentLoaded
 * so it can't race with inline <style> tags that would win at build time.
 * Intentionally small and non-destructive; darkreader (when available) still
 * does the heavy per-element work.
 */
export const FALLBACK_STYLE_ID = "lyra-web-theme-fallback-remap";

export type BuildFallbackRemapCssInput = {
  readonly snapshot: WebThemeSnapshot;
};

export const buildFallbackRemapCss = ({ snapshot }: BuildFallbackRemapCssInput): string => {
  const { palette } = snapshot;
  return [
    // Tailwind-flavored tokens commonly used by modern sites (zinc/slate/gray
    // scales). Most sites consume these via CSS vars, so the remap lands
    // immediately without walking the DOM.
    `:root, [data-theme], [data-color-mode] {`,
    `  --background: ${palette.bgApp} !important;`,
    `  --foreground: ${palette.textPrimary} !important;`,
    `  --card: ${palette.bgSurface} !important;`,
    `  --card-foreground: ${palette.textPrimary} !important;`,
    `  --popover: ${palette.bgSurface} !important;`,
    `  --popover-foreground: ${palette.textPrimary} !important;`,
    `  --primary: ${palette.textAccent} !important;`,
    `  --primary-foreground: ${palette.textPrimary} !important;`,
    `  --secondary: ${palette.bgEditor} !important;`,
    `  --secondary-foreground: ${palette.textSecondary} !important;`,
    `  --muted: ${palette.bgEditor} !important;`,
    `  --muted-foreground: ${palette.textMuted} !important;`,
    `  --accent: ${palette.textAccent} !important;`,
    `  --accent-foreground: ${palette.textPrimary} !important;`,
    `  --destructive: ${palette.statusError} !important;`,
    `  --destructive-foreground: ${palette.textPrimary} !important;`,
    `  --border: ${palette.lineDefault} !important;`,
    `  --input: ${palette.lineDefault} !important;`,
    `  --ring: ${palette.lineFocused} !important;`,
    `}`,
    // Chakra / Radix / Material-ish hints.
    `:root, [data-theme], [data-color-mode] {`,
    `  --chakra-colors-bg: ${palette.bgApp} !important;`,
    `  --chakra-colors-text: ${palette.textPrimary} !important;`,
    `  --mui-palette-background-default: ${palette.bgApp} !important;`,
    `  --mui-palette-background-paper: ${palette.bgSurface} !important;`,
    `  --mui-palette-text-primary: ${palette.textPrimary} !important;`,
    `  --mui-palette-text-secondary: ${palette.textSecondary} !important;`,
    `  --mui-palette-divider: ${palette.lineDefault} !important;`,
    `}`
  ].join("\n");
};

export const buildFallbackRemapScript = ({ snapshot }: BuildFallbackRemapCssInput): string => {
  const css = buildFallbackRemapCss({ snapshot });
  const cssLiteral = JSON.stringify(css);
  const styleId = JSON.stringify(FALLBACK_STYLE_ID);
  return `
(() => {
  try {
    const STYLE_ID = ${styleId};
    const CSS_TEXT = ${cssLiteral};
    const install = () => {
      if (!document || !document.documentElement) { return; }
      let style = document.getElementById(STYLE_ID);
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        style.setAttribute("data-lyra-web-theme", "fallback");
        (document.head || document.documentElement).appendChild(style);
      }
      if (style.textContent !== CSS_TEXT) {
        style.textContent = CSS_TEXT;
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
      install();
    }
  } catch (_error) {
    // Non-fatal; the shield is already in place.
  }
})();
`.trim();
};
