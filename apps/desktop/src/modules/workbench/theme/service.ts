import { WORKBENCH_RESOLVED_THEMES, WORKBENCH_THEME_IDS } from "./config";
import type {
  WorkbenchResolvedThemeId,
  WorkbenchResolvedThemeMode,
  WorkbenchThemeId,
  WorkbenchThemeVars
} from "./types";

const FALLBACK_THEME: WorkbenchResolvedThemeId = "lyra-light";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";
const LEGACY_THEME_PATTERN = /^(?:nova|terra|ocean|eclipse)-(light|dark|system)$/;
const DARK_MATERIAL_SURFACE_OPACITY = {
  "--lyra-app-bg": 24,
  "--lyra-app-sidebar-bg": 32,
  "--lyra-app-panel-bg": 30,
  "--lyra-app-surface-bg": 40,
  "--lyra-app-surface-strong-bg": 52,
  "--lyra-app-muted-bg": 34,
  "--lyra-app-row-hover-bg": 34,
  "--lyra-app-row-active-bg": 48,
  "--lyra-app-row-active-border": 56,
  "--lyra-app-input-bg": 100,
  "--lyra-app-input-hover-bg": 100,
  "--lyra-app-input-focus-bg": 100,
  "--lyra-app-input-border": 52,
  "--lyra-app-input-focus-border": 68,
  "--lyra-app-border": 52,
  "--lyra-app-border-strong": 66,
  "--lyra-app-popover-bg": 100
} as const satisfies Partial<Record<keyof WorkbenchThemeVars, number>>;
const LIGHT_MATERIAL_SURFACE_OPACITY = {
  "--lyra-app-bg": 0,
  "--lyra-app-sidebar-bg": 10,
  "--lyra-app-panel-bg": 0,
  "--lyra-app-surface-bg": 18,
  "--lyra-app-surface-strong-bg": 26,
  "--lyra-app-muted-bg": 12,
  "--lyra-app-row-hover-bg": 16,
  "--lyra-app-row-active-bg": 26,
  "--lyra-app-row-active-border": 32,
  "--lyra-app-input-bg": 100,
  "--lyra-app-input-hover-bg": 100,
  "--lyra-app-input-focus-bg": 100,
  "--lyra-app-input-border": 32,
  "--lyra-app-input-focus-border": 48,
  "--lyra-app-border": 30,
  "--lyra-app-border-strong": 44,
  "--lyra-app-popover-bg": 100
} as const satisfies Partial<Record<keyof WorkbenchThemeVars, number>>;

const toResolvedThemeId = (
  themeId: WorkbenchThemeId,
  prefersDark: boolean
): WorkbenchResolvedThemeId => {
  if (themeId.endsWith("-system")) {
    const family = themeId.slice(0, -"-system".length);
    return `${family}-${prefersDark ? "dark" : "light"}` as WorkbenchResolvedThemeId;
  }
  return themeId as WorkbenchResolvedThemeId;
};

export const resolveWorkbenchThemeId = (
  themeId: WorkbenchThemeId,
  prefersDark: boolean = readSystemPrefersDark()
): WorkbenchResolvedThemeId => toResolvedThemeId(themeId, prefersDark);

export const resolveWorkbenchNativeThemeSource = (
  themeId: WorkbenchThemeId
): "system" | "light" | "dark" => {
  if (themeId.endsWith("-system")) return "system";
  return themeId.endsWith("-dark") ? "dark" : "light";
};

export const isWorkbenchThemeId = (value: unknown): value is WorkbenchThemeId =>
  typeof value === "string" && WORKBENCH_THEME_IDS.includes(value as WorkbenchThemeId);

export const normalizeWorkbenchThemeId = (
  value: unknown,
  fallback: WorkbenchThemeId = "lyra-system"
): WorkbenchThemeId => {
  if (isWorkbenchThemeId(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const legacyMatch = LEGACY_THEME_PATTERN.exec(value);
  if (legacyMatch !== null) {
    return `lyra-${legacyMatch[1]}` as WorkbenchThemeId;
  }

  return fallback;
};

export const readSystemPrefersDark = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
};

export const observeSystemPrefersDark = (onChange: (prefersDark: boolean) => void): (() => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const media = window.matchMedia(SYSTEM_DARK_QUERY);
  const listener = (event: MediaQueryListEvent): void => {
    onChange(event.matches);
  };

  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return () => {
      media.removeEventListener("change", listener);
    };
  }

  media.addListener(listener);
  return () => {
    media.removeListener(listener);
  };
};

export const resolveThemeVars = (
  themeId: WorkbenchThemeId,
  prefersDark: boolean = readSystemPrefersDark()
): WorkbenchThemeVars => {
  const resolvedThemeId = resolveWorkbenchThemeId(themeId, prefersDark);
  return WORKBENCH_RESOLVED_THEMES[resolvedThemeId]?.vars ?? WORKBENCH_RESOLVED_THEMES[FALLBACK_THEME].vars;
};

export const resolveMaterialThemeVars = (
  vars: WorkbenchThemeVars,
  enabled: boolean,
  tone: WorkbenchResolvedThemeMode
): WorkbenchThemeVars => {
  if (!enabled) {
    return vars;
  }

  const materialVars = { ...vars };
  const opacityByName = tone === "light"
    ? LIGHT_MATERIAL_SURFACE_OPACITY
    : DARK_MATERIAL_SURFACE_OPACITY;
  for (const [name, opacity] of Object.entries(opacityByName)) {
    const value = vars[name as keyof WorkbenchThemeVars];
    if (value === undefined) {
      continue;
    }

    const alias = `--lyra-material-solid-${name.slice("--lyra-app-".length)}` as const;
    materialVars[alias] = value;
    materialVars[name as keyof WorkbenchThemeVars] = opacity === 100
      ? `var(${alias})`
      : `color-mix(in srgb, var(${alias}) ${opacity}%, transparent)`;
  }
  materialVars["--lyra-shadow-elevated-sm"] =
    "0 4px 16px color-mix(in srgb, var(--lyra-text-primary) 7%, transparent)";
  materialVars["--lyra-shadow-elevated-md"] =
    "0 9px 28px color-mix(in srgb, var(--lyra-text-primary) 10%, transparent)";
  materialVars["--lyra-shadow-elevated-lg"] =
    "0 16px 44px color-mix(in srgb, var(--lyra-text-primary) 16%, transparent)";
  return materialVars;
};
