import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchThemeId } from "../theme";
import type { TerminalThemePresetId } from "../terminal-theme";

export type WorkbenchSplitTriggerMode = "ctrl_left_drag" | "right_drag";

export type WorkbenchSplitThreePaneLayout =
  | "top_two_bottom_one"
  | "top_one_bottom_two"
  | "left_two_right_one"
  | "left_one_right_two"
  | "adaptive";

export type WorkbenchSplitOverflowPolicy =
  | "block_with_notice"
  | "replace_oldest"
  | "replace_target";

export type WorkbenchPreferences = {
  readonly locale: WorkbenchLocale;
  readonly theme: WorkbenchThemeId;
  readonly terminalThemePreset: TerminalThemePresetId;
  readonly splitTriggerMode: WorkbenchSplitTriggerMode;
  readonly splitThreePaneLayout: WorkbenchSplitThreePaneLayout;
  readonly splitOverflowPolicy: WorkbenchSplitOverflowPolicy;
};

export type WorkbenchPreferencesModel = {
  readonly preferences: WorkbenchPreferences;
  readonly setLocale: (locale: WorkbenchLocale) => void;
  readonly setTheme: (theme: WorkbenchThemeId) => void;
  readonly setTerminalThemePreset: (preset: TerminalThemePresetId) => void;
  readonly setSplitTriggerMode: (mode: WorkbenchSplitTriggerMode) => void;
  readonly setSplitThreePaneLayout: (layout: WorkbenchSplitThreePaneLayout) => void;
  readonly setSplitOverflowPolicy: (policy: WorkbenchSplitOverflowPolicy) => void;
  readonly reset: () => void;
};
