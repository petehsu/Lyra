import { WORKBENCH_RESOLVED_THEMES, WORKBENCH_THEME_IDS } from "./config";
import type { WorkbenchResolvedThemeId, WorkbenchThemeId, WorkbenchThemeVars } from "./types";

const FALLBACK_THEME: WorkbenchResolvedThemeId = "lyra-light";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";
const LEGACY_THEME_PATTERN = /^(?:nova|terra|ocean|eclipse)-(light|dark|system)$/;

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
