import type { WorkbenchResolvedThemeId, WorkbenchTheme, WorkbenchThemeId } from "./types";
import { AYU_RESOLVED_THEMES } from "./presets/ayu";
import { GRUVBOX_RESOLVED_THEMES } from "./presets/gruvbox";
import { ONE_RESOLVED_THEMES } from "./presets/one";

export const WORKBENCH_RESOLVED_THEMES = {
  ...ONE_RESOLVED_THEMES,
  ...AYU_RESOLVED_THEMES,
  ...GRUVBOX_RESOLVED_THEMES
} satisfies Record<WorkbenchResolvedThemeId, WorkbenchTheme>;

export const WORKBENCH_THEME_IDS: readonly WorkbenchThemeId[] = [
  "one-light",
  "one-dark",
  "one-system",
  "ayu-light",
  "ayu-dark",
  "ayu-system",
  "gruvbox-light",
  "gruvbox-dark",
  "gruvbox-system"
] as const;
