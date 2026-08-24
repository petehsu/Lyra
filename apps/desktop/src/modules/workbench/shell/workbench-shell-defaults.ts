import { WORKBENCH_CONFIG } from "../config";
import type { I18nKey } from "../i18n";
import type { WorkbenchPreferences } from "../preferences";
import type { WorkspaceTabsConfig } from "../workspace-tabs";

type WorkbenchTranslator = (key: I18nKey) => string;

export const createInitialWorkbenchPreferences = (): WorkbenchPreferences => ({
  locale: WORKBENCH_CONFIG.locale,
  localePreference: { mode: "system" },
  theme: WORKBENCH_CONFIG.theme,
  windowMaterialEnabled: true,
  uiPackId: WORKBENCH_CONFIG.uiPackId,
  splitTriggerMode: "ctrl_left_drag",
  splitThreePaneLayout: "adaptive",
  splitOverflowPolicy: "block_with_notice",
  aiRichRenderingEnabled: true,
  aiStopBehavior: "turn_only",
  preventSleepEnabled: true,
  editorGpuAcceleration: "off",
  searchEngineMode: "dynamic",
  searchWebEngineIds: ["bing"],
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
