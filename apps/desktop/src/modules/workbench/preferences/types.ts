import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchThemeId } from "../theme";
import type { TerminalThemeMode } from "../terminal-theme";
import type { WorkbenchUiPackId } from "../ui-platform";
import type {
  SearchDeepCrawlPolicy,
  SearchDeepBudgetPreset,
  SearchLocalScopePreset
} from "../../../shared/desktop-bridge";

export type WorkbenchSplitTriggerMode = "ctrl_left_drag" | "right_drag";

export type WorkbenchSplitThreePaneLayout =
  | "top_two_bottom_one"
  | "top_one_bottom_two"
  | "left_two_right_one"
  | "left_one_right_two"
  | "adaptive";

export type WorkbenchSplitOverflowPolicy =
  | "block_with_notice"
  | "replace_oldest"
  | "replace_target";

export type WorkbenchSearchResultsSourceFilter = "all" | "web" | "local";
export type WorkbenchOmniboxNonBrowserSubmitTarget = "new_tab" | "replace_active_tab";
export type WorkbenchBrowserAutomationEngine = "lyra_direct" | "browser_use" | "smart";
export type WorkbenchLyraDirectMicroExecutorBudget = "1-2" | "3-5" | "6-8";
export type WorkbenchAiStopBehavior = "turn_only" | "turn_and_background";

export type WorkbenchPreferences = {
  readonly locale: WorkbenchLocale;
  readonly theme: WorkbenchThemeId;
  readonly uiPackId: WorkbenchUiPackId;
  readonly terminalThemePreset: TerminalThemeMode;
  readonly splitTriggerMode: WorkbenchSplitTriggerMode;
  readonly splitThreePaneLayout: WorkbenchSplitThreePaneLayout;
  readonly splitOverflowPolicy: WorkbenchSplitOverflowPolicy;
  readonly aiRichRenderingEnabled: boolean;
  readonly aiStopBehavior: WorkbenchAiStopBehavior;
  readonly preventSleepEnabled: boolean;
  readonly forceWebPageThemingEnabled: boolean;
  readonly searchScopePreset: SearchLocalScopePreset;
  readonly searchCustomRoots: readonly string[];
  readonly searchEnableFuzzy: boolean;
  readonly searchEnableContent: boolean;
  readonly searchIncludeHidden: boolean;
  readonly searchWebEngineIds: readonly string[];
  readonly searchSearxngEndpoint?: string;
  readonly searchAutoIndexEnabled: boolean;
  readonly deepSearchDefaultBudget: SearchDeepBudgetPreset;
  readonly deepSearchRestoreViewport: boolean;
  readonly deepSearchLocalOpenBehavior: "open_file" | "reveal_in_manager";
  readonly deepSearchSiteExpansionEnabled: boolean;
  readonly deepSearchProactiveDomainGuessingEnabled: boolean;
  readonly deepSearchCrawlPolicy: SearchDeepCrawlPolicy;
  readonly searchResultsSourceFilter: WorkbenchSearchResultsSourceFilter;
  readonly omniboxNonBrowserSubmitTarget: WorkbenchOmniboxNonBrowserSubmitTarget;
  readonly browserAutomationEngine: WorkbenchBrowserAutomationEngine;
  readonly lyraDirectMicroExecutorBudget: WorkbenchLyraDirectMicroExecutorBudget;
};

export type WorkbenchPreferencesModel = {
  readonly preferences: WorkbenchPreferences;
  readonly setLocale: (locale: WorkbenchLocale) => void;
  readonly setTheme: (theme: WorkbenchThemeId) => void;
  readonly setUiPackId: (packId: WorkbenchUiPackId) => void;
  readonly setTerminalThemePreset: (preset: TerminalThemeMode) => void;
  readonly setSplitTriggerMode: (mode: WorkbenchSplitTriggerMode) => void;
  readonly setSplitThreePaneLayout: (layout: WorkbenchSplitThreePaneLayout) => void;
  readonly setSplitOverflowPolicy: (policy: WorkbenchSplitOverflowPolicy) => void;
  readonly setAiRichRenderingEnabled: (enabled: boolean) => void;
  readonly setAiStopBehavior: (value: WorkbenchAiStopBehavior) => void;
  readonly setPreventSleepEnabled: (enabled: boolean) => void;
  readonly setForceWebPageThemingEnabled: (enabled: boolean) => void;
  readonly setSearchScopePreset: (value: SearchLocalScopePreset) => void;
  readonly setSearchCustomRoots: (value: readonly string[]) => void;
  readonly setSearchEnableFuzzy: (value: boolean) => void;
  readonly setSearchEnableContent: (value: boolean) => void;
  readonly setSearchIncludeHidden: (value: boolean) => void;
  readonly setSearchWebEngineIds: (value: readonly string[]) => void;
  readonly setSearchSearxngEndpoint: (value?: string) => void;
  readonly setSearchAutoIndexEnabled: (value: boolean) => void;
  readonly setDeepSearchDefaultBudget: (value: SearchDeepBudgetPreset) => void;
  readonly setDeepSearchRestoreViewport: (value: boolean) => void;
  readonly setDeepSearchLocalOpenBehavior: (value: "open_file" | "reveal_in_manager") => void;
  readonly setDeepSearchSiteExpansionEnabled: (value: boolean) => void;
  readonly setDeepSearchProactiveDomainGuessingEnabled: (value: boolean) => void;
  readonly setDeepSearchCrawlPolicy: (value: SearchDeepCrawlPolicy) => void;
  readonly setSearchResultsSourceFilter: (value: WorkbenchSearchResultsSourceFilter) => void;
  readonly setOmniboxNonBrowserSubmitTarget: (
    value: WorkbenchOmniboxNonBrowserSubmitTarget
  ) => void;
  readonly setBrowserAutomationEngine: (
    value: WorkbenchBrowserAutomationEngine
  ) => void;
  readonly setLyraDirectMicroExecutorBudget: (
    value: WorkbenchLyraDirectMicroExecutorBudget
  ) => void;
  readonly reset: () => void;
};
