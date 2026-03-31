import { useState } from "react";

import { WORKBENCH_LOCALES, type WorkbenchLocale } from "../i18n";
import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import { isWorkbenchThemeId } from "../theme";
import type { WorkbenchThemeId } from "../theme";
import { isWorkbenchTerminalThemePresetId } from "../terminal-theme";
import type { TerminalThemePresetId } from "../terminal-theme";
import type {
  WorkbenchPreferences,
  WorkbenchPreferencesModel,
  WorkbenchSplitOverflowPolicy,
  WorkbenchSplitThreePaneLayout,
  WorkbenchSplitTriggerMode
} from "./types";

export const WORKBENCH_PREFERENCES_STORAGE_KEY = "lyra.workbench.preferences.v1";
const WORKBENCH_PREFERENCES_STATE_KEY = "preferences" as const;

const isLocale = (value: unknown): value is WorkbenchLocale =>
  typeof value === "string" && WORKBENCH_LOCALES.includes(value as WorkbenchLocale);

const isTheme = (value: unknown): value is WorkbenchThemeId => isWorkbenchThemeId(value);
const isTerminalThemePreset = (value: unknown): value is TerminalThemePresetId =>
  isWorkbenchTerminalThemePresetId(value);
const isSplitTriggerMode = (value: unknown): value is WorkbenchSplitTriggerMode =>
  value === "ctrl_left_drag" || value === "right_drag";
const isSplitThreePaneLayout = (value: unknown): value is WorkbenchSplitThreePaneLayout =>
  value === "top_two_bottom_one" ||
  value === "top_one_bottom_two" ||
  value === "left_two_right_one" ||
  value === "left_one_right_two" ||
  value === "adaptive";
const isSplitOverflowPolicy = (value: unknown): value is WorkbenchSplitOverflowPolicy =>
  value === "block_with_notice" ||
  value === "replace_oldest" ||
  value === "replace_target";

export const readWorkbenchPreferences = (defaults: WorkbenchPreferences): WorkbenchPreferences => {
  if (typeof window === "undefined") {
    return defaults;
  }

  const raw = readWorkbenchStateSync(WORKBENCH_PREFERENCES_STATE_KEY);
  if (raw === null) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as {
      readonly locale?: unknown;
      readonly theme?: unknown;
      readonly terminalThemePreset?: unknown;
      readonly splitTriggerMode?: unknown;
      readonly splitThreePaneLayout?: unknown;
      readonly splitOverflowPolicy?: unknown;
    };

    return {
      locale: isLocale(parsed.locale) ? parsed.locale : defaults.locale,
      theme: isTheme(parsed.theme) ? parsed.theme : defaults.theme,
      terminalThemePreset: isTerminalThemePreset(parsed.terminalThemePreset)
        ? parsed.terminalThemePreset
        : defaults.terminalThemePreset,
      splitTriggerMode: isSplitTriggerMode(parsed.splitTriggerMode)
        ? parsed.splitTriggerMode
        : defaults.splitTriggerMode,
      splitThreePaneLayout: isSplitThreePaneLayout(parsed.splitThreePaneLayout)
        ? parsed.splitThreePaneLayout
        : defaults.splitThreePaneLayout,
      splitOverflowPolicy: isSplitOverflowPolicy(parsed.splitOverflowPolicy)
        ? parsed.splitOverflowPolicy
        : defaults.splitOverflowPolicy
    };
  } catch (_error) {
    return defaults;
  }
};

export const writeWorkbenchPreferences = (preferences: WorkbenchPreferences): void => {
  if (typeof window === "undefined") {
    return;
  }

  writeWorkbenchStateSync(
    WORKBENCH_PREFERENCES_STATE_KEY,
    JSON.stringify(preferences)
  );
};

export const useWorkbenchPreferencesModel = (
  defaults: WorkbenchPreferences
): WorkbenchPreferencesModel => {
  const [preferences, setPreferences] = useState<WorkbenchPreferences>(() => readWorkbenchPreferences(defaults));

  const commit = (updater: (current: WorkbenchPreferences) => WorkbenchPreferences): void => {
    setPreferences((current) => {
      const next = updater(current);
      writeWorkbenchPreferences(next);
      return next;
    });
  };

  return {
    preferences,
    setLocale: (locale) => {
      commit((current) => ({
        ...current,
        locale
      }));
    },
    setTheme: (theme) => {
      commit((current) => ({
        ...current,
        theme
      }));
    },
    setTerminalThemePreset: (terminalThemePreset) => {
      commit((current) => ({
        ...current,
        terminalThemePreset
      }));
    },
    setSplitTriggerMode: (splitTriggerMode) => {
      commit((current) => ({
        ...current,
        splitTriggerMode
      }));
    },
    setSplitThreePaneLayout: (splitThreePaneLayout) => {
      commit((current) => ({
        ...current,
        splitThreePaneLayout
      }));
    },
    setSplitOverflowPolicy: (splitOverflowPolicy) => {
      commit((current) => ({
        ...current,
        splitOverflowPolicy
      }));
    },
    reset: () => {
      commit(() => defaults);
    }
  };
};
