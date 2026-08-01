import type {
  LyraDesktopApi,
  UiuxPackTrustState
} from "../../../shared/desktop-bridge";
import type { SoftwareCapabilitiesRegistryModel } from "../software-capabilities";
import type { WorkbenchUiPackId } from "../ui-platform";

export type SoftwareStoreAppId = "software-store";
export type SoftwareStoreAppIconKey = "software-store-default";

export type SoftwareStoreBuiltinAppId =
  | "browser-search"
  | "file-manager"
  | "downloads"
  | "terminal"
  | "image-viewer"
  | "notifications"
  | "settings"
  | "agent-history"
  | "agent-project-tree"
  | "agent-git"
  | "login-manager"
  | "software-store";

export type SoftwareStoreAgentAccess = "notConnected" | "readOnly" | "controllable";
export type SoftwareStoreCatalogFilter = "all" | "builtin" | "components" | "uiux";

export type SoftwareStoreBuiltinApp = {
  readonly id: SoftwareStoreBuiltinAppId;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly agentAccess: SoftwareStoreAgentAccess;
  readonly openable: boolean;
  readonly openDisabledReason?: string;
};

export type SoftwareStoreLabels = {
  readonly title: string;
  readonly open: string;
  readonly tabTitle: string;
  readonly searchPlaceholder: string;
  readonly refresh: string;
  readonly loading: string;
  readonly unavailable: string;
  readonly allTab: string;
  readonly builtinTab: string;
  readonly uiuxTab: string;
  readonly componentsTab: string;
  readonly builtinBadge: string;
  readonly uiuxBadge: string;
  readonly componentBadge: string;
  readonly activeBadge: string;
  readonly pendingBadge: string;
  readonly trustedBadge: string;
  readonly untrustedBadge: string;
  readonly revokedBadge: string;
  readonly detailsTitle: string;
  readonly selectItemTitle: string;
  readonly selectItemDescription: string;
  readonly emptyTitle: string;
  readonly typeLabel: string;
  readonly categoryLabel: string;
  readonly versionLabel: string;
  readonly sourceLabel: string;
  readonly statusLabel: string;
  readonly permissionsLabel: string;
  readonly actionsLabel: string;
  readonly noActions: string;
  readonly riskLabel: string;
  readonly agentAccessLabel: string;
  readonly noPermissions: string;
  readonly contributionsLabel: string;
  readonly contributionCommandsLabel: string;
  readonly contributionSettingsLabel: string;
  readonly contributionStatusLabel: string;
  readonly contributionCapabilitiesLabel: string;
  readonly contributionEventsLabel: string;
  readonly noContributions: string;
  readonly moduleLoaded: string;
  readonly moduleFallback: string;
  readonly moduleMissing: string;
  readonly moduleVersionMismatch: string;
  readonly moduleStartFailed: string;
  readonly moduleUnavailableDescription: string;
  readonly repairModule: string;
  readonly runCommand: string;
  readonly openContributionSettings: string;
  readonly commandCompleted: string;
  readonly repairCompleted: string;
  readonly requiredCapabilityLabel: string;
  readonly builtinType: string;
  readonly uiuxType: string;
  readonly componentType: string;
  readonly agentAccessNotConnected: string;
  readonly agentAccessReadOnly: string;
  readonly agentAccessControllable: string;
  readonly openBuiltin: string;
  readonly openUnavailable: string;
  readonly updateTitle: string;
  readonly updateDescription: string;
  readonly updateChannelLabel: string;
  readonly stableChannel: string;
  readonly previewChannel: string;
  readonly checkAndStageUpdates: string;
  readonly cancelUpdate: string;
  readonly updateProgressLabel: string;
  readonly updateReady: string;
  readonly updateCancelled: string;
  readonly chooseLocal: string;
  readonly installLocal: string;
  readonly installGit: string;
  readonly installNpm: string;
  readonly gitUrlLabel: string;
  readonly gitRefLabel: string;
  readonly gitSubdirLabel: string;
  readonly npmPackageLabel: string;
  readonly npmVersionLabel: string;
  readonly npmSubdirLabel: string;
  readonly trust: string;
  readonly trustConfirmation: string;
  readonly revokeTrust: string;
  readonly activate: string;
  readonly restartAndApply: string;
  readonly coreRestartConfirm: string;
  readonly coreUpdateStarting: string;
  readonly rollback: string;
  readonly activating: string;
  readonly operationSucceeded: string;
  readonly operationFailed: string;
  readonly reloadRequired: string;
  readonly installedAtLabel: string;
  readonly updatedAtLabel: string;
  readonly localSource: string;
  readonly gitSource: string;
  readonly npmSource: string;
  readonly builtinSource: string;
  readonly builtinApps: readonly SoftwareStoreBuiltinApp[];
};

export type SoftwareStoreSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly embedded?: boolean;
  readonly labels: SoftwareStoreLabels;
  readonly softwareCapabilities: SoftwareCapabilitiesRegistryModel;
  readonly activeUiPackId: WorkbenchUiPackId;
  readonly onUiPackIdChange: (packId: WorkbenchUiPackId) => void;
  readonly onOpenBuiltinApp: (appId: SoftwareStoreBuiltinAppId) => void;
  /** Core-owned resolver for the declarative, non-URL settings route. */
  readonly onOpenSettingsRoute: (route: string) => void;
};

export type SoftwareStoreUiuxStatus =
  | UiuxPackTrustState
  | "builtin"
  | "active"
  | "pending";
