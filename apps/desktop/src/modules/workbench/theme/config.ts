import type { WorkbenchResolvedThemeId, WorkbenchTheme, WorkbenchThemeId } from "./types";
import { LYRA_RESOLVED_THEMES } from "./presets/lyra";

export const WORKBENCH_RESOLVED_THEMES = {
  ...LYRA_RESOLVED_THEMES
} satisfies Record<WorkbenchResolvedThemeId, WorkbenchTheme>;

export const WORKBENCH_THEME_IDS: readonly WorkbenchThemeId[] = [
  "lyra-light",
  "lyra-dark",
  "lyra-system"
] as const;
