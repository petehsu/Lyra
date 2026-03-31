import {
  TERMINAL_THEME_PRESET_IDS,
  isTerminalThemePresetId,
  resolveTerminalThemePreset
} from "../../../shared/terminal-theme";
import type { TerminalThemePresetId } from "./types";

const FALLBACK_PRESET: TerminalThemePresetId = "glacier-blocks";

export const isWorkbenchTerminalThemePresetId = (
  value: unknown
): value is TerminalThemePresetId => isTerminalThemePresetId(value);

export const resolveTerminalThemeVars = (
  presetId: TerminalThemePresetId
): Record<`--${string}`, string> => {
  void presetId;
  return {};
};

export const resolveTerminalThemePreviewSwatches = (
  presetId: TerminalThemePresetId
): readonly string[] => resolveTerminalThemePreset(presetId).previewSwatches;

export const resolveTerminalThemePresetId = (
  value: unknown
): TerminalThemePresetId =>
  isTerminalThemePresetId(value) ? value : FALLBACK_PRESET;

export const WORKBENCH_TERMINAL_THEME_PRESET_IDS = TERMINAL_THEME_PRESET_IDS;
