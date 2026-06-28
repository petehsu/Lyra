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
export type SoftwareStoreCatalogFilter = "all" | "builtin" | "uiux";

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
  readonly builtinBadge: string;
  readonly uiuxBadge: string;
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
  readonly builtinType: string;
  readonly uiuxType: string;
  readonly agentAccessNotConnected: string;
  readonly agentAccessReadOnly: string;
  readonly agentAccessControllable: string;
  readonly openBuiltin: string;
  readonly openUnavailable: string;
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
  readonly revokeTrust: string;
  readonly activate: string;
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
};

export type SoftwareStoreUiuxStatus =
  | UiuxPackTrustState
  | "builtin"
  | "active"
  | "pending";
