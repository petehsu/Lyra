import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  McpCatalogItem,
  McpCatalogQuickSetupFieldKind,
  McpEffectiveConfig,
  McpInstallKind,
  McpIntrospectionSnapshot,
  McpRuntimeStatus,
  McpScope,
  McpServerConfig,
  McpTransport,
  McpValidationResult
} from "../../../shared/mcp";

export type McpCenterStatus = "idle" | "loading" | "ready" | "error";

export type McpCenterStatusFilter = "all" | "running" | "stopped" | "error";

export type McpCenterPanelMode = "details" | "catalog" | "custom" | "edit";

export type McpCenterPresetDraft = {
  readonly templateId: string;
  readonly scope: McpScope;
  readonly title: string;
  readonly enabled: boolean;
  readonly autoStart: boolean;
  readonly values: Readonly<Record<string, string>>;
};

export type McpCenterEnvironmentDraftMode = "plain" | "secret" | "external";

export type McpCenterEnvironmentDraft = {
  readonly id: string;
  readonly key: string;
  readonly mode: McpCenterEnvironmentDraftMode;
  readonly value: string;
  readonly secretRefId?: string;
};

export type McpCenterDraft = {
  readonly mode: "custom" | "edit";
  readonly serverId: string | null;
  readonly scope: McpScope;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly iconKey: string;
  readonly transport: McpTransport;
  readonly installKind: McpInstallKind;
  readonly command: string;
  readonly argsText: string;
  readonly cwd: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly autoStart: boolean;
  readonly permissionsText: string;
  readonly environment: readonly McpCenterEnvironmentDraft[];
  readonly advancedMode: boolean;
  readonly rawValue: string;
};

export type McpCenterState = {
  readonly status: McpCenterStatus;
  readonly panelMode: McpCenterPanelMode;
  readonly preferredScope: McpScope;
  readonly statusFilter: McpCenterStatusFilter;
  readonly catalog: readonly McpCatalogItem[];
  readonly globalServers: readonly McpServerConfig[];
  readonly projectServers: readonly McpServerConfig[];
  readonly effectiveConfig: McpEffectiveConfig;
  readonly selectedServerId: string | null;
  readonly selectedCatalogId: string | null;
  readonly validationByServerId: Readonly<Record<string, McpValidationResult>>;
  readonly introspectionByServerId: Readonly<Record<string, McpIntrospectionSnapshot>>;
  readonly runtimeByServerId: Readonly<Record<string, McpRuntimeStatus>>;
  readonly draft: McpCenterDraft | null;
  readonly presetDraft: McpCenterPresetDraft | null;
  readonly errorMessage: string | null;
};

