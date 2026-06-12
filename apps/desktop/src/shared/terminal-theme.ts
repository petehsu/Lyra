export type TerminalThemeMode =
  | "follow-app"
  | "lyra-minimal"
  | "lyra-standard"
  | "lyra-rich"
  | "lyra-developer";

export type LegacyTerminalThemeModeId =
  | "auto-detect"
  | "glacier-blocks"
  | "ocean-matrix"
  | "amber-forge"
  | "mono-signal";

// Keep this alias for compatibility in existing terminal-related types.
export type TerminalThemePresetId = TerminalThemeMode;

export type TerminalPromptProfile = {
  readonly segmentBaseBg: string;
  readonly segmentDirectoryBg: string;
  readonly segmentGitBg: string;
  readonly segmentRuntimeBg: string;
  readonly segmentTimeBg: string;
  readonly segmentFg: string;
  readonly success: string;
  readonly error: string;
  readonly warning: string;
  readonly osIcon: string;
  readonly dirIcon: string;
  readonly gitIcon: string;
  readonly runtimeIcon: string;
  readonly timeIcon: string;
};

export type TerminalThemePreset = {
  readonly id: TerminalThemeMode;
  readonly vars: Record<`--${string}`, string>;
  readonly previewSwatches: readonly string[];
  readonly prompt: TerminalPromptProfile;
};

const DEFAULT_PROMPT_PROFILE: TerminalPromptProfile = {
  segmentBaseBg: "#2b2b2b",
  segmentDirectoryBg: "#3a3a3a",
  segmentGitBg: "#454545",
  segmentRuntimeBg: "#515151",
  segmentTimeBg: "#5c5c5c",
  segmentFg: "#f8f8f8",
  success: "#8ec07c",
  error: "#fb4934",
  warning: "#fabd2f",
  osIcon: "os",
  dirIcon: "dir",
  gitIcon: "git",
  runtimeIcon: "sh",
  timeIcon: "time"
};

const createPreset = (
  id: TerminalThemeMode,
  previewSwatches: readonly string[]
): TerminalThemePreset => ({
  id,
  vars: {},
  previewSwatches,
  prompt: DEFAULT_PROMPT_PROFILE
});

export const TERMINAL_THEME_MODE_IDS: readonly TerminalThemeMode[] = [
  "follow-app",
  "lyra-minimal",
  "lyra-standard",
  "lyra-rich",
  "lyra-developer"
] as const;

const LEGACY_TERMINAL_THEME_MODE_IDS: readonly LegacyTerminalThemeModeId[] = [
  "auto-detect",
  "glacier-blocks",
  "ocean-matrix",
  "amber-forge",
  "mono-signal"
] as const;

// Keep this export name for compatibility in existing imports.
export const TERMINAL_THEME_PRESET_IDS: readonly TerminalThemeMode[] =
  TERMINAL_THEME_MODE_IDS;

export const TERMINAL_THEME_PRESETS: Record<TerminalThemeMode, TerminalThemePreset> = {
  "follow-app": createPreset("follow-app", ["#77797d", "#56575a", "#669f59", "#a48819"]),
  "lyra-minimal": createPreset("lyra-minimal", ["#8ecae6", "#90be6d", "#f8961e", "#577590"]),
  "lyra-standard": createPreset("lyra-standard", ["#56575a", "#669f59", "#a48819", "#77797d"]),
  "lyra-rich": createPreset("lyra-rich", ["#82aaff", "#c3e88d", "#f78c6c", "#89ddff"]),
  "lyra-developer": createPreset("lyra-developer", ["#7dcfff", "#a6e3a1", "#f9e2af", "#f38ba8"])
};

export const isTerminalThemeModeId = (
  value: unknown
): value is TerminalThemeMode =>
  typeof value === "string" &&
  TERMINAL_THEME_MODE_IDS.includes(value as TerminalThemeMode);

const isLegacyTerminalThemeModeId = (
  value: unknown
): value is LegacyTerminalThemeModeId =>
  typeof value === "string" &&
  LEGACY_TERMINAL_THEME_MODE_IDS.includes(value as LegacyTerminalThemeModeId);

export const isTerminalThemePresetId = (
  value: unknown
): value is TerminalThemePresetId => isTerminalThemeModeId(value);

const LEGACY_MODE_MIGRATION_MAP: Record<LegacyTerminalThemeModeId, TerminalThemeMode> = {
  "auto-detect": "follow-app",
  "glacier-blocks": "lyra-rich",
  "ocean-matrix": "lyra-rich",
  "amber-forge": "lyra-rich",
  "mono-signal": "lyra-minimal"
};

export const normalizeTerminalThemeMode = (
  value: unknown,
  fallback: TerminalThemeMode = "follow-app"
): TerminalThemeMode => {
  if (isTerminalThemeModeId(value)) {
    return value;
  }
  if (isLegacyTerminalThemeModeId(value)) {
    return LEGACY_MODE_MIGRATION_MAP[value];
  }
  return fallback;
};

export const resolveTerminalThemePreset = (
  presetId: TerminalThemePresetId
): TerminalThemePreset =>
  TERMINAL_THEME_PRESETS[normalizeTerminalThemeMode(presetId)]
  ?? TERMINAL_THEME_PRESETS["follow-app"];
