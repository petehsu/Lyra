import { useMemo, useRef, useState } from "react";

import {
  getWorkbenchLocale,
  isWorkbenchLocale,
  setWorkbenchLocale,
  useWorkbenchLocale,
  type WorkbenchLocale
} from "../i18n";
import type {
  SystemNotificationClickBehavior,
  SystemNotificationMode
} from "../../../shared/desktop-bridge";
import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import { normalizeWorkbenchThemeId } from "../theme";
import type { WorkbenchThemeId } from "../theme";
import { resolveWorkbenchUiPackId } from "../ui-platform";
import type { WorkbenchUiPackId } from "../ui-platform";
import type {
  WorkbenchAiStopBehavior,
  WorkbenchEditorGpuAcceleration,
  WorkbenchOmniboxNonBrowserSubmitTarget,
  WorkbenchPreferences,
  WorkbenchPreferencesModel,
  WorkbenchSearchResultsSourceFilter,
  WorkbenchSplitOverflowPolicy,
  WorkbenchSplitThreePaneLayout,
  WorkbenchSplitTriggerMode
} from "./types";
import type { AuthLocalePreference } from "../../../shared/auth";

export const WORKBENCH_PREFERENCES_STORAGE_KEY = "lyra.workbench.preferences.v1";
const WORKBENCH_PREFERENCES_STATE_KEY = "preferences" as const;

const normalizeTheme = (value: unknown, fallback: WorkbenchThemeId): WorkbenchThemeId =>
  normalizeWorkbenchThemeId(value, fallback);
const isUiPackId = (value: unknown): value is WorkbenchUiPackId =>
  resolveWorkbenchUiPackId(value) === value;
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
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isWorkbenchAiStopBehavior = (value: unknown): value is WorkbenchAiStopBehavior =>
  value === "turn_only" || value === "turn_and_background";
const isEditorGpuAcceleration = (value: unknown): value is WorkbenchEditorGpuAcceleration =>
  value === "off" || value === "auto";
const isSearchResultsSourceFilter = (value: unknown): value is WorkbenchSearchResultsSourceFilter =>
  value === "all" || value === "web";
const isWorkbenchOmniboxNonBrowserSubmitTarget = (
  value: unknown
): value is WorkbenchOmniboxNonBrowserSubmitTarget =>
  value === "new_tab" || value === "replace_active_tab";
const isSystemNotificationMode = (value: unknown): value is SystemNotificationMode =>
  value === "off" || value === "background" || value === "all";
const isSystemNotificationClickBehavior = (
  value: unknown
): value is SystemNotificationClickBehavior =>
  value === "open_center" || value === "open_source";
