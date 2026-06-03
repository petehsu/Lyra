import { WORKBENCH_CONFIG } from "../config";
import type { I18nKey } from "../i18n";
import type { WorkbenchPreferences } from "../preferences";
import type { WorkspaceTabsConfig } from "../workspace-tabs";

type WorkbenchTranslator = (key: I18nKey) => string;

export const createInitialWorkbenchPreferences = (): WorkbenchPreferences => ({
  locale: WORKBENCH_CONFIG.locale,
  theme: WORKBENCH_CONFIG.theme,
  uiPackId: WORKBENCH_CONFIG.uiPackId,
  splitTriggerMode: "ctrl_left_drag",
  splitThreePaneLayout: "adaptive",
  splitOverflowPolicy: "block_with_notice",
  aiRichRenderingEnabled: true,
  aiStopBehavior: "turn_only",
  preventSleepEnabled: true,
  forceWebPageThemingEnabled: true,
  searchScopePreset: "home",
  searchCustomRoots: [],
  searchEnableFuzzy: true,
  searchEnableContent: true,
  searchIncludeHidden: false,
  searchWebEngineIds: WORKBENCH_CONFIG.browser.searchEngines.map((engine) => engine.id),
  searchAutoIndexEnabled: true,
  deepSearchDefaultBudget: "medium",
  deepSearchRestoreViewport: false,
  deepSearchLocalOpenBehavior: "open_file",
  deepSearchSiteExpansionEnabled: true,
  deepSearchProactiveDomainGuessingEnabled: true,
  deepSearchCrawlPolicy: "accessibility_only",
  searchResultsSourceFilter: "all",
  omniboxNonBrowserSubmitTarget: "new_tab",
  systemNotificationMode: "background",
  systemNotificationClickBehavior: "open_center",
  systemNotificationActionsEnabled: true
});

export const createWorkbenchBrowserTabsConfig = (
  t: WorkbenchTranslator
): WorkspaceTabsConfig => ({
  homeTabTitle: t("browser.homeTabTitle"),
  settingsTabTitle: t("settings.tabTitle"),
  homeSearchAddress: WORKBENCH_CONFIG.browser.homeSearchAddress,
  maxSearchTitleLength: WORKBENCH_CONFIG.browser.maxSearchTitleLength
});
