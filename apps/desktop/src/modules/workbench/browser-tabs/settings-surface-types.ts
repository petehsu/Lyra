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
  WorkbenchSearchEngineMode,
  WorkbenchSplitOverflowPolicy,
  WorkbenchSplitThreePaneLayout,
  WorkbenchSplitTriggerMode
} from "../preferences";
import type { SettingsAiLabels, SettingsAiModel } from "../settings-ai";
import type { LoginManagerSurfaceProps } from "../login-manager";
import type { SoftwareStoreSurfaceProps } from "../software-store";
import type { SettingsImportLabels } from "../settings-import";
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
  | "skills"
  | "mcp"
  | "importSettings"
  | "experimental";

export type BrowserSettingsCategoryFocusRequest = {
  readonly categoryId: BrowserSettingsCategoryId;
  readonly requestId: number;
};

export type SettingsOption<T extends string = string> = {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
};

export type LanguagePickerLabels = {
  readonly searchPlaceholder: string;
  readonly installing: string;
  readonly removing: string;
  readonly download: string;
  readonly remove: string;
  readonly noResults: string;
};

export type SettingsAccount = {
  readonly kind: "local" | "signed-in";
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly email?: string | null;
  readonly actionLabel: string;
  readonly actionPending: boolean;
  readonly onAction: () => void;
  readonly onUpdateProfile?: (update: {
    readonly displayName: string;
    readonly avatarUrl: string;
  }) => Promise<void>;
  readonly deleteAction?: {
    readonly label: string;
    readonly pending: boolean;
    readonly onSelect: () => void;
  };
};

export type SettingsAccountLabels = {
  readonly title: string;
  readonly cloudAccount: string;
  readonly localAccount: string;
  readonly deviceScope: string;
  readonly edit: string;
  readonly displayName: string;
  readonly avatarUrl: string;
  readonly avatarUrlPlaceholder: string;
  readonly avatarUrlDescription: string;
  readonly save: string;
  readonly cancel: string;
  readonly invalidName: string;
  readonly invalidAvatarUrl: string;
  readonly profileUpdateFailed: string;
  readonly reportedTokens: string;
  readonly peakDailyTokens: string;
  readonly longestTask: string;
  readonly currentStreak: string;
  readonly longestStreak: string;
  readonly tokenActivity: string;
  readonly lastTwelveMonths: string;
  readonly daily: string;
  readonly weekly: string;
  readonly cumulative: string;
  readonly activityOverview: string;
  readonly sessions: string;
  readonly messages: string;
  readonly turns: string;
  readonly activeDays: string;
  readonly tokenCoverage: string;
  readonly coverageDetail: string;
  readonly incompleteCoverageDetail: string;
  readonly topModels: string;
  readonly successfulCalls: string;
  readonly noModelActivity: string;
  readonly noActivity: string;
  readonly usageUnavailable: string;
  readonly retry: string;
  readonly loading: string;
  readonly dangerZone: string;
  readonly deleteDescription: string;
  readonly dayUnit: string;
  readonly secondUnit: string;
  readonly minuteUnit: string;
  readonly hourUnit: string;
};