const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    : [];

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
      readonly localePreference?: unknown;
      readonly theme?: unknown;
      readonly windowMaterialEnabled?: unknown;
      readonly uiPackId?: unknown;
      readonly uiStyleId?: unknown;
      readonly splitTriggerMode?: unknown;
      readonly splitThreePaneLayout?: unknown;
      readonly splitOverflowPolicy?: unknown;
      readonly aiRichRenderingEnabled?: unknown;
      readonly aiStopBehavior?: unknown;
      readonly preventSleepEnabled?: unknown;
      readonly editorGpuAcceleration?: unknown;
      readonly searchWebEngineIds?: unknown;
	      readonly searchSearxngEndpoint?: unknown;
	      readonly searchResultsSourceFilter?: unknown;
      readonly omniboxNonBrowserSubmitTarget?: unknown;
      readonly systemNotificationMode?: unknown;
      readonly systemNotificationClickBehavior?: unknown;
      readonly systemNotificationActionsEnabled?: unknown;
    };

    const normalizedSearxngEndpoint =
      typeof parsed.searchSearxngEndpoint === "string"
        ? parsed.searchSearxngEndpoint.trim()
        : defaults.searchSearxngEndpoint;
    const normalizedLocalePreference: AuthLocalePreference | undefined =
      parsed.localePreference === "system"
        ? { mode: "system" }
        : parsed.localePreference !== null
          && typeof parsed.localePreference === "object"
          && (parsed.localePreference as { readonly mode?: unknown }).mode === "explicit"
          && typeof (parsed.localePreference as { readonly locale?: unknown }).locale === "string"
          ? {
              mode: "explicit",
              locale: (parsed.localePreference as { readonly locale: string }).locale
            }
          : defaults.localePreference;

    return {
      locale: isWorkbenchLocale(parsed.locale) ? parsed.locale : defaults.locale,
      ...(normalizedLocalePreference === undefined
        ? {}
        : { localePreference: normalizedLocalePreference }),
      theme: normalizeTheme(parsed.theme, defaults.theme),
      windowMaterialEnabled: isBoolean(parsed.windowMaterialEnabled)
        ? parsed.windowMaterialEnabled
        : defaults.windowMaterialEnabled,
      uiPackId: isUiPackId(parsed.uiPackId)
        ? parsed.uiPackId
        : isUiPackId(parsed.uiStyleId)
          ? parsed.uiStyleId
          : defaults.uiPackId,
      splitTriggerMode: isSplitTriggerMode(parsed.splitTriggerMode)
        ? parsed.splitTriggerMode
        : defaults.splitTriggerMode,
      splitThreePaneLayout: isSplitThreePaneLayout(parsed.splitThreePaneLayout)
        ? parsed.splitThreePaneLayout
        : defaults.splitThreePaneLayout,
      splitOverflowPolicy: isSplitOverflowPolicy(parsed.splitOverflowPolicy)
        ? parsed.splitOverflowPolicy
        : defaults.splitOverflowPolicy,
      aiRichRenderingEnabled: isBoolean(parsed.aiRichRenderingEnabled)
        ? parsed.aiRichRenderingEnabled
        : defaults.aiRichRenderingEnabled,
      aiStopBehavior: isWorkbenchAiStopBehavior(parsed.aiStopBehavior)
        ? parsed.aiStopBehavior
        : defaults.aiStopBehavior,
      preventSleepEnabled: isBoolean(parsed.preventSleepEnabled)
        ? parsed.preventSleepEnabled
        : defaults.preventSleepEnabled,
      editorGpuAcceleration: isEditorGpuAcceleration(parsed.editorGpuAcceleration)
        ? parsed.editorGpuAcceleration
        : defaults.editorGpuAcceleration,
      searchWebEngineIds: asStringArray(parsed.searchWebEngineIds),
	      ...(normalizedSearxngEndpoint === undefined
	        ? {}
	        : { searchSearxngEndpoint: normalizedSearxngEndpoint }),
	      searchResultsSourceFilter: isSearchResultsSourceFilter(parsed.searchResultsSourceFilter)
        ? parsed.searchResultsSourceFilter
        : defaults.searchResultsSourceFilter,
      omniboxNonBrowserSubmitTarget: isWorkbenchOmniboxNonBrowserSubmitTarget(parsed.omniboxNonBrowserSubmitTarget)
        ? parsed.omniboxNonBrowserSubmitTarget
        : defaults.omniboxNonBrowserSubmitTarget,
      systemNotificationMode: isSystemNotificationMode(parsed.systemNotificationMode)
        ? parsed.systemNotificationMode
        : defaults.systemNotificationMode,
      systemNotificationClickBehavior: isSystemNotificationClickBehavior(parsed.systemNotificationClickBehavior)
        ? parsed.systemNotificationClickBehavior
        : defaults.systemNotificationClickBehavior,
      systemNotificationActionsEnabled: isBoolean(parsed.systemNotificationActionsEnabled)
        ? parsed.systemNotificationActionsEnabled
        : defaults.systemNotificationActionsEnabled
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
  setWorkbenchLocale(preferences.locale);
};

