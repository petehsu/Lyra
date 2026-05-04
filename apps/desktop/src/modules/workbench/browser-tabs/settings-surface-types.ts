import type {
  LinuxCompatConfig,
  LinuxCompatProfile,
  LinuxCompatReadStatusResponse,
  SearchDeepBudgetPreset,
  SearchDeepCrawlPolicy,
  SearchLocalScopePreset,
  SystemNotificationClickBehavior,
  SystemNotificationMode
} from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";
import type {
  WorkbenchAiStopBehavior,
  WorkbenchOmniboxNonBrowserSubmitTarget,
  WorkbenchSplitOverflowPolicy,
  WorkbenchSplitThreePaneLayout,
  WorkbenchSplitTriggerMode
} from "../preferences";
import type { SettingsAiLabels, SettingsAiModel } from "../settings-ai";
import type { TerminalThemeMode } from "../terminal-theme";
import type { WorkbenchThemeId } from "../theme";
import type { WorkbenchUiPackId } from "../ui-platform";

export type SettingsOption<T extends string = string> = {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
};

export type BrowserSettingsSurfaceProps = {
  readonly title: string;
  readonly aiCategoryLabel: string;
  readonly notificationsCategoryLabel: string;
  readonly linuxCategoryLabel: string;
  readonly languageLabel: string;
  readonly themeLabel: string;
  readonly uiStyleLabel: string;
  readonly uiStyleExternalReloadRequired: string;
  readonly uiStyleExternalUntrusted: string;
  readonly terminalThemeLabel: string;
  readonly splitTriggerModeLabel: string;
  readonly splitThreePaneLayoutLabel: string;
  readonly splitOverflowPolicyLabel: string;
  readonly aiRichRenderLabel: string;
  readonly aiRichRenderDescription: string;
  readonly aiRichRenderEnabledLabel: string;
  readonly aiRichRenderDisabledLabel: string;
  readonly aiStopBehaviorLabel: string;
  readonly aiStopBehaviorDescription: string;
  readonly aiStopBehaviorTurnOnlyLabel: string;
  readonly aiStopBehaviorTurnOnlyDescription: string;
  readonly aiStopBehaviorTurnAndBackgroundLabel: string;
  readonly aiStopBehaviorTurnAndBackgroundDescription: string;
  readonly preventSleepLabel: string;
  readonly preventSleepDescription: string;
  readonly preventSleepEnabledLabel: string;
  readonly preventSleepDisabledLabel: string;
  readonly jsReplLabel: string;
  readonly jsReplDescription: string;
  readonly jsReplEnabledLabel: string;
  readonly jsReplDisabledLabel: string;
  readonly forceWebPageThemingLabel: string;
  readonly forceWebPageThemingDescription: string;
  readonly forceWebPageThemingEnabledLabel: string;
  readonly forceWebPageThemingDisabledLabel: string;
  readonly searchCategoryLabel: string;
  readonly searchScopeLabel: string;
  readonly searchCustomRootsLabel: string;
  readonly searchCustomRootsPlaceholder: string;
  readonly searchWebEnginesLabel: string;
  readonly searchSearxngEndpointLabel: string;
  readonly searchDeepBudgetLabel: string;
  readonly deepSearchRestoreViewportLabel: string;
  readonly deepSearchLocalOpenBehaviorLabel: string;
  readonly deepSearchSiteExpansionLabel: string;
  readonly deepSearchProactiveGuessLabel: string;
  readonly deepSearchCrawlPolicyLabel: string;
  readonly searchEnableFuzzyLabel: string;
  readonly searchEnableContentLabel: string;
  readonly searchIncludeHiddenLabel: string;
  readonly searchAutoIndexLabel: string;
  readonly searchIndexStatusLabel: string;
  readonly searchRebuildIndexLabel: string;
  readonly omniboxNonBrowserSubmitTargetLabel: string;
  readonly systemNotificationModeLabel: string;
  readonly systemNotificationModeOffLabel: string;
  readonly systemNotificationModeBackgroundLabel: string;
  readonly systemNotificationModeAllLabel: string;
  readonly systemNotificationClickBehaviorLabel: string;
  readonly systemNotificationClickOpenCenterLabel: string;
  readonly systemNotificationClickOpenSourceLabel: string;
  readonly systemNotificationActionsLabel: string;
  readonly systemNotificationActionsDescription: string;
  readonly systemNotificationActionsEnabled: string;
  readonly systemNotificationActionsDisabled: string;
  readonly linuxCompatProfileLabel: string;
  readonly linuxCompatProfileDescription: string;
  readonly linuxCompatProfileReliableLabel: string;
  readonly linuxCompatProfileReliableDescription: string;
  readonly linuxCompatProfileNativeLabel: string;
  readonly linuxCompatProfileNativeDescription: string;
  readonly linuxCompatProfilePerformanceLabel: string;
  readonly linuxCompatProfilePerformanceDescription: string;
  readonly linuxCompatStatusLabel: string;
  readonly linuxCompatCurrentStatusLabel: string;
  readonly linuxCompatSystemLabel: string;
  readonly linuxCompatDesktopLabel: string;
  readonly linuxCompatGpuLabel: string;
  readonly linuxCompatSwitchesLabel: string;
  readonly linuxCompatWarningsLabel: string;
  readonly linuxCompatExportDiagnosticsLabel: string;
  readonly linuxCompatRestartLabel: string;
  readonly linuxCompatRestartDescription: string;
  readonly linuxCompatRestartNowLabel: string;
  readonly linuxCompatRestartDialogTitle: string;
  readonly linuxCompatRestartDialogDescription: string;
  readonly linuxCompatRestartDialogCancel: string;
  readonly linuxCompatRecoveryTitle: string;
  readonly linuxCompatRecoveryDescription: string;
  readonly linuxCompatDiagnosticsExported: string;
  readonly linuxCompatDiagnosticsFailed: string;
  readonly localeValue: WorkbenchLocale;
  readonly themeValue: WorkbenchThemeId;
  readonly uiStyleValue: WorkbenchUiPackId;
  readonly terminalThemeValue: TerminalThemeMode;
  readonly splitTriggerModeValue: WorkbenchSplitTriggerMode;
  readonly splitThreePaneLayoutValue: WorkbenchSplitThreePaneLayout;
  readonly splitOverflowPolicyValue: WorkbenchSplitOverflowPolicy;
  readonly aiRichRenderValue: boolean;
  readonly aiStopBehaviorValue: WorkbenchAiStopBehavior;
  readonly preventSleepValue: boolean;
  readonly jsReplValue: boolean;
  readonly forceWebPageThemingValue: boolean;
  readonly searchScopeValue: SearchLocalScopePreset;
  readonly searchCustomRootsValue: string;
  readonly searchWebEngineIds: readonly string[];
  readonly searchSearxngEndpointValue: string;
  readonly searchDeepBudgetValue: SearchDeepBudgetPreset;
  readonly deepSearchRestoreViewportValue: boolean;
  readonly deepSearchLocalOpenBehaviorValue: "open_file" | "reveal_in_manager";
  readonly deepSearchSiteExpansionValue: boolean;
  readonly deepSearchProactiveGuessValue: boolean;
  readonly deepSearchCrawlPolicyValue: SearchDeepCrawlPolicy;
  readonly searchEnableFuzzyValue: boolean;
  readonly searchEnableContentValue: boolean;
  readonly searchIncludeHiddenValue: boolean;
  readonly searchAutoIndexValue: boolean;
  readonly searchIndexStatusValue: string;
  readonly searchRebuildIndexPending: boolean;
  readonly omniboxNonBrowserSubmitTargetValue: WorkbenchOmniboxNonBrowserSubmitTarget;
  readonly systemNotificationModeValue: SystemNotificationMode;
  readonly systemNotificationClickBehaviorValue: SystemNotificationClickBehavior;
  readonly systemNotificationActionsValue: boolean;
  readonly linuxCompatVisible: boolean;
  readonly linuxCompatStatus: LinuxCompatReadStatusResponse | null;
  readonly linuxCompatConfig: LinuxCompatConfig | null;
  readonly linuxCompatProfileValue: LinuxCompatProfile;
  readonly localeOptions: readonly SettingsOption<WorkbenchLocale>[];
  readonly themeOptions: readonly SettingsOption<WorkbenchThemeId>[];
  readonly uiStyleOptions: readonly SettingsOption<WorkbenchUiPackId>[];
  readonly terminalThemeOptions: readonly SettingsOption<TerminalThemeMode>[];
  readonly splitTriggerModeOptions: readonly SettingsOption<WorkbenchSplitTriggerMode>[];
  readonly splitThreePaneLayoutOptions: readonly SettingsOption<WorkbenchSplitThreePaneLayout>[];
  readonly splitOverflowPolicyOptions: readonly SettingsOption<WorkbenchSplitOverflowPolicy>[];
  readonly searchScopeOptions: readonly SettingsOption<SearchLocalScopePreset>[];
  readonly searchDeepBudgetOptions: readonly SettingsOption<SearchDeepBudgetPreset>[];
  readonly deepSearchLocalOpenBehaviorOptions: readonly SettingsOption<"open_file" | "reveal_in_manager">[];
  readonly deepSearchCrawlPolicyOptions: readonly SettingsOption<SearchDeepCrawlPolicy>[];
  readonly searchWebEngineOptions: readonly SettingsOption<string>[];
  readonly omniboxNonBrowserSubmitTargetOptions: readonly SettingsOption<WorkbenchOmniboxNonBrowserSubmitTarget>[];
  readonly systemNotificationModeOptions: readonly SettingsOption<SystemNotificationMode>[];
  readonly systemNotificationClickBehaviorOptions: readonly SettingsOption<SystemNotificationClickBehavior>[];
  readonly linuxCompatProfileOptions: readonly SettingsOption<LinuxCompatProfile>[];
  readonly aiLabels: SettingsAiLabels;
  readonly aiModel: SettingsAiModel;
  readonly onLocaleChange: (value: WorkbenchLocale) => void;
  readonly onThemeChange: (value: WorkbenchThemeId) => void;
  readonly onUiStyleChange: (value: WorkbenchUiPackId) => void;
  readonly onTerminalThemeChange: (value: TerminalThemeMode) => void;
  readonly onSplitTriggerModeChange: (value: WorkbenchSplitTriggerMode) => void;
  readonly onSplitThreePaneLayoutChange: (value: WorkbenchSplitThreePaneLayout) => void;
  readonly onSplitOverflowPolicyChange: (value: WorkbenchSplitOverflowPolicy) => void;
  readonly onAiRichRenderChange: (value: boolean) => void;
  readonly onAiStopBehaviorChange: (value: WorkbenchAiStopBehavior) => void;
  readonly onPreventSleepChange: (value: boolean) => void;
  readonly onJsReplChange: (value: boolean) => void;
  readonly onForceWebPageThemingChange: (value: boolean) => void;
  readonly onSearchScopeChange: (value: SearchLocalScopePreset) => void;
  readonly onSearchCustomRootsChange: (value: string) => void;
  readonly onSearchWebEnginesChange: (value: readonly string[]) => void;
  readonly onSearchSearxngEndpointChange: (value: string) => void;
  readonly onSearchDeepBudgetChange: (value: SearchDeepBudgetPreset) => void;
  readonly onDeepSearchRestoreViewportChange: (value: boolean) => void;
  readonly onDeepSearchLocalOpenBehaviorChange: (value: "open_file" | "reveal_in_manager") => void;
  readonly onDeepSearchSiteExpansionChange: (value: boolean) => void;
  readonly onDeepSearchProactiveGuessChange: (value: boolean) => void;
  readonly onDeepSearchCrawlPolicyChange: (value: SearchDeepCrawlPolicy) => void;
  readonly onSearchEnableFuzzyChange: (value: boolean) => void;
  readonly onSearchEnableContentChange: (value: boolean) => void;
  readonly onSearchIncludeHiddenChange: (value: boolean) => void;
  readonly onSearchAutoIndexChange: (value: boolean) => void;
  readonly onSearchRebuildIndex: () => void;
  readonly onOmniboxNonBrowserSubmitTargetChange: (value: WorkbenchOmniboxNonBrowserSubmitTarget) => void;
  readonly onSystemNotificationModeChange: (value: SystemNotificationMode) => void;
  readonly onSystemNotificationClickBehaviorChange: (
    value: SystemNotificationClickBehavior
  ) => void;
  readonly onSystemNotificationActionsChange: (value: boolean) => void;
  readonly onLinuxCompatProfileChange: (value: LinuxCompatProfile) => void;
  readonly onLinuxCompatExportDiagnostics: () => void;
  readonly onLinuxCompatRestart: () => void;
};
