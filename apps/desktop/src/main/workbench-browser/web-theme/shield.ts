import type { WebThemeSnapshot } from "./types";

/**
 * The "shield" stage: a single stylesheet that tints the page background and
 * text color before any of its own CSS loads. Installed via CDP
 * `Page.addScriptToEvaluateOnNewDocument` so it reliably wins the race with
 * the page's first paint. All selectors intentionally stay low-specificity
 * (just `html`/`body`) to avoid breaking site layouts; the stage is only
 * responsible for *tinting*, not full theming.
 */
export const SHIELD_STYLE_ID = "lyra-web-theme-shield";

export type BuildShieldCssInput = {
  readonly snapshot: WebThemeSnapshot;
};

/**
 * Produces a tiny stylesheet (~300 bytes) that keeps the page from flashing
 * white during initial load. We only override bg/fg/color-scheme on the root
 * elements; page-specific CSS still takes precedence for everything else.
 */
export const buildShieldCss = ({ snapshot }: BuildShieldCssInput): string => {
  const { palette, isDark } = snapshot;
  const colorScheme = isDark ? "dark" : "light";
  const appBg = palette.bgApp;
  const surfaceBg = palette.bgSurface;
  const fg = palette.textPrimary;
  const fgSecondary = palette.textSecondary;
  const line = palette.lineDefault;
  const focusColor = palette.lineFocused;
  const accent = palette.textAccent;
  return [
    `:root { color-scheme: ${colorScheme}; }`,
    `html, body {`,
    `  background-color: ${appBg} !important;`,
    `  color: ${fg} !important;`,
    `}`,
    // Common wrappers sites use as "first above-fold surface".
    `body > #__next, body > #root, body > #app {`,
    `  background-color: ${surfaceBg};`,
    `  color: ${fg};`,
    `}`,
    // Focus ring harmonization.
    `:focus-visible {`,
    `  outline-color: ${focusColor} !important;`,
    `}`,
    // Link + selection harmonization (non-destructive - only tints).
    `a:not([class]):not([role=button]) {`,
    `  color: ${accent};`,
    `}`,
    `::selection {`,
    `  background-color: ${focusColor};`,
    `  color: ${fg};`,
    `}`,
    `hr {`,
    `  border-color: ${line};`,
    `}`,
    // Generic UI chromes (scrollbars tint via color-scheme above).
    `html {`,
    `  scrollbar-color: ${fgSecondary} transparent;`,
    `}`
  ].join("\n");
};

/**
 * A stringified JS snippet that installs the shield stylesheet as early as
 * possible. Runs in the page's main world; designed to survive documents that
 * strip the initial <head> during hydration.
 */
export const buildShieldScript = ({ snapshot }: BuildShieldCssInput): string => {
  const css = buildShieldCss({ snapshot });
  const cssLiteral = JSON.stringify(css);
  const styleId = JSON.stringify(SHIELD_STYLE_ID);
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
        style.setAttribute("data-lyra-web-theme", "shield");
        const target = document.head || document.documentElement;
        target.insertBefore(style, target.firstChild || null);
      }
      if (style.textContent !== CSS_TEXT) {
        style.textContent = CSS_TEXT;
      }
    };
    install();
    // Sites like SPA routers sometimes blow away <head> children; re-install
    // if our shield gets removed. Observer is cheap (only listens for <head>
    // direct-child mutations).
    if (document.documentElement) {
      const observer = new MutationObserver(install);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch (_error) {
    // Swallow; shield failure is never fatal.
  }
})();
`.trim();
};
