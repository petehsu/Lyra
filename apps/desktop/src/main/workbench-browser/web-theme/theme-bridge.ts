import {
  DEFAULT_WEB_THEME_PALETTE,
  DEFAULT_WEB_THEME_SNAPSHOT,
  areWebThemeSnapshotsEquivalent,
  buildWebThemeSnapshot,
  isDarkPaletteColor,
  resolveRelativeLuminance,
  resolveWebThemePalette
} from "../../../shared/web-theme";

/**
 * Main-side alias for the shared web-theme builder surface. Kept as a thin
 * wrapper so future main-only extensions (e.g. caching, performance hooks)
 * can be added without ripple-affecting the renderer.
 */
export {
  DEFAULT_WEB_THEME_PALETTE,
  DEFAULT_WEB_THEME_SNAPSHOT,
  buildWebThemeSnapshot,
  isDarkPaletteColor,
  resolveRelativeLuminance,
  resolveWebThemePalette
};

export const areSnapshotsEquivalent = areWebThemeSnapshotsEquivalent;
