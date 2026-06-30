import type {
  LinuxCompatConfig,
  LinuxCompatProfile,
  LinuxCompatReadStatusResponse,
  LyraDesktopApi,
  SystemNotificationClickBehavior,
  SystemNotificationMode
} from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";
import type { GlobalDialogModel } from "../global-dialog";
import type {
  WorkbenchAiStopBehavior,
  WorkbenchOmniboxNonBrowserSubmitTarget,
  WorkbenchSplitOverflowPolicy,
  WorkbenchSplitThreePaneLayout,
  WorkbenchSplitTriggerMode
} from "../preferences";
import type { SettingsAiLabels, SettingsAiModel } from "../settings-ai";
import type { LoginManagerSurfaceProps } from "../login-manager";
import type { SoftwareStoreSurfaceProps } from "../software-store";
import type { WorkbenchThemeId } from "../theme";
import type { WorkbenchUiPackId } from "../ui-platform";

export type BrowserSettingsCategoryId =
  | "general"
  | "appearance"
  | "workspace"
  | "notifications"
  | "loginManager"
  | "softwareStore"
  | "linux"
  | "search"
  | "ai"
  | "models"
  | "legal";

export type BrowserSettingsCategoryFocusRequest = {
  readonly categoryId: BrowserSettingsCategoryId;
  readonly requestId: number;
};

export type SettingsOption<T extends string = string> = {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
};

export type BrowserSettingsSurfaceProps = {
  readonly title: string;
  readonly desktopApi: LyraDesktopApi | null;
  readonly focusCategoryRequest?: BrowserSettingsCategoryFocusRequest | null;
  readonly generalCategoryLabel: string;
  readonly appearanceCategoryLabel: string;
  readonly workspaceCategoryLabel: string;
  readonly aiCategoryLabel: string;
  readonly modelsCategoryLabel: string;
  readonly notificationsCategoryLabel: string;
  readonly loginManagerCategoryLabel: string;
  readonly softwareStoreCategoryLabel: string;
  readonly linuxCategoryLabel: string;
  readonly legalCategoryLabel: string;
  readonly docsNavLabel: string;
  readonly languageLabel: string;
  readonly themeLabel: string;
  readonly uiStyleLabel: string;
  readonly uiStyleExternalReloadRequired: string;
  readonly uiStyleExternalUntrusted: string;
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
  readonly searchCategoryLabel: string;
  readonly searchWebEnginesLabel: string;
  readonly searchSearxngEndpointLabel: string;
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
  readonly linuxCompatRestartLabel: string;
  readonly linuxCompatRestartDescription: string;
  readonly linuxCompatRestartNowLabel: string;
  readonly linuxCompatRestartDialogTitle: string;
  readonly linuxCompatRestartDialogDescription: string;
  readonly linuxCompatRestartDialogCancel: string;
  readonly linuxCompatRecoveryTitle: string;
  readonly linuxCompatRecoveryDescription: string;
  readonly linuxCompatRequestFailed: string;
  readonly legalNoticesLabel: string;
  readonly legalNoticesIntro: string;
  readonly legalLastUpdatedPrefix: string;
  readonly legalNoticesLoadingLabel: string;
  readonly legalNoticesEmptyLabel: string;
  readonly legalNoticesErrorLabel: string;
  readonly legalGeneratedAtLabel: string;
  readonly legalPackageCountLabel: string;
  readonly legalLicenseLabel: string;
  readonly legalSourceLabel: string;
  readonly legalRepositoryLabel: string;
  readonly legalHomepageLabel: string;
  readonly legalNoticeTextLabel: string;
  readonly legalLicenseTextLabel: string;
  readonly localeValue: WorkbenchLocale;
  readonly themeValue: WorkbenchThemeId;
  readonly uiStyleValue: WorkbenchUiPackId;
  readonly splitTriggerModeValue: WorkbenchSplitTriggerMode;
  readonly splitThreePaneLayoutValue: WorkbenchSplitThreePaneLayout;
  readonly splitOverflowPolicyValue: WorkbenchSplitOverflowPolicy;
  readonly aiRichRenderValue: boolean;
  readonly aiStopBehaviorValue: WorkbenchAiStopBehavior;
  readonly preventSleepValue: boolean;
  readonly jsReplValue: boolean;
  readonly searchWebEngineIds: readonly string[];
  readonly searchSearxngEndpointValue: string;
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
  readonly splitTriggerModeOptions: readonly SettingsOption<WorkbenchSplitTriggerMode>[];
  readonly splitThreePaneLayoutOptions: readonly SettingsOption<WorkbenchSplitThreePaneLayout>[];
  readonly splitOverflowPolicyOptions: readonly SettingsOption<WorkbenchSplitOverflowPolicy>[];
  readonly searchWebEngineOptions: readonly SettingsOption<string>[];
  readonly omniboxNonBrowserSubmitTargetOptions: readonly SettingsOption<WorkbenchOmniboxNonBrowserSubmitTarget>[];
  readonly systemNotificationModeOptions: readonly SettingsOption<SystemNotificationMode>[];
  readonly systemNotificationClickBehaviorOptions: readonly SettingsOption<SystemNotificationClickBehavior>[];
  readonly linuxCompatProfileOptions: readonly SettingsOption<LinuxCompatProfile>[];
  readonly aiLabels: SettingsAiLabels;
  readonly aiModel: SettingsAiModel;
  readonly openDialog: GlobalDialogModel["openDialog"];
  readonly loginManager: LoginManagerSurfaceProps;
  readonly softwareStore: SoftwareStoreSurfaceProps;
  readonly onLocaleChange: (value: WorkbenchLocale) => void;
  readonly onThemeChange: (value: WorkbenchThemeId) => void;
  readonly onUiStyleChange: (value: WorkbenchUiPackId) => void;
  readonly onSplitTriggerModeChange: (value: WorkbenchSplitTriggerMode) => void;
  readonly onSplitThreePaneLayoutChange: (value: WorkbenchSplitThreePaneLayout) => void;
  readonly onSplitOverflowPolicyChange: (value: WorkbenchSplitOverflowPolicy) => void;
  readonly onAiRichRenderChange: (value: boolean) => void;
  readonly onAiStopBehaviorChange: (value: WorkbenchAiStopBehavior) => void;
  readonly onPreventSleepChange: (value: boolean) => void;
  readonly onJsReplChange: (value: boolean) => void;
  readonly onSearchWebEnginesChange: (value: readonly string[]) => void;
  readonly onSearchSearxngEndpointChange: (value: string) => void;
  readonly onOmniboxNonBrowserSubmitTargetChange: (value: WorkbenchOmniboxNonBrowserSubmitTarget) => void;
  readonly onSystemNotificationModeChange: (value: SystemNotificationMode) => void;
  readonly onSystemNotificationClickBehaviorChange: (
    value: SystemNotificationClickBehavior
  ) => void;
  readonly onSystemNotificationActionsChange: (value: boolean) => void;
  readonly onLinuxCompatProfileChange: (value: LinuxCompatProfile) => void;
  readonly onLinuxCompatRestart: () => void;
  readonly onOpenDocs: () => void;
};
