export type TerminalThemePresetId =
  | "glacier-blocks"
  | "ocean-matrix"
  | "amber-forge"
  | "mono-signal";

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
  readonly id: TerminalThemePresetId;
  readonly vars: Record<`--${string}`, string>;
  readonly previewSwatches: readonly string[];
  readonly prompt: TerminalPromptProfile;
};

const createPreset = (
  id: TerminalThemePresetId,
  vars: Record<`--${string}`, string>,
  previewSwatches: readonly string[],
  prompt: TerminalPromptProfile
): TerminalThemePreset => ({
  id,
  vars,
  previewSwatches,
  prompt
});

export const TERMINAL_THEME_PRESETS: Record<TerminalThemePresetId, TerminalThemePreset> = {
  "glacier-blocks": createPreset(
    "glacier-blocks",
    {
      "--lyra-terminal-bg": "#0f1726",
      "--lyra-terminal-fg": "#d7e8ff",
      "--lyra-terminal-cursor": "#6ee7ff",
      "--lyra-terminal-cursor-accent": "#0f1726",
      "--lyra-terminal-selection-bg": "#1f3658",
      "--lyra-terminal-black": "#0f1726",
      "--lyra-terminal-red": "#ff6b7a",
      "--lyra-terminal-green": "#4fd8b6",
      "--lyra-terminal-yellow": "#ffd166",
      "--lyra-terminal-blue": "#70a5ff",
      "--lyra-terminal-magenta": "#be8dff",
      "--lyra-terminal-cyan": "#6ee7ff",
      "--lyra-terminal-white": "#d7e8ff",
      "--lyra-terminal-bright-black": "#4b5a74",
      "--lyra-terminal-bright-red": "#ff8c98",
      "--lyra-terminal-bright-green": "#74efd0",
      "--lyra-terminal-bright-yellow": "#ffe19b",
      "--lyra-terminal-bright-blue": "#9cc0ff",
      "--lyra-terminal-bright-magenta": "#d4adff",
      "--lyra-terminal-bright-cyan": "#96f0ff",
      "--lyra-terminal-bright-white": "#ffffff",
      "--lyra-terminal-chrome-gradient-top": "#102033",
      "--lyra-terminal-chrome-gradient-bottom": "#0c1624",
      "--lyra-terminal-toolbar-chip-bg": "#183454",
      "--lyra-terminal-toolbar-chip-fg": "#8ce9ff",
      "--lyra-terminal-toolbar-chip-border": "#24507f",
      "--lyra-terminal-tab-active-border": "#58c6ff",
      "--lyra-terminal-pane-active-border": "#4fd8b6"
    },
    ["#58c6ff", "#4fd8b6", "#be8dff", "#ffd166"],
    {
      segmentBaseBg: "#183454",
      segmentDirectoryBg: "#24507f",
      segmentGitBg: "#2a5f74",
      segmentRuntimeBg: "#385b96",
      segmentTimeBg: "#4a3976",
      segmentFg: "#eaf4ff",
      success: "#53e4b0",
      error: "#ff6b7a",
      warning: "#ffd166",
      osIcon: "",
      dirIcon: "",
      gitIcon: "",
      runtimeIcon: "",
      timeIcon: ""
    }
  ),
  "ocean-matrix": createPreset(
    "ocean-matrix",
    {
      "--lyra-terminal-bg": "#08181a",
      "--lyra-terminal-fg": "#c7efe8",
      "--lyra-terminal-cursor": "#4ee7c9",
      "--lyra-terminal-cursor-accent": "#08181a",
      "--lyra-terminal-selection-bg": "#16423f",
      "--lyra-terminal-black": "#08181a",
      "--lyra-terminal-red": "#ff7e67",
      "--lyra-terminal-green": "#45d7a6",
      "--lyra-terminal-yellow": "#f2cf66",
      "--lyra-terminal-blue": "#5eb3ff",
      "--lyra-terminal-magenta": "#cd92ff",
      "--lyra-terminal-cyan": "#4ee7c9",
      "--lyra-terminal-white": "#c7efe8",
      "--lyra-terminal-bright-black": "#3f6461",
      "--lyra-terminal-bright-red": "#ff9f8d",
      "--lyra-terminal-bright-green": "#72f0c1",
      "--lyra-terminal-bright-yellow": "#f8dea3",
      "--lyra-terminal-bright-blue": "#8cc9ff",
      "--lyra-terminal-bright-magenta": "#debcff",
      "--lyra-terminal-bright-cyan": "#8bf5e2",
      "--lyra-terminal-bright-white": "#ffffff",
      "--lyra-terminal-chrome-gradient-top": "#0c2426",
      "--lyra-terminal-chrome-gradient-bottom": "#08181a",
      "--lyra-terminal-toolbar-chip-bg": "#123b3b",
      "--lyra-terminal-toolbar-chip-fg": "#7ff8e1",
      "--lyra-terminal-toolbar-chip-border": "#215656",
      "--lyra-terminal-tab-active-border": "#4ee7c9",
      "--lyra-terminal-pane-active-border": "#45d7a6"
    },
    ["#4ee7c9", "#45d7a6", "#5eb3ff", "#f2cf66"],
    {
      segmentBaseBg: "#123b3b",
      segmentDirectoryBg: "#1a5251",
      segmentGitBg: "#1e4f66",
      segmentRuntimeBg: "#2d4f7f",
      segmentTimeBg: "#4a3d73",
      segmentFg: "#e8fff9",
      success: "#45d7a6",
      error: "#ff7e67",
      warning: "#f2cf66",
      osIcon: "",
      dirIcon: "",
      gitIcon: "",
      runtimeIcon: "",
      timeIcon: ""
    }
  ),
  "amber-forge": createPreset(
    "amber-forge",
    {
      "--lyra-terminal-bg": "#1c130a",
      "--lyra-terminal-fg": "#ffe7cb",
      "--lyra-terminal-cursor": "#ffb454",
      "--lyra-terminal-cursor-accent": "#1c130a",
      "--lyra-terminal-selection-bg": "#5a3416",
      "--lyra-terminal-black": "#1c130a",
      "--lyra-terminal-red": "#ff7a59",
      "--lyra-terminal-green": "#7bd389",
      "--lyra-terminal-yellow": "#ffc77a",
      "--lyra-terminal-blue": "#8ec3ff",
      "--lyra-terminal-magenta": "#e2a8ff",
      "--lyra-terminal-cyan": "#6ce2d6",
      "--lyra-terminal-white": "#ffe7cb",
      "--lyra-terminal-bright-black": "#6e4d33",
      "--lyra-terminal-bright-red": "#ff9e88",
      "--lyra-terminal-bright-green": "#9be9a7",
      "--lyra-terminal-bright-yellow": "#ffd9a8",
      "--lyra-terminal-bright-blue": "#b3d8ff",
      "--lyra-terminal-bright-magenta": "#f0cbff",
      "--lyra-terminal-bright-cyan": "#99f1e8",
      "--lyra-terminal-bright-white": "#ffffff",
      "--lyra-terminal-chrome-gradient-top": "#26180e",
      "--lyra-terminal-chrome-gradient-bottom": "#1c130a",
      "--lyra-terminal-toolbar-chip-bg": "#4d2c13",
      "--lyra-terminal-toolbar-chip-fg": "#ffcf88",
      "--lyra-terminal-toolbar-chip-border": "#73431b",
      "--lyra-terminal-tab-active-border": "#ffb454",
      "--lyra-terminal-pane-active-border": "#ffc77a"
    },
    ["#ffb454", "#ffc77a", "#ff7a59", "#7bd389"],
    {
      segmentBaseBg: "#4d2c13",
      segmentDirectoryBg: "#6e4018",
      segmentGitBg: "#7a4d1f",
      segmentRuntimeBg: "#755536",
      segmentTimeBg: "#4e3a57",
      segmentFg: "#fff4e7",
      success: "#7bd389",
      error: "#ff7a59",
      warning: "#ffc77a",
      osIcon: "",
      dirIcon: "",
      gitIcon: "",
      runtimeIcon: "",
      timeIcon: ""
    }
  ),
  "mono-signal": createPreset(
    "mono-signal",
    {
      "--lyra-terminal-bg": "#111111",
      "--lyra-terminal-fg": "#f0f0f0",
      "--lyra-terminal-cursor": "#ffffff",
      "--lyra-terminal-cursor-accent": "#111111",
      "--lyra-terminal-selection-bg": "#3a3a3a",
      "--lyra-terminal-black": "#111111",
      "--lyra-terminal-red": "#ff4c4c",
      "--lyra-terminal-green": "#9ee37d",
      "--lyra-terminal-yellow": "#ffd369",
      "--lyra-terminal-blue": "#8ec7ff",
      "--lyra-terminal-magenta": "#d4a5ff",
      "--lyra-terminal-cyan": "#89f0e8",
      "--lyra-terminal-white": "#f0f0f0",
      "--lyra-terminal-bright-black": "#5a5a5a",
      "--lyra-terminal-bright-red": "#ff7b7b",
      "--lyra-terminal-bright-green": "#c0f4a9",
      "--lyra-terminal-bright-yellow": "#ffe09b",
      "--lyra-terminal-bright-blue": "#b8ddff",
      "--lyra-terminal-bright-magenta": "#e8ccff",
      "--lyra-terminal-bright-cyan": "#b9faf5",
      "--lyra-terminal-bright-white": "#ffffff",
      "--lyra-terminal-chrome-gradient-top": "#1a1a1a",
      "--lyra-terminal-chrome-gradient-bottom": "#111111",
      "--lyra-terminal-toolbar-chip-bg": "#2b2b2b",
      "--lyra-terminal-toolbar-chip-fg": "#f0f0f0",
      "--lyra-terminal-toolbar-chip-border": "#4a4a4a",
      "--lyra-terminal-tab-active-border": "#ffffff",
      "--lyra-terminal-pane-active-border": "#ff4c4c"
    },
    ["#f0f0f0", "#ff4c4c", "#8ec7ff", "#ffd369"],
    {
      segmentBaseBg: "#2b2b2b",
      segmentDirectoryBg: "#3a3a3a",
      segmentGitBg: "#454545",
      segmentRuntimeBg: "#515151",
      segmentTimeBg: "#5c5c5c",
      segmentFg: "#f8f8f8",
      success: "#9ee37d",
      error: "#ff4c4c",
      warning: "#ffd369",
      osIcon: "󰣇",
      dirIcon: "",
      gitIcon: "",
      runtimeIcon: "",
      timeIcon: ""
    }
  )
};

export const TERMINAL_THEME_PRESET_IDS: readonly TerminalThemePresetId[] = [
  "glacier-blocks",
  "ocean-matrix",
  "amber-forge",
  "mono-signal"
] as const;

export const isTerminalThemePresetId = (
  value: unknown
): value is TerminalThemePresetId =>
  typeof value === "string" &&
  TERMINAL_THEME_PRESET_IDS.includes(value as TerminalThemePresetId);

export const resolveTerminalThemePreset = (
  presetId: TerminalThemePresetId
): TerminalThemePreset =>
  TERMINAL_THEME_PRESETS[presetId] ?? TERMINAL_THEME_PRESETS["glacier-blocks"];