export type BrowserSettingsSurfaceProps = {
  readonly title: string;
  readonly desktopApi: LyraDesktopApi | null;
  readonly account: SettingsAccount | null;
  readonly accountLabels: SettingsAccountLabels;
  readonly focusCategoryRequest?: BrowserSettingsCategoryFocusRequest | null;
  readonly generalCategoryLabel: string;
  readonly appearanceCategoryLabel: string;
  readonly workspaceCategoryLabel: string;
  readonly aiCategoryLabel: string;
  readonly modelsCategoryLabel: string;
  readonly skillsCategoryLabel: string;
  readonly mcpCategoryLabel: string;
  readonly importSettingsCategoryLabel: string;
  readonly importSettingsLabels: SettingsImportLabels;
  readonly notificationsCategoryLabel: string;
  readonly loginManagerCategoryLabel: string;
  readonly softwareStoreCategoryLabel: string;
  readonly linuxCategoryLabel: string;
  readonly experimentalCategoryLabel: string;
  readonly docsNavLabel: string;
  readonly languageLabel: string;
  readonly languagePickerLabels: LanguagePickerLabels;
  readonly themeLabel: string;
  readonly windowMaterialLabel: string;
  readonly windowMaterialDescription: string;
  readonly windowMaterialEnabledLabel: string;
  readonly windowMaterialDisabledLabel: string;
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
  readonly personaSignalsLabel: string;
  readonly personaSignalsDescription: string;
  readonly personaSignalsEnabledLabel: string;
  readonly personaSignalsDisabledLabel: string;
  readonly preventSleepLabel: string;
  readonly preventSleepDescription: string;
  readonly preventSleepEnabledLabel: string;
  readonly preventSleepDisabledLabel: string;
  readonly jsReplLabel: string;
  readonly jsReplDescription: string;
  readonly jsReplEnabledLabel: string;
  readonly jsReplDisabledLabel: string;
  readonly actCacheLabel: string;
  readonly actCacheDescription: string;
  readonly actCacheEnabledLabel: string;
  readonly actCacheDisabledLabel: string;
  readonly leanPromptDeliveryLabel: string;
  readonly leanPromptDeliveryDescription: string;
  readonly leanPromptDeliveryEnabledLabel: string;
  readonly leanPromptDeliveryDisabledLabel: string;
  readonly statefulPromptContractLabel: string;
  readonly statefulPromptContractDescription: string;
  readonly statefulPromptContractEnabledLabel: string;
  readonly statefulPromptContractDisabledLabel: string;
  readonly searchCategoryLabel: string;
  readonly searchEngineModeLabel: string;
  readonly searchWebEnginesLabel: string;
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
  readonly localeValue: WorkbenchLocale;
  readonly themeValue: WorkbenchThemeId;
  readonly windowMaterialValue: boolean;
  readonly uiStyleValue: WorkbenchUiPackId;
  readonly splitTriggerModeValue: WorkbenchSplitTriggerMode;
  readonly splitThreePaneLayoutValue: WorkbenchSplitThreePaneLayout;
  readonly splitOverflowPolicyValue: WorkbenchSplitOverflowPolicy;
  readonly aiRichRenderValue: boolean;
  readonly aiStopBehaviorValue: WorkbenchAiStopBehavior;
  readonly personaSignalsValue: boolean;
  readonly preventSleepValue: boolean;
  readonly jsReplValue: boolean;
  readonly actCacheValue: boolean;
  readonly leanPromptDeliveryValue: boolean;
  readonly statefulPromptContractValue: boolean;
  readonly searchEngineModeValue: WorkbenchSearchEngineMode;
  readonly searchWebEngineIds: readonly string[];
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
  readonly searchEngineModeOptions: readonly SettingsOption<WorkbenchSearchEngineMode>[];
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
  readonly onWindowMaterialChange: (value: boolean) => void;
  readonly onUiStyleChange: (value: WorkbenchUiPackId) => void;
  readonly onSplitTriggerModeChange: (value: WorkbenchSplitTriggerMode) => void;
  readonly onSplitThreePaneLayoutChange: (value: WorkbenchSplitThreePaneLayout) => void;
  readonly onSplitOverflowPolicyChange: (value: WorkbenchSplitOverflowPolicy) => void;
  readonly onAiRichRenderChange: (value: boolean) => void;
  readonly onAiStopBehaviorChange: (value: WorkbenchAiStopBehavior) => void;
  readonly onPersonaSignalsChange: (value: boolean) => void;
  readonly onPreventSleepChange: (value: boolean) => void;
  readonly onJsReplChange: (value: boolean) => void;
  readonly onActCacheChange: (value: boolean) => void;
  readonly onLeanPromptDeliveryChange: (value: boolean) => void;
  readonly onStatefulPromptContractChange: (value: boolean) => void;
  readonly onSearchEngineModeChange: (value: WorkbenchSearchEngineMode) => void;
  readonly onSearchWebEnginesChange: (value: readonly string[]) => void;
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
