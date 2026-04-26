export {
  DEFAULT_WEB_THEME_PALETTE,
  DEFAULT_WEB_THEME_SNAPSHOT,
  areSnapshotsEquivalent,
  buildWebThemeSnapshot,
  isDarkPaletteColor,
  resolveRelativeLuminance,
  resolveWebThemePalette
} from "./theme-bridge";
export { SHIELD_STYLE_ID, buildShieldCss, buildShieldScript } from "./shield";
export {
  FALLBACK_STYLE_ID,
  buildFallbackRemapCss,
  buildFallbackRemapScript
} from "./fallback-remap";
export {
  buildDarkReaderBootScript,
  buildDarkReaderDisableScript,
  __setDarkReaderSourceForTests
} from "./darkreader-source";
export {
  AREA_RETINT_CANDIDATE_SELECTOR,
  AREA_RETINT_MARK_ATTR,
  AREA_RETINT_SIG_ATTR,
  DEFAULT_AREA_RETINT_THRESHOLDS,
  buildAreaRetintDisableScript,
  buildAreaRetintScript,
  buildAreaRetintUpdateScript,
  classifyAreaAction
} from "./area-retint";
export type {
  AreaRetintAction,
  AreaRetintThresholds,
  BuildAreaRetintScriptInput
} from "./area-retint";
export { createWebThemeInjector } from "./injector";
export type {
  CreateWebThemeInjectorOptions,
  WebThemeInjector
} from "./injector";
export type {
  WebThemeInjectError,
  WebThemeInjectErrorReason,
  WebThemePalette,
  WebThemeSnapshot,
  WebThemeStage
} from "./types";
