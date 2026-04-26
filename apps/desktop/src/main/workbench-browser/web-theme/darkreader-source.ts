import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { WebThemeSnapshot } from "./types";

const require = createRequire(import.meta.url);

/**
 * Lazily read the darkreader UMD bundle at runtime. Kept as `let` + cache so
 * the cost is paid once per main-process lifetime, and only when the theme
 * injector actually asks for it (e.g. when at least one page is themed).
 */
let cachedDarkReaderSource: string | null = null;

const resolveDarkReaderSource = (): string => {
  if (cachedDarkReaderSource !== null) {
    return cachedDarkReaderSource;
  }
  const resolvedPath = require.resolve("darkreader/darkreader.js");
  cachedDarkReaderSource = readFileSync(resolvedPath, "utf8");
  return cachedDarkReaderSource;
};

/**
 * DynamicThemeFix values derived from the Lyra palette so DarkReader's
 * analyzer has locked background/text anchors matching our shield stage.
 * Kept small; heavier per-site quirks are left to DarkReader's built-in db.
 */
const buildDarkReaderThemeOptions = (snapshot: WebThemeSnapshot): string => {
  const { palette, isDark } = snapshot;
  const theme = {
    mode: isDark ? 1 : 0,
    brightness: 100,
    contrast: 100,
    grayscale: 0,
    sepia: 0,
    darkSchemeBackgroundColor: palette.bgApp,
    darkSchemeTextColor: palette.textPrimary,
    lightSchemeBackgroundColor: palette.bgApp,
    lightSchemeTextColor: palette.textPrimary,
    scrollbarColor: palette.textSecondary,
    selectionColor: palette.lineFocused,
    styleSystemControls: true,
    useFont: false,
    fontFamily: "",
    textStroke: 0
  };
  return JSON.stringify(theme);
};

const buildDarkReaderFixes = (): string => JSON.stringify({
  invert: [],
  css: "",
  ignoreInlineStyle: [],
  ignoreImageAnalysis: [],
  disableStyleSheetsProxy: false,
  ignoreCSSUrl: []
});

/**
 * A stringified bootstrap that:
 *   1. Evaluates the darkreader UMD bundle (sets `window.DarkReader`).
 *   2. Calls `DarkReader.enable(theme, fixes)` with our palette.
 *   3. Installs a re-entrant `__lyraWebThemeUpdate(snapshot)` helper so the
 *      main process can push new palettes without reloading the tab.
 *
 * Designed to be safe if it runs twice (idempotent enable), and gracefully
 * no-ops on pages where darkreader's own sanity checks reject injection
 * (e.g. `about:blank`, `chrome-error://`).
 */
export const buildDarkReaderBootScript = (snapshot: WebThemeSnapshot): string => {
  const darkReaderSource = resolveDarkReaderSource();
  const themeJson = buildDarkReaderThemeOptions(snapshot);
  const fixesJson = buildDarkReaderFixes();
  return `
(() => {
  try {
    if (!window.DarkReader) {
      ${darkReaderSource}
    }
    if (!window.DarkReader || typeof window.DarkReader.enable !== "function") {
      return;
    }
    const nextTheme = ${themeJson};
    const nextFixes = ${fixesJson};
    try {
      window.DarkReader.enable(nextTheme, nextFixes);
    } catch (_enableError) {
      // Let shield + fallback handle it instead.
      return;
    }
    window.__lyraWebThemeUpdate = function (snapshot) {
      if (!snapshot || typeof snapshot !== "object") { return; }
      try {
        if (snapshot.enabled === false) {
          if (window.DarkReader && typeof window.DarkReader.disable === "function") {
            window.DarkReader.disable();
          }
          return;
        }
        const palette = snapshot.palette || {};
        const theme = {
          mode: snapshot.isDark ? 1 : 0,
          brightness: 100,
          contrast: 100,
          grayscale: 0,
          sepia: 0,
          darkSchemeBackgroundColor: palette.bgApp || nextTheme.darkSchemeBackgroundColor,
          darkSchemeTextColor: palette.textPrimary || nextTheme.darkSchemeTextColor,
          lightSchemeBackgroundColor: palette.bgApp || nextTheme.lightSchemeBackgroundColor,
          lightSchemeTextColor: palette.textPrimary || nextTheme.lightSchemeTextColor,
          scrollbarColor: palette.textSecondary || nextTheme.scrollbarColor,
          selectionColor: palette.lineFocused || nextTheme.selectionColor,
          styleSystemControls: true,
          useFont: false,
          fontFamily: "",
          textStroke: 0
        };
        if (window.DarkReader && typeof window.DarkReader.enable === "function") {
          window.DarkReader.enable(theme, nextFixes);
        }
      } catch (_updateError) {
        // Swallow; shield remains in place.
      }
    };
  } catch (_bootError) {
    // Swallow; shield + fallback will keep the page tinted.
  }
})();
`.trim();
};

/**
 * A tiny script used to disable darkreader in-place (e.g. when the user
 * turns off the setting). Does not tear down the shield or fallback
 * stylesheets; those are removed through a separate call.
 */
export const buildDarkReaderDisableScript = (): string => `
(() => {
  try {
    if (window.DarkReader && typeof window.DarkReader.disable === "function") {
      window.DarkReader.disable();
    }
  } catch (_error) {}
})();
`.trim();

/**
 * Test seam: lets the unit tests override the cached source without needing
 * to resolve the real npm package. Not part of the public module surface.
 */
export const __setDarkReaderSourceForTests = (value: string | null): void => {
  cachedDarkReaderSource = value;
};