export const useWorkbenchPreferencesModel = (
  defaults: WorkbenchPreferences
): WorkbenchPreferencesModel => {
  const initialPreferences = useMemo(() => readWorkbenchPreferences(defaults), [defaults]);
  const [storedPreferences, setStoredPreferences] = useState<WorkbenchPreferences>(
    initialPreferences
  );
  const preferencesRef = useRef(storedPreferences);
  const locale = useWorkbenchLocale();
  const preferences = useMemo(
    () => ({
      ...storedPreferences,
      locale
    }),
    [locale, storedPreferences]
  );

  const commit = (updater: (current: WorkbenchPreferences) => WorkbenchPreferences): void => {
    const next = updater({
      ...preferencesRef.current,
      locale: getWorkbenchLocale()
    });
    preferencesRef.current = next;
    setStoredPreferences(next);
    writeWorkbenchPreferences(next);
  };

  return {
    preferences,
    setLocale: (locale) => {
      commit((current) => current.localePreference === undefined
        ? {
            ...current,
            locale
          }
        : {
            ...current,
            locale,
            localePreference: { mode: "explicit", locale }
          });
    },
    setTheme: (theme) => {
      commit((current) => ({
        ...current,
        theme
      }));
    },
    setWindowMaterialEnabled: (enabled) => {
      commit((current) => ({
        ...current,
        windowMaterialEnabled: enabled
      }));
    },
    setUiPackId: (uiPackId) => {
      commit((current) => ({
        ...current,
        uiPackId
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
    setAiRichRenderingEnabled: (aiRichRenderingEnabled) => {
      commit((current) => ({
        ...current,
        aiRichRenderingEnabled
      }));
    },
    setAiStopBehavior: (aiStopBehavior) => {
      commit((current) => ({
        ...current,
        aiStopBehavior
      }));
    },
    setPreventSleepEnabled: (preventSleepEnabled) => {
      commit((current) => ({
        ...current,
        preventSleepEnabled
      }));
    },
    setEditorGpuAcceleration: (editorGpuAcceleration) => {
      commit((current) => ({
        ...current,
        editorGpuAcceleration
      }));
    },
    setSearchWebEngineIds: (searchWebEngineIds) => {
      commit((current) => ({
        ...current,
        searchWebEngineIds: searchWebEngineIds
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      }));
    },
    setSearchSearxngEndpoint: (searchSearxngEndpoint) => {
      const normalizedSearxngEndpoint =
        typeof searchSearxngEndpoint === "string" && searchSearxngEndpoint.trim().length > 0
          ? searchSearxngEndpoint.trim()
          : undefined;
      commit((current) => ({
        ...(normalizedSearxngEndpoint === undefined
          ? (() => {
              const { searchSearxngEndpoint: _searchSearxngEndpoint, ...rest } = current;
              return rest;
            })()
          : {
              ...current,
              searchSearxngEndpoint: normalizedSearxngEndpoint
            })
      }));
    },
	    setSearchResultsSourceFilter: (searchResultsSourceFilter) => {
      commit((current) => ({
        ...current,
        searchResultsSourceFilter
      }));
    },
    setOmniboxNonBrowserSubmitTarget: (omniboxNonBrowserSubmitTarget) => {
      commit((current) => ({
        ...current,
        omniboxNonBrowserSubmitTarget
      }));
    },
    setSystemNotificationMode: (systemNotificationMode) => {
      commit((current) => ({
        ...current,
        systemNotificationMode
      }));
    },
    setSystemNotificationClickBehavior: (systemNotificationClickBehavior) => {
      commit((current) => ({
        ...current,
        systemNotificationClickBehavior
      }));
    },
    setSystemNotificationActionsEnabled: (systemNotificationActionsEnabled) => {
      commit((current) => ({
        ...current,
        systemNotificationActionsEnabled
      }));
    },
    reset: () => {
      commit(() => defaults);
    }
  };
};
