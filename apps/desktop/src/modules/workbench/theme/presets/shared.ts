import { WORKBENCH_FOUNDATION_TOKENS } from "../foundation";
import { WORKBENCH_SEMANTIC_TOKENS } from "../semantic";
import type { WorkbenchThemeVars } from "../types";

export type ThemeVars = WorkbenchThemeVars;

type ThemeVarInput = Omit<
  ThemeVars,
  | "--lyra-window-close-hover-fg"
>;

export const createThemeVars = (vars: ThemeVarInput): ThemeVars => ({
  ...WORKBENCH_FOUNDATION_TOKENS,
  ...WORKBENCH_SEMANTIC_TOKENS,
  ...vars,
  "--lyra-window-close-hover-fg": "#ffffff",
  "--lyra-scrollbar-thumb-idle":
    "color-mix(in srgb, var(--lyra-text-muted) 44%, transparent)",
  "--lyra-scrollbar-thumb-hover":
    "color-mix(in srgb, var(--lyra-text-secondary) 64%, transparent)",
  "--lyra-scrollbar-thumb-active":
    "color-mix(in srgb, var(--lyra-text-primary) 74%, transparent)"
});