export type McpCenterLabels = {
  readonly title: string;
  readonly sidebarDescription: string;
  readonly sidebarScope: string;
  readonly sidebarStatus: string;
  readonly sidebarSources: string;
  readonly sidebarProjectRoot: string;
  readonly sidebarGlobalCount: string;
  readonly sidebarProjectCount: string;
  readonly sidebarOfficialCatalog: string;
  readonly sidebarCustomServers: string;
  readonly scopeGlobal: string;
  readonly scopeProject: string;
  readonly scopeProjectUnavailable: string;
  readonly statusAll: string;
  readonly statusRunning: string;
  readonly statusStopped: string;
  readonly statusError: string;
  readonly toolbarInstalled: string;
  readonly toolbarInstalledDescription: string;
  readonly installed: string;
  readonly details: string;
  readonly catalog: string;
  readonly catalogDescription: string;
  readonly emptySelection: string;
  readonly emptyInstalled: string;
  readonly emptyCatalog: string;
  readonly fieldTransport: string;
  readonly fieldInstallKind: string;
  readonly fieldCommand: string;
  readonly fieldArguments: string;
  readonly fieldCwd: string;
  readonly fieldUrl: string;
  readonly fieldConnection: string;
  readonly fieldEnvironment: string;
  readonly fieldPermissions: string;
  readonly fieldRuntime: string;
  readonly fieldOverride: string;
  readonly fieldSource: string;
  readonly fieldValidation: string;
  readonly fieldCapabilities: string;
  readonly fieldTools: string;
  readonly fieldResources: string;
  readonly fieldPrompts: string;
  readonly fieldLastError: string;
  readonly actionEdit: string;
  readonly actionStart: string;
  readonly actionStop: string;
  readonly actionRestart: string;
  readonly actionValidate: string;
  readonly actionDelete: string;
  readonly actionSave: string;
  readonly actionCancel: string;
  readonly actionInstall: string;
  readonly actionRefresh: string;
  readonly actionOpenCustom: string;
  readonly actionAddEnvironment: string;
  readonly actionReadCapabilities: string;
  readonly toggleAdvanced: string;
  readonly advancedInvalid: string;
  readonly validationOk: string;
  readonly validationFailed: string;
  readonly validationIdle: string;
  readonly noIntrospection: string;
  readonly noEnvironment: string;
  readonly noPermissions: string;
  readonly sourceOfficial: string;
  readonly sourceCustom: string;
  readonly recommendedScope: string;
  readonly enabled: string;
  readonly autoStart: string;
  readonly modePlain: string;
  readonly modeSecret: string;
  readonly modeExternal: string;
  readonly transportStdio: string;
  readonly transportSse: string;
  readonly transportHttp: string;
  readonly installKindNpm: string;
  readonly installKindUv: string;
  readonly installKindDocker: string;
  readonly installKindBinary: string;
  readonly installKindManual: string;
  readonly runtimeStarting: string;
  readonly runtimeRunning: string;
  readonly runtimeStopped: string;
  readonly runtimeError: string;
  readonly runtimeValidating: string;
  readonly projectOverrideInactive: string;
  readonly inheritedFromGlobal: string;
  readonly formNew: string;
  readonly formEdit: string;
  readonly formSummary: string;
  readonly formDescription: string;
  readonly formIconKey: string;
  readonly formEnvironmentKey: string;
  readonly formEnvironmentValue: string;
  readonly formEnvironmentExternal: string;
  readonly formEnvironmentSecret: string;
  readonly formRaw: string;
  readonly customDescription: string;
  readonly fieldTitle: string;
  readonly fieldSummary: string;
  readonly fieldDescription: string;
  readonly fieldIconKey: string;
  readonly presetTitle: string;
  readonly presetDescription: string;
  readonly actionQuickSetup: string;
  readonly presetFieldRootPath: string;
  readonly presetFieldRepoPath: string;
  readonly presetFieldTimezone: string;
  readonly presetHintProjectDefault: string;
  readonly presetPlaceholderPath: string;
  readonly presetPlaceholderTimezone: string;
};

export type McpCenterPresetFieldDisplay = {
  readonly label: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly kind: McpCatalogQuickSetupFieldKind;
};

export type McpCenterModel = {
  readonly state: McpCenterState;
  readonly load: () => Promise<void>;
  readonly selectServer: (serverId: string) => void;
  readonly selectCatalogItem: (catalogId: string) => void;
  readonly setPreferredScope: (scope: McpScope) => void;
  readonly setStatusFilter: (filter: McpCenterStatusFilter) => void;
  readonly openCatalog: () => void;
  readonly openPreset: (catalogId: string) => void;
  readonly openCustom: () => void;
  readonly openEdit: (serverId: string) => void;
  readonly closePanelMode: () => void;
  readonly updatePresetField: (fieldId: string, value: string) => void;
  readonly savePresetInstall: () => Promise<void>;
  readonly updateDraftField: <K extends keyof McpCenterDraft>(
    field: K,
    value: McpCenterDraft[K]
  ) => void;
  readonly addDraftEnvironment: () => void;
  readonly updateDraftEnvironment: (
    id: string,
    field: "key" | "mode" | "value",
    value: string
  ) => void;
  readonly removeDraftEnvironment: (id: string) => void;
  readonly toggleDraftAdvanced: () => void;
  readonly saveDraft: () => Promise<void>;
  readonly installTemplate: (
    templateId: string,
    setupValues?: Readonly<Record<string, string>>,
    title?: string
  ) => Promise<void>;
  readonly validateServer: (serverId: string) => Promise<void>;
  readonly startServer: (serverId: string) => Promise<void>;
  readonly stopServer: (serverId: string) => Promise<void>;
  readonly restartServer: (serverId: string) => Promise<void>;
  readonly deleteServer: (serverId: string) => Promise<void>;
  readonly readServerIntrospection: (serverId: string) => Promise<void>;
};

export type UseMcpCenterModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly projectHintPath?: string;
};
