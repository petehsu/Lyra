import { useState } from "react";

import { WORKBENCH_LOCALES, type WorkbenchLocale } from "../i18n";
import type {
  SearchDeepCrawlPolicy,
  SearchDeepBudgetPreset,
  SystemNotificationClickBehavior,
  SystemNotificationMode
} from "../../../shared/desktop-bridge";
import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import { isWorkbenchThemeId } from "../theme";
import type { WorkbenchThemeId } from "../theme";
import { resolveWorkbenchUiPackId } from "../ui-platform";
import type { WorkbenchUiPackId } from "../ui-platform";
import type {
  WorkbenchAiStopBehavior,
  WorkbenchOmniboxNonBrowserSubmitTarget,
  WorkbenchPreferences,
  WorkbenchPreferencesModel,
  WorkbenchSearchResultsSourceFilter,
  WorkbenchSplitOverflowPolicy,
  WorkbenchSplitThreePaneLayout,
  WorkbenchSplitTriggerMode
} from "./types";

export const WORKBENCH_PREFERENCES_STORAGE_KEY = "lyra.workbench.preferences.v1";
const WORKBENCH_PREFERENCES_STATE_KEY = "preferences" as const;

const isLocale = (value: unknown): value is WorkbenchLocale =>
  typeof value === "string" && WORKBENCH_LOCALES.includes(value as WorkbenchLocale);

const isTheme = (value: unknown): value is WorkbenchThemeId => isWorkbenchThemeId(value);
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
const isSearchDeepBudgetPreset = (value: unknown): value is SearchDeepBudgetPreset =>
  value === "low" || value === "medium" || value === "high";
const isSearchDeepCrawlPolicy = (value: unknown): value is SearchDeepCrawlPolicy =>
  value === "accessibility_only";
const isDeepSearchLocalOpenBehavior = (
  value: unknown
): value is "open_file" | "reveal_in_manager" =>
  value === "open_file" || value === "reveal_in_manager";
const isSearchResultsSourceFilter = (value: unknown): value is WorkbenchSearchResultsSourceFilter =>
  value === "all" || value === "web" || value === "local";
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
      readonly theme?: unknown;
      readonly uiPackId?: unknown;
      readonly uiStyleId?: unknown;
      readonly splitTriggerMode?: unknown;
      readonly splitThreePaneLayout?: unknown;
      readonly splitOverflowPolicy?: unknown;
      readonly aiRichRenderingEnabled?: unknown;
      readonly aiStopBehavior?: unknown;
      readonly preventSleepEnabled?: unknown;
      readonly forceWebPageThemingEnabled?: unknown;
      readonly searchWebEngineIds?: unknown;
      readonly searchSearxngEndpoint?: unknown;
      readonly deepSearchDefaultBudget?: unknown;
      readonly deepSearchRestoreViewport?: unknown;
      readonly deepSearchLocalOpenBehavior?: unknown;
      readonly deepSearchSiteExpansionEnabled?: unknown;
      readonly deepSearchProactiveDomainGuessingEnabled?: unknown;
      readonly deepSearchCrawlPolicy?: unknown;
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

    return {
      locale: isLocale(parsed.locale) ? parsed.locale : defaults.locale,
      theme: isTheme(parsed.theme) ? parsed.theme : defaults.theme,
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
      forceWebPageThemingEnabled: isBoolean(parsed.forceWebPageThemingEnabled)
        ? parsed.forceWebPageThemingEnabled
        : defaults.forceWebPageThemingEnabled,
      searchWebEngineIds: asStringArray(parsed.searchWebEngineIds),
      ...(normalizedSearxngEndpoint === undefined
        ? {}
        : { searchSearxngEndpoint: normalizedSearxngEndpoint }),
      deepSearchDefaultBudget: isSearchDeepBudgetPreset(parsed.deepSearchDefaultBudget)
        ? parsed.deepSearchDefaultBudget
        : defaults.deepSearchDefaultBudget,
      deepSearchRestoreViewport: isBoolean(parsed.deepSearchRestoreViewport)
        ? parsed.deepSearchRestoreViewport
        : defaults.deepSearchRestoreViewport,
      deepSearchLocalOpenBehavior: isDeepSearchLocalOpenBehavior(parsed.deepSearchLocalOpenBehavior)
        ? parsed.deepSearchLocalOpenBehavior
        : defaults.deepSearchLocalOpenBehavior,
      deepSearchSiteExpansionEnabled: isBoolean(parsed.deepSearchSiteExpansionEnabled)
        ? parsed.deepSearchSiteExpansionEnabled
        : defaults.deepSearchSiteExpansionEnabled,
      deepSearchProactiveDomainGuessingEnabled: isBoolean(parsed.deepSearchProactiveDomainGuessingEnabled)
        ? parsed.deepSearchProactiveDomainGuessingEnabled
        : defaults.deepSearchProactiveDomainGuessingEnabled,
      deepSearchCrawlPolicy: isSearchDeepCrawlPolicy(parsed.deepSearchCrawlPolicy)
        ? parsed.deepSearchCrawlPolicy
        : defaults.deepSearchCrawlPolicy,
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
    setForceWebPageThemingEnabled: (forceWebPageThemingEnabled) => {
      commit((current) => ({
        ...current,
        forceWebPageThemingEnabled
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
    setDeepSearchDefaultBudget: (deepSearchDefaultBudget) => {
      commit((current) => ({
        ...current,
        deepSearchDefaultBudget
      }));
    },
    setDeepSearchRestoreViewport: (deepSearchRestoreViewport) => {
      commit((current) => ({
        ...current,
        deepSearchRestoreViewport
      }));
    },
    setDeepSearchLocalOpenBehavior: (deepSearchLocalOpenBehavior) => {
      commit((current) => ({
        ...current,
        deepSearchLocalOpenBehavior
      }));
    },
    setDeepSearchSiteExpansionEnabled: (deepSearchSiteExpansionEnabled) => {
      commit((current) => ({
        ...current,
        deepSearchSiteExpansionEnabled
      }));
    },
    setDeepSearchProactiveDomainGuessingEnabled: (deepSearchProactiveDomainGuessingEnabled) => {
      commit((current) => ({
        ...current,
        deepSearchProactiveDomainGuessingEnabled
      }));
    },
    setDeepSearchCrawlPolicy: (deepSearchCrawlPolicy) => {
      commit((current) => ({
        ...current,
        deepSearchCrawlPolicy
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
