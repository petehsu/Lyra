import type {
  WorkbenchBrowserWebThemePalette,
  WorkbenchBrowserWebThemeSnapshot
} from "./workbench-browser";

export const DEFAULT_WEB_THEME_PALETTE: WorkbenchBrowserWebThemePalette = {
  bgApp: "#1a1b20",
  bgSurface: "#24262d",
  bgEditor: "#1e2026",
  textPrimary: "#e6e7eb",
  textSecondary: "#b7bac3",
  textMuted: "#8b8f9b",
  textAccent: "#7aa7ff",
  lineDefault: "#353842",
  lineFocused: "#7aa7ff",
  statusSuccess: "#87c07a",
  statusWarning: "#dcba7a",
  statusError: "#e47878"
} as const;

export const DEFAULT_WEB_THEME_SNAPSHOT: WorkbenchBrowserWebThemeSnapshot = {
  enabled: false,
  isDark: true,
  palette: DEFAULT_WEB_THEME_PALETTE,
  revision: 0
} as const;

const HEX6_PATTERN = /^#([0-9a-fA-F]{6})$/;
const HEX3_PATTERN = /^#([0-9a-fA-F]{3})$/;
const RGB_PATTERN = /^rgba?\s*\(\s*([-\d.]+)\s*[, ]\s*([-\d.]+)\s*[, ]\s*([-\d.]+)(?:\s*[,/]\s*[-\d.]+%?)?\s*\)$/;

const clamp01 = (value: number): number => {
  if (Number.isFinite(value) === false) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

const toRgb = (value: string): readonly [number, number, number] | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const hex6 = trimmed.match(HEX6_PATTERN);
  if (hex6 !== null && typeof hex6[1] === "string") {
    const parsed = Number.parseInt(hex6[1], 16);
    return [((parsed >> 16) & 0xff) / 255, ((parsed >> 8) & 0xff) / 255, (parsed & 0xff) / 255];
  }
  const hex3 = trimmed.match(HEX3_PATTERN);
  if (hex3 !== null && typeof hex3[1] === "string" && hex3[1].length === 3) {
    const chars = hex3[1];
    const toByte = (char: string): number => Number.parseInt(`${char}${char}`, 16) / 255;
    return [toByte(chars[0] ?? "0"), toByte(chars[1] ?? "0"), toByte(chars[2] ?? "0")];
  }
  const rgb = trimmed.match(RGB_PATTERN);
  if (
    rgb !== null
    && typeof rgb[1] === "string"
    && typeof rgb[2] === "string"
    && typeof rgb[3] === "string"
  ) {
    return [
      clamp01(Number.parseFloat(rgb[1]) / 255),
      clamp01(Number.parseFloat(rgb[2]) / 255),
      clamp01(Number.parseFloat(rgb[3]) / 255)
    ];
  }
  return null;
};

export const resolveRelativeLuminance = (color: string): number => {
  const rgb = toRgb(color);
  if (rgb === null) {
    return 0;
  }
  const channel = (component: number): number => {
    if (component <= 0.03928) {
      return component / 12.92;
    }
    return ((component + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb;
  return channel(r) * 0.2126 + channel(g) * 0.7152 + channel(b) * 0.0722;
};

export const isDarkPaletteColor = (color: string): boolean =>
  resolveRelativeLuminance(color) < 0.5;

type LyraThemeVars = Readonly<Record<string, string>>;

const pickVar = (
  vars: LyraThemeVars,
  name: string,
  fallback: string
): string => {
  const candidate = vars[name];
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return fallback;
  }
  return candidate.trim();
};

export const resolveWebThemePalette = (
  vars: LyraThemeVars
): WorkbenchBrowserWebThemePalette => ({
  bgApp: pickVar(vars, "--lyra-bg-app", DEFAULT_WEB_THEME_PALETTE.bgApp),
  bgSurface: pickVar(vars, "--lyra-bg-surface", DEFAULT_WEB_THEME_PALETTE.bgSurface),
  bgEditor: pickVar(vars, "--lyra-bg-editor", DEFAULT_WEB_THEME_PALETTE.bgEditor),
  textPrimary: pickVar(vars, "--lyra-text-primary", DEFAULT_WEB_THEME_PALETTE.textPrimary),
  textSecondary: pickVar(
    vars,
    "--lyra-text-secondary",
    DEFAULT_WEB_THEME_PALETTE.textSecondary
  ),
  textMuted: pickVar(vars, "--lyra-text-muted", DEFAULT_WEB_THEME_PALETTE.textMuted),
  textAccent: pickVar(vars, "--lyra-text-accent", DEFAULT_WEB_THEME_PALETTE.textAccent),
  lineDefault: pickVar(
    vars,
    "--lyra-line-default",
    DEFAULT_WEB_THEME_PALETTE.lineDefault
  ),
  lineFocused: pickVar(
    vars,
    "--lyra-line-focused",
    DEFAULT_WEB_THEME_PALETTE.lineFocused
  ),
  statusSuccess: pickVar(
    vars,
    "--lyra-status-success",
    DEFAULT_WEB_THEME_PALETTE.statusSuccess
  ),
  statusWarning: pickVar(
    vars,
    "--lyra-status-warning",
    DEFAULT_WEB_THEME_PALETTE.statusWarning
  ),
  statusError: pickVar(
    vars,
    "--lyra-status-error",
    DEFAULT_WEB_THEME_PALETTE.statusError
  )
});

export type BuildWebThemeSnapshotInput = {
  readonly vars: LyraThemeVars;
  readonly enabled: boolean;
  readonly previousRevision: number;
};

export const buildWebThemeSnapshot = ({
  vars,
  enabled,
  previousRevision
}: BuildWebThemeSnapshotInput): WorkbenchBrowserWebThemeSnapshot => {
  const palette = resolveWebThemePalette(vars);
  return {
    enabled,
    isDark: isDarkPaletteColor(palette.bgApp),
    palette,
    revision: previousRevision + 1
  };
};

export const areWebThemeSnapshotsEquivalent = (
  a: WorkbenchBrowserWebThemeSnapshot,
  b: WorkbenchBrowserWebThemeSnapshot
): boolean => {
  if (a === b) {
    return true;
  }
  if (a.enabled !== b.enabled) {
    return false;
  }
  if (a.isDark !== b.isDark) {
    return false;
  }
  const aPalette = a.palette as Readonly<Record<string, string>>;
  const bPalette = b.palette as Readonly<Record<string, string>>;
  for (const key of Object.keys(aPalette)) {
    if (aPalette[key] !== bPalette[key]) {
      return false;
    }
  }
  return true;
};
