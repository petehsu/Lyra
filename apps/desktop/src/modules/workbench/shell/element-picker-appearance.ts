import type { WorkbenchBrowserElementPickerAppearance } from "../../../shared/desktop-bridge";

const FALLBACK_APPEARANCE: WorkbenchBrowserElementPickerAppearance = {
  fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Segoe UI", sans-serif',
  surfaceBackground:
    "linear-gradient(180deg, color-mix(in srgb, #ebebec 92%, transparent) 0%, color-mix(in srgb, #fafafa 88%, transparent) 100%)",
  surfaceBorder: "color-mix(in srgb, #d8d8da 42%, transparent)",
  surfaceShadow: "0 7px 22px color-mix(in srgb, #dcdcdd 18%, transparent)",
  surfaceBackdropFilter: "blur(10px) saturate(1.08)",
  accentColor: "#7e8086",
  accentFill: "color-mix(in srgb, #7e8086 14%, transparent)",
  tagBackground: "color-mix(in srgb, #7e8086 12%, transparent)",
  tagText: "#58585a",
  textPrimary: "#242529",
  textSecondary: "#58585a",
  textMuted: "#7e8086",
  frameRadius: "8px",
  bubbleRadius: "10px",
  strokeWidth: "0.5px"
};

const readVar = (styles: CSSStyleDeclaration, name: string, fallback: string): string => {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
};

const resolveVarValue = (
  styles: CSSStyleDeclaration,
  value: string,
  fallback: string,
  seen: Set<string> = new Set()
): string => {
  const trimmed = value.trim();
  const match = /^var\((--lyra-[^)]+)\)$/.exec(trimmed);
  if (match === null) {
    return trimmed.length > 0 ? trimmed : fallback;
  }
  const token = match[1] ?? "";
  if (token.length === 0 || seen.has(token)) {
    return fallback;
  }
  seen.add(token);
  return resolveVarValue(styles, readVar(styles, token, fallback), fallback, seen);
};

export const readElementPickerAppearance = (): WorkbenchBrowserElementPickerAppearance => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return FALLBACK_APPEARANCE;
  }

  const styles = window.getComputedStyle(document.documentElement);
  const bgApp = readVar(styles, "--lyra-bg-app", FALLBACK_APPEARANCE.textMuted);
  const bgSurface = readVar(styles, "--lyra-bg-surface-elevated", "#ebebec");
  const bgEditor = readVar(styles, "--lyra-bg-editor", "#fafafa");
  const lineDefault = readVar(styles, "--lyra-line-default", FALLBACK_APPEARANCE.surfaceBorder);
  const textSecondary = readVar(styles, "--lyra-text-secondary", FALLBACK_APPEARANCE.textSecondary);

  return {
    fontFamily: resolveVarValue(
      styles,
      readVar(styles, "--lyra-font-ui", FALLBACK_APPEARANCE.fontFamily),
      FALLBACK_APPEARANCE.fontFamily
    ),
    surfaceBackground:
      `linear-gradient(180deg, color-mix(in srgb, ${bgSurface} 92%, transparent) 0%, color-mix(in srgb, ${bgEditor} 88%, transparent) 100%)`,
    surfaceBorder: `color-mix(in srgb, ${lineDefault} 42%, transparent)`,
    surfaceShadow: `0 7px 22px color-mix(in srgb, ${bgApp} 18%, transparent)`,
    surfaceBackdropFilter: readVar(
      styles,
      "--lyra-backdrop-blur-sm",
      FALLBACK_APPEARANCE.surfaceBackdropFilter
    ),
    accentColor: textSecondary,
    accentFill: `color-mix(in srgb, ${textSecondary} 12%, transparent)`,
    tagBackground: `color-mix(in srgb, ${textSecondary} 10%, transparent)`,
    tagText: textSecondary,
    textPrimary: readVar(styles, "--lyra-text-primary", FALLBACK_APPEARANCE.textPrimary),
    textSecondary: readVar(styles, "--lyra-text-secondary", FALLBACK_APPEARANCE.textSecondary),
    textMuted: readVar(styles, "--lyra-text-muted", FALLBACK_APPEARANCE.textMuted),
    frameRadius: resolveVarValue(
      styles,
      readVar(styles, "--lyra-surface-radius-sm", FALLBACK_APPEARANCE.frameRadius),
      FALLBACK_APPEARANCE.frameRadius
    ),
    bubbleRadius: resolveVarValue(
      styles,
      readVar(styles, "--lyra-surface-radius-md", FALLBACK_APPEARANCE.bubbleRadius),
      FALLBACK_APPEARANCE.bubbleRadius
    ),
    strokeWidth: resolveVarValue(
      styles,
      readVar(styles, "--lyra-stroke-hairline", FALLBACK_APPEARANCE.strokeWidth),
      FALLBACK_APPEARANCE.strokeWidth
    )
  };
};
