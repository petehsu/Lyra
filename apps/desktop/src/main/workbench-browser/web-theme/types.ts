import type {
  WorkbenchBrowserWebThemePalette,
  WorkbenchBrowserWebThemeSnapshot
} from "../../../shared/workbench-browser";

/**
 * Re-export so the rest of the main-side web-theme module never reaches across
 * the renderer/shared boundary directly.
 */
export type WebThemePalette = WorkbenchBrowserWebThemePalette;
export type WebThemeSnapshot = WorkbenchBrowserWebThemeSnapshot;

/**
 * A small identifier describing which stage produced a given artifact.
 * Kept in the logged context when the injector falls back between strategies.
 */
export type WebThemeStage = "shield" | "fallback" | "darkreader";

/**
 * Reason a per-tab injection attempt failed. Used for cascading fallback
 * decisions, not surfaced to the user directly.
 */
export type WebThemeInjectErrorReason =
  | "cdp-unavailable"
  | "cdp-attach-failed"
  | "add-script-failed"
  | "insert-css-failed"
  | "runtime-evaluate-failed"
  | "unsupported-url";

export type WebThemeInjectError = {
  readonly reason: WebThemeInjectErrorReason;
  readonly stage: WebThemeStage;
  readonly cause?: unknown;
};
