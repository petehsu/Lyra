import { useState } from "react";

import { WORKBENCH_LOCALES, type WorkbenchLocale } from "../i18n";
import type {
  SearchDeepCrawlPolicy,
  SearchDeepBudgetPreset,
  SearchLocalScopePreset
} from "../../../shared/desktop-bridge";
import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import { isWorkbenchThemeId } from "../theme";
import type { WorkbenchThemeId } from "../theme";
import { isWorkbenchTerminalThemePresetId } from "../terminal-theme";
import type { TerminalThemePresetId } from "../terminal-theme";
import type {
  WorkbenchBrowserAutomationEngine,
  WorkbenchLyraDirectMicroExecutorBudget,
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
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isSearchScopePreset = (value: unknown): value is SearchLocalScopePreset =>
  value === "home" || value === "full_system" || value === "workspace" || value === "custom";
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
const isWorkbenchBrowserAutomationEngine = (
  value: unknown
): value is WorkbenchBrowserAutomationEngine =>
  value === "lyra_direct" || value === "browser_use" || value === "smart";
const isWorkbenchLyraDirectMicroExecutorBudget = (
  value: unknown
): value is WorkbenchLyraDirectMicroExecutorBudget =>
  value === "1-2" || value === "3-5" || value === "6-8";
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
      readonly terminalThemePreset?: unknown;
      readonly splitTriggerMode?: unknown;
      readonly splitThreePaneLayout?: unknown;
      readonly splitOverflowPolicy?: unknown;
      readonly aiRichRenderingEnabled?: unknown;
      readonly searchScopePreset?: unknown;
      readonly searchCustomRoots?: unknown;
      readonly searchEnableFuzzy?: unknown;
      readonly searchEnableContent?: unknown;
      readonly searchIncludeHidden?: unknown;
      readonly searchWebEngineIds?: unknown;
      readonly searchSearxngEndpoint?: unknown;
      readonly searchAutoIndexEnabled?: unknown;
      readonly deepSearchDefaultBudget?: unknown;
      readonly deepSearchRestoreViewport?: unknown;
      readonly deepSearchLocalOpenBehavior?: unknown;
      readonly deepSearchSiteExpansionEnabled?: unknown;
      readonly deepSearchProactiveDomainGuessingEnabled?: unknown;
      readonly deepSearchCrawlPolicy?: unknown;
      readonly searchResultsSourceFilter?: unknown;
      readonly omniboxNonBrowserSubmitTarget?: unknown;
      readonly browserAutomationEngine?: unknown;
      readonly lyraDirectMicroExecutorBudget?: unknown;
    };

    const normalizedSearxngEndpoint =
      typeof parsed.searchSearxngEndpoint === "string"
        ? parsed.searchSearxngEndpoint.trim()
        : defaults.searchSearxngEndpoint;

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
        : defaults.splitOverflowPolicy,
      aiRichRenderingEnabled: isBoolean(parsed.aiRichRenderingEnabled)
        ? parsed.aiRichRenderingEnabled
        : defaults.aiRichRenderingEnabled,
      searchScopePreset: isSearchScopePreset(parsed.searchScopePreset)
        ? parsed.searchScopePreset
        : defaults.searchScopePreset,
      searchCustomRoots: asStringArray(parsed.searchCustomRoots),
      searchEnableFuzzy: isBoolean(parsed.searchEnableFuzzy)
        ? parsed.searchEnableFuzzy
        : defaults.searchEnableFuzzy,
      searchEnableContent: isBoolean(parsed.searchEnableContent)
        ? parsed.searchEnableContent
        : defaults.searchEnableContent,
      searchIncludeHidden: isBoolean(parsed.searchIncludeHidden)
        ? parsed.searchIncludeHidden
        : defaults.searchIncludeHidden,
      searchWebEngineIds: asStringArray(parsed.searchWebEngineIds),
      ...(normalizedSearxngEndpoint === undefined
        ? {}
        : { searchSearxngEndpoint: normalizedSearxngEndpoint }),
      searchAutoIndexEnabled: isBoolean(parsed.searchAutoIndexEnabled)
        ? parsed.searchAutoIndexEnabled
        : defaults.searchAutoIndexEnabled,
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
      browserAutomationEngine: isWorkbenchBrowserAutomationEngine(parsed.browserAutomationEngine)
        ? parsed.browserAutomationEngine
        : defaults.browserAutomationEngine,
      lyraDirectMicroExecutorBudget: isWorkbenchLyraDirectMicroExecutorBudget(parsed.lyraDirectMicroExecutorBudget)
        ? parsed.lyraDirectMicroExecutorBudget
        : defaults.lyraDirectMicroExecutorBudget
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
    setAiRichRenderingEnabled: (aiRichRenderingEnabled) => {
      commit((current) => ({
        ...current,
        aiRichRenderingEnabled
      }));
    },
    setSearchScopePreset: (searchScopePreset) => {
      commit((current) => ({
        ...current,
        searchScopePreset
      }));
    },
    setSearchCustomRoots: (searchCustomRoots) => {
      commit((current) => ({
        ...current,
        searchCustomRoots: searchCustomRoots
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      }));
    },
    setSearchEnableFuzzy: (searchEnableFuzzy) => {
      commit((current) => ({
        ...current,
        searchEnableFuzzy
      }));
    },
    setSearchEnableContent: (searchEnableContent) => {
      commit((current) => ({
        ...current,
        searchEnableContent
      }));
    },
    setSearchIncludeHidden: (searchIncludeHidden) => {
      commit((current) => ({
        ...current,
        searchIncludeHidden
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
    setSearchAutoIndexEnabled: (searchAutoIndexEnabled) => {
      commit((current) => ({
        ...current,
        searchAutoIndexEnabled
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
    setBrowserAutomationEngine: (browserAutomationEngine) => {
      commit((current) => ({
        ...current,
        browserAutomationEngine
      }));
    },
    setLyraDirectMicroExecutorBudget: (lyraDirectMicroExecutorBudget) => {
      commit((current) => ({
        ...current,
        lyraDirectMicroExecutorBudget
      }));
    },
    reset: () => {
      commit(() => defaults);
    }
  };
};
