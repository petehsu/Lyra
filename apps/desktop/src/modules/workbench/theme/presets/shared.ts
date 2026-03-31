export type ThemeVars = Record<`--${string}`, string>;

type ThemeVarInput = Omit<
  ThemeVars,
  | "--lyra-bg-surface-elevated"
  | "--lyra-bg-panel"
  | "--lyra-bg-active"
  | "--lyra-bg-toolbar"
  | "--lyra-tab-inactive"
  | "--lyra-tab-active"
  | "--lyra-window-close-hover-fg"
  | "--lyra-terminal-cursor"
  | "--lyra-terminal-cursor-accent"
  | "--lyra-terminal-selection-bg"
>;

export const createThemeVars = (vars: ThemeVarInput): ThemeVars => ({
  ...vars,
  "--lyra-bg-surface-elevated": vars["--lyra-bg-surface"] ?? "#ebebec",
  "--lyra-bg-panel": vars["--lyra-bg-surface"] ?? "#ebebec",
  "--lyra-bg-active": vars["--lyra-browser-tab-bg"] ?? "#ebebec",
  "--lyra-bg-toolbar": vars["--lyra-bg-editor"] ?? "#fafafa",
  "--lyra-tab-inactive": vars["--lyra-browser-tab-bg"] ?? "#ebebec",
  "--lyra-tab-active": vars["--lyra-bg-editor"] ?? "#fafafa",
  "--lyra-window-close-hover-fg": "#ffffff",
  "--lyra-terminal-cursor": vars["--lyra-text-accent"] ?? "#5c78e2",
  "--lyra-terminal-cursor-accent": vars["--lyra-terminal-bg"] ?? "#ffffff",
  "--lyra-terminal-selection-bg": vars["--lyra-line-focused"] ?? "#7d82e8"
});
