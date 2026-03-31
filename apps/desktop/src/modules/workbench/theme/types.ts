export type WorkbenchThemeFamily = "one" | "ayu" | "gruvbox";

export type WorkbenchThemeMode = "light" | "dark" | "system";

export type WorkbenchResolvedThemeMode = Exclude<WorkbenchThemeMode, "system">;

export type WorkbenchThemeId = `${WorkbenchThemeFamily}-${WorkbenchThemeMode}`;

export type WorkbenchResolvedThemeId = `${WorkbenchThemeFamily}-${WorkbenchResolvedThemeMode}`;

export type WorkbenchTheme = {
  readonly id: WorkbenchResolvedThemeId;
  readonly vars: Record<`--${string}`, string>;
};
