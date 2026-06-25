import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchThemeId } from "../theme";
import type { WorkbenchUiPackId } from "../ui-platform";
import type {
  SystemNotificationClickBehavior,
  SystemNotificationMode
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
export type WorkbenchAiStopBehavior = "turn_only" | "turn_and_background";

export type WorkbenchPreferences = {
  readonly locale: WorkbenchLocale;
  readonly theme: WorkbenchThemeId;
  readonly uiPackId: WorkbenchUiPackId;
  readonly splitTriggerMode: WorkbenchSplitTriggerMode;
  readonly splitThreePaneLayout: WorkbenchSplitThreePaneLayout;
  readonly splitOverflowPolicy: WorkbenchSplitOverflowPolicy;
  readonly aiRichRenderingEnabled: boolean;
  readonly aiStopBehavior: WorkbenchAiStopBehavior;
  readonly preventSleepEnabled: boolean;
  readonly searchWebEngineIds: readonly string[];
  readonly searchSearxngEndpoint?: string;
  readonly searchResultsSourceFilter: WorkbenchSearchResultsSourceFilter;
  readonly omniboxNonBrowserSubmitTarget: WorkbenchOmniboxNonBrowserSubmitTarget;
  readonly systemNotificationMode: SystemNotificationMode;
  readonly systemNotificationClickBehavior: SystemNotificationClickBehavior;
  readonly systemNotificationActionsEnabled: boolean;
};

export type WorkbenchPreferencesModel = {
  readonly preferences: WorkbenchPreferences;
  readonly setLocale: (locale: WorkbenchLocale) => void;
  readonly setTheme: (theme: WorkbenchThemeId) => void;
  readonly setUiPackId: (packId: WorkbenchUiPackId) => void;
  readonly setSplitTriggerMode: (mode: WorkbenchSplitTriggerMode) => void;
  readonly setSplitThreePaneLayout: (layout: WorkbenchSplitThreePaneLayout) => void;
  readonly setSplitOverflowPolicy: (policy: WorkbenchSplitOverflowPolicy) => void;
  readonly setAiRichRenderingEnabled: (enabled: boolean) => void;
  readonly setAiStopBehavior: (value: WorkbenchAiStopBehavior) => void;
  readonly setPreventSleepEnabled: (enabled: boolean) => void;
  readonly setSearchWebEngineIds: (value: readonly string[]) => void;
  readonly setSearchSearxngEndpoint: (value?: string) => void;
  readonly setSearchResultsSourceFilter: (value: WorkbenchSearchResultsSourceFilter) => void;
  readonly setOmniboxNonBrowserSubmitTarget: (
    value: WorkbenchOmniboxNonBrowserSubmitTarget
  ) => void;
  readonly setSystemNotificationMode: (value: SystemNotificationMode) => void;
  readonly setSystemNotificationClickBehavior: (
    value: SystemNotificationClickBehavior
  ) => void;
  readonly setSystemNotificationActionsEnabled: (value: boolean) => void;
  readonly reset: () => void;
};
