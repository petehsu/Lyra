import type { WorkbenchResolvedThemeId, WorkbenchTheme, WorkbenchThemeId } from "./types";
import { LYRA_RESOLVED_THEMES } from "./presets/lyra";
import { NOVA_RESOLVED_THEMES } from "./presets/nova";
import { TERRA_RESOLVED_THEMES } from "./presets/terra";
import { OCEAN_RESOLVED_THEMES } from "./presets/ocean";
import { ECLIPSE_RESOLVED_THEMES } from "./presets/eclipse";

export const WORKBENCH_RESOLVED_THEMES = {
  ...LYRA_RESOLVED_THEMES,
  ...NOVA_RESOLVED_THEMES,
  ...TERRA_RESOLVED_THEMES,
  ...OCEAN_RESOLVED_THEMES,
  ...ECLIPSE_RESOLVED_THEMES
} satisfies Record<WorkbenchResolvedThemeId, WorkbenchTheme>;

export const WORKBENCH_THEME_IDS: readonly WorkbenchThemeId[] = [
  "lyra-light",
  "lyra-dark",
  "lyra-system",
  "nova-light",
  "nova-dark",
  "nova-system",
  "terra-light",
  "terra-dark",
  "terra-system",
  "ocean-light",
  "ocean-dark",
  "ocean-system",
  "eclipse-light",
  "eclipse-dark",
  "eclipse-system"
] as const;
