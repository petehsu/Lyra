import {
  TERMINAL_THEME_MODE_IDS,
  isTerminalThemeModeId,
  normalizeTerminalThemeMode,
  resolveTerminalThemePreset
} from "../../../shared/terminal-theme";
import type { TerminalThemeMode } from "./types";

const FALLBACK_PRESET: TerminalThemeMode = "follow-app";

export const isWorkbenchTerminalThemePresetId = (
  value: unknown
): value is TerminalThemeMode => isTerminalThemeModeId(value);

export const resolveTerminalThemeVars = (
  presetId: TerminalThemeMode
): Record<`--${string}`, string> => {
  void presetId;
  return {};
};

export const resolveTerminalThemePreviewSwatches = (
  presetId: TerminalThemeMode
): readonly string[] => resolveTerminalThemePreset(presetId).previewSwatches;

export const resolveTerminalThemePresetId = (
  value: unknown
): TerminalThemeMode => normalizeTerminalThemeMode(value, FALLBACK_PRESET);

export const WORKBENCH_TERMINAL_THEME_PRESET_IDS = TERMINAL_THEME_MODE_IDS;
