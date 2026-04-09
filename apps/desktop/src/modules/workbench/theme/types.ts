export type WorkbenchThemeFamily = "one" | "ayu" | "gruvbox";

export type WorkbenchThemeMode = "light" | "dark" | "system";

export type WorkbenchResolvedThemeMode = Exclude<WorkbenchThemeMode, "system">;

export type WorkbenchThemeId = `${WorkbenchThemeFamily}-${WorkbenchThemeMode}`;

export type WorkbenchResolvedThemeId = `${WorkbenchThemeFamily}-${WorkbenchResolvedThemeMode}`;

export type WorkbenchThemeVarName = `--lyra-${string}`;

export type WorkbenchFoundationTokenName =
  | `--lyra-space-${string}`
  | `--lyra-radius-${string}`
  | `--lyra-font-${string}`
  | `--lyra-text-size-${string}`
  | `--lyra-text-line-${string}`
  | `--lyra-icon-size-${string}`
  | `--lyra-control-h-${string}`
  | `--lyra-stroke-${string}`
  | `--lyra-shadow-${string}`
  | `--lyra-backdrop-blur-${string}`
  | `--lyra-motion-${string}`
  | `--lyra-z-${string}`;

export type WorkbenchSemanticTokenName =
  | `--lyra-shell-${string}`
  | `--lyra-control-${string}`
  | `--lyra-list-${string}`
  | `--lyra-surface-${string}`
  | `--lyra-dialog-${string}`
  | `--lyra-card-${string}`
  | `--lyra-tab-${string}`
  | `--lyra-optical-${string}`
  | `--lyra-size-${string}`;

export type WorkbenchThemeVars = Record<WorkbenchThemeVarName, string>;

export type WorkbenchBreakpointName = "compact" | "regular";

export type WorkbenchTheme = {
  readonly id: WorkbenchResolvedThemeId;
  readonly vars: WorkbenchThemeVars;
};
