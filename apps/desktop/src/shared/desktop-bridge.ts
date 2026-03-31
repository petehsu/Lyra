import type {
  AiCancelChatTurnRequest,
  AiChatSession,
  AiChatSessionSummary,
  AiChatTurnRequest,
  AiChatTurnResponse,
  AiDiscoverModelsRequest,
  AiDeleteProfileRequest,
  AiModelDiscoveryResult,
  AiProviderCatalogItem,
  AiProviderPreset,
  AiProfileValidationResult,
  AiProviderProfile,
  AiReadSessionHistoryRequest,
  AiReadSessionRequest,
  AiRuntimeEvent,
  AiSetDefaultProfileRequest,
  AiUpsertProfileRequest,
  AiValidateProfileRequest
} from "./ai";
import type {
  AiComputerAppKind,
  AiComputerAppInstance,
  AiComputerBootReason,
  AiComputerCloseAppRequest,
  AiComputerFocusAppRequest,
  AiComputerHostPlatform,
  AiComputerHostStatus,
  AiComputerOpenAppRequest,
  AiComputerPowerOffRequest,
  AiComputerPowerRequest,
  AiComputerPowerState,
  AiComputerReadSessionRequest,
  AiComputerSessionEvent,
  AiComputerSessionState,
  AiComputerUpdateWindowFrameRequest,
  AiComputerWindowActionRequest,
  AiComputerWindowFrame,
  AiComputerWindowState
} from "./computer";
import type {
  LyraSystemAssignSessionImageRequest,
  LyraSystemClearSessionImageOverrideRequest,
  LyraSystemEvent,
  LyraSystemImageDescriptor,
  LyraSystemInstallFromDirectoryRequest,
  LyraSystemInstallFromPackageRequest,
  LyraSystemReadResolvedSessionRequest,
  LyraSystemRegistryState,
  LyraSystemResolvedSession,
  LyraSystemSetDefaultImageRequest,
  LyraSystemSetRuntimeModeOverrideRequest,
  LyraSystemUninstallRequest
} from "./system-image";
import type {
  FileManagerCreateFileRequest,
  FileManagerCreateFolderRequest,
  FileManagerDirectoryMutationResponse,
  FileManagerEjectDeviceRequest,
  FileManagerEjectDeviceResult,
  FileManagerFavoritesPayload,
  FileReadResult,
  FileReadTextRequest,
  FileStatRequest,
  FileStatResult,
  FileManagerMountDeviceRequest,
  FileManagerMountDeviceResult,
  FileManagerMoveToTrashRequest,
  FileManagerReadDirectoryRequest,
  FileManagerReadDirectoryResponse,
  FileManagerReadHomeResponse,
  FileManagerReadTrashResponse,
  FileManagerRecentLocationsPayload,
  FileManagerRestoreFromTrashRequest,
  FileWriteResult,
  FileWriteTextRequest
} from "./file-manager";
import type {
  McpCatalogItem,
  McpCatalogQuickSetup,
  McpCatalogQuickSetupField,
  McpCatalogQuickSetupFieldKind,
  McpCreateServerRequest,
  McpDeleteServerRequest,
  McpEffectiveConfig,
  McpInstallTemplateRequest,
  McpIntrospectionSnapshot,
  McpReadEffectiveServersRequest,
  McpReadServersRequest,
  McpRuntimeEvent,
  McpScope,
  McpServerConfig,
  McpServerRequest,
  McpUpdateServerRequest,
  McpValidationResult
} from "./mcp";
import type {
  CreateLyraSkillRequest,
  DeleteSkillRequest,
  EffectiveSkillConfig,
  InstalledSkillConfig,
  LyraSkillManifest,
  ReadEffectiveSkillsRequest,
  ReadInstalledSkillsRequest,
  SkillCatalogItem,
  SkillDetails,
  SkillImportDiscovery,
  SkillImportRequest,
  SkillRuntimeEvent,
  SkillRequest,
  UpdateSkillStateRequest
} from "./skills";
import type { TerminalThemePresetId } from "./terminal-theme";

export type {
  AiCancelChatTurnRequest,
  AiChatMessage,
  AiChatMessageId,
  AiChatMessageRole,
  AiChatMessageStatus,
  AiChatMode,
  AiChatSession,
  AiChatSessionId,
  AiChatSessionSummary,
  AiChatToken,
  AiChatTurnId,
  AiChatTurnRequest,
  AiChatTurnResponse,
  AiDiscoverModelsRequest,
  AiDeleteProfileRequest,
  AiModelDiscoveryResult,
  AiProfileId,
  AiProfileValidationResult,
  AiProviderCatalogItem,
  AiProviderFieldKind,
  AiProviderFieldOption,
  AiProviderFieldSchema,
  AiProviderHeaders,
  AiProviderId,
  AiProviderModelEntry,
  AiProviderPreset,
  AiProviderPresetId,
  AiProviderProfile,
  AiProtocolId,
  AiProfileAuthConfig,
  AiProfileConnectionConfig,
  AiReadSessionHistoryRequest,
  AiReadSessionRequest,
  AiRuntimeEvent,
  AiSetDefaultProfileRequest,
  AiUpsertProfileRequest,
  AiValidateProfileRequest
} from "./ai";
export type {
  AiComputerAppKind,
  AiComputerAppInstance,
  AiComputerBootReason,
  AiComputerCloseAppRequest,
  AiComputerFocusAppRequest,
  AiComputerHostPlatform,
  AiComputerHostStatus,
  AiComputerOpenAppRequest,
  AiComputerPowerOffRequest,
  AiComputerPowerRequest,
  AiComputerPowerState,
  AiComputerReadSessionRequest,
  AiComputerSessionEvent,
  AiComputerSessionState,
  AiComputerUpdateWindowFrameRequest,
  AiComputerWindowActionRequest,
  AiComputerWindowFrame,
  AiComputerWindowState
} from "./computer";
export type {
  LyraSystemAssignSessionImageRequest,
  LyraSystemClearSessionImageOverrideRequest,
  LyraSystemCompatibility,
  LyraSystemContextState,
  LyraSystemEvent,
  LyraSystemImageDescriptor,
  LyraSystemImageInstallSource,
  LyraSystemImageManifest,
  LyraSystemInstallFromDirectoryRequest,
  LyraSystemInstallFromPackageRequest,
  LyraSystemPlatformArch,
  LyraSystemPlatformArtifact,
  LyraSystemPlatformArtifactKind,
  LyraSystemReadResolvedSessionRequest,
  LyraSystemRegistryState,
  LyraSystemResolvedSession,
  LyraSystemRuntimeMode,
  LyraSystemSetDefaultImageRequest,
  LyraSystemSetRuntimeModeOverrideRequest,
  LyraSystemShellMode,
  LyraSystemUninstallRequest
} from "./system-image";
export type {
  McpCatalogItem,
  McpCatalogQuickSetup,
  McpCatalogQuickSetupField,
  McpCatalogQuickSetupFieldKind,
  McpCreateServerRequest,
  McpDeleteServerRequest,
  McpEffectiveConfig,
  McpEffectiveServerConfig,
  McpEnvironmentEntry,
  McpEnvironmentInput,
  McpInstallKind,
  McpInstallTemplateRequest,
  McpIntrospectionSnapshot,
  McpReadEffectiveServersRequest,
  McpReadServersRequest,
  McpRuntimeEvent,
  McpRuntimePhase,
  McpRuntimeStatus,
  McpScope,
  McpSecretFieldRef,
  McpServerConfig,
  McpServerId,
  McpServerRequest,
  McpTransport,
  McpUpdateServerRequest,
  McpValidationResult
} from "./mcp";
export type {
  CreateLyraSkillRequest,
  DeleteSkillRequest,
  EffectiveSkillConfig,
  InstalledSkillConfig,
  LyraSkillManifest,
  ReadEffectiveSkillsRequest,
  ReadInstalledSkillsRequest,
  SkillCatalogItem,
  SkillCompatibility,
  SkillDetails,
  SkillEnableState,
  SkillFileKind,
  SkillFileSummary,
  SkillId,
  SkillImportDetectedKind,
  SkillImportDiscovery,
  SkillImportPreviewItem,
  SkillImportRequest,
  SkillRuntimeEvent,
  SkillScope,
  SkillSourceKind,
  SkillTrustState,
  SkillType,
  SkillRequest,
  UpdateSkillStateRequest
} from "./skills";

export const LYRA_CHANNELS = {
  minimizeWindow: "lyra:shell/window/minimize",
  toggleWindowMaximize: "lyra:shell/window/toggle-maximize",
  closeWindow: "lyra:shell/window/close",
  readAppMeta: "lyra:shell/app/meta",
  readAppMetaSync: "lyra:shell/app/meta-sync",
  openExternal: "lyra:shell/open-external",
  linuxCompatReadStatus: "lyra:linux-compat/read-status",
  linuxCompatExportDiagnostics: "lyra:linux-compat/export-diagnostics",
  windowStateChanged: "lyra:shell/window/state-changed",
  aggregateSearch: "lyra:search/aggregate",
  filesReadHome: "lyra:files/read-home",
  filesReadDirectory: "lyra:files/read-directory",
  filesReadTrash: "lyra:files/read-trash",
  filesCreateFile: "lyra:files/create-file",
  filesCreateFolder: "lyra:files/create-folder",
  filesMoveToTrash: "lyra:files/move-to-trash",
  filesRestoreFromTrash: "lyra:files/restore-from-trash",
  filesEmptyTrash: "lyra:files/empty-trash",
  filesMountDevice: "lyra:files/mount-device",
  filesEjectDevice: "lyra:files/eject-device",
  filesReadFavorites: "lyra:files/read-favorites",
  filesWriteFavorites: "lyra:files/write-favorites",
  filesReadRecentLocations: "lyra:files/read-recent-locations",
  filesWriteRecentLocations: "lyra:files/write-recent-locations",
  filesReadTextFile: "lyra:files/read-text-file",
  filesWriteTextFile: "lyra:files/write-text-file",
  filesStatFile: "lyra:files/stat-file",
  aiReadProfiles: "lyra:ai/read-profiles",
  aiReadProviderCatalog: "lyra:ai/read-provider-catalog",
  aiReadPresetCatalog: "lyra:ai/read-preset-catalog",
  aiUpsertProfile: "lyra:ai/upsert-profile",
  aiDeleteProfile: "lyra:ai/delete-profile",
  aiSetDefaultProfile: "lyra:ai/set-default-profile",
  aiValidateProfile: "lyra:ai/validate-profile",
  aiDiscoverModels: "lyra:ai/discover-models",
  aiRefreshDiscoveredModels: "lyra:ai/refresh-discovered-models",
  aiReadSession: "lyra:ai/read-session",
  aiReadSessionHistory: "lyra:ai/read-session-history",
  aiSendChatTurn: "lyra:ai/send-chat-turn",
  aiCancelChatTurn: "lyra:ai/cancel-chat-turn",
  aiEvent: "lyra:ai/event",
  computerReadSession: "lyra:computer/read-session",
  computerReadHostStatus: "lyra:computer/read-host-status",
  computerPowerOn: "lyra:computer/power-on",
  computerPowerOff: "lyra:computer/power-off",
  computerOpenApp: "lyra:computer/open-app",
  computerFocusApp: "lyra:computer/focus-app",
  computerCloseApp: "lyra:computer/close-app",
  computerMoveAppWindow: "lyra:computer/move-app-window",
  computerResizeAppWindow: "lyra:computer/resize-app-window",
  computerMinimizeApp: "lyra:computer/minimize-app",
  computerMaximizeApp: "lyra:computer/maximize-app",
  computerRestoreApp: "lyra:computer/restore-app",
  computerEvent: "lyra:computer/event",
  systemImagesReadRegistry: "lyra:system-images/read-registry",
  systemImagesListInstalled: "lyra:system-images/list-installed",
  systemImagesInstallFromDirectory: "lyra:system-images/install-from-directory",
  systemImagesInstallFromPackage: "lyra:system-images/install-from-package",
  systemImagesInstallOfficialSeed: "lyra:system-images/install-official-seed",
  systemImagesUninstall: "lyra:system-images/uninstall",
  systemImagesSetDefault: "lyra:system-images/set-default-image",
  systemImagesAssignSession: "lyra:system-images/assign-session-image",
  systemImagesClearSessionOverride: "lyra:system-images/clear-session-override",
  systemImagesSetRuntimeModeOverride: "lyra:system-images/set-runtime-mode-override",
  systemImagesReadResolvedSession: "lyra:system-images/read-resolved-session",
  systemImagesEvent: "lyra:system-images/event",
  mcpReadCatalog: "lyra:mcp/read-catalog",
  mcpReadServers: "lyra:mcp/read-servers",
  mcpReadEffectiveServers: "lyra:mcp/read-effective-servers",
  mcpCreateServer: "lyra:mcp/create-server",
  mcpUpdateServer: "lyra:mcp/update-server",
  mcpDeleteServer: "lyra:mcp/delete-server",
  mcpInstallTemplate: "lyra:mcp/install-template",
  mcpValidateServer: "lyra:mcp/validate-server",
  mcpStartServer: "lyra:mcp/start-server",
  mcpStopServer: "lyra:mcp/stop-server",
  mcpRestartServer: "lyra:mcp/restart-server",
  mcpReadServerIntrospection: "lyra:mcp/read-server-introspection",
  mcpEvent: "lyra:mcp/event",
  skillsReadCatalog: "lyra:skills/read-catalog",
  skillsReadInstalled: "lyra:skills/read-installed",
  skillsReadEffective: "lyra:skills/read-effective",
  skillsDiscoverImportSource: "lyra:skills/discover-import-source",
  skillsImport: "lyra:skills/import",
  skillsCreateLyraSkill: "lyra:skills/create-lyra-skill",
  skillsUpdateState: "lyra:skills/update-state",
  skillsDelete: "lyra:skills/delete",
  skillsReadDetails: "lyra:skills/read-details",
  skillsEvent: "lyra:skills/event",
  lspOpenDocument: "lyra:lsp/open-document",
  lspChangeDocument: "lyra:lsp/change-document",
  lspSaveDocument: "lyra:lsp/save-document",
  lspCloseDocument: "lyra:lsp/close-document",
  lspCompletion: "lyra:lsp/completion",
  lspEvent: "lyra:lsp/event",
  terminalCreateSession: "lyra:terminal/create-session",
  terminalRestoreSessions: "lyra:terminal/restore-sessions",
  terminalReloadPrompt: "lyra:terminal/reload-prompt",
  terminalWriteSession: "lyra:terminal/write-session",
  terminalResizeSession: "lyra:terminal/resize-session",
  terminalCloseSession: "lyra:terminal/close-session",
  terminalEvent: "lyra:terminal/event",
  workbenchStateReadSync: "lyra:workbench-state/read-sync",
  workbenchStateWriteSync: "lyra:workbench-state/write-sync",
  workbenchStateRemoveSync: "lyra:workbench-state/remove-sync"
} as const;

export type WindowStatePayload = {
  readonly isMaximized: boolean;
  readonly isFocused: boolean;
};

export type AppMetaPayload = {
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
};

export type LinuxGraphicsBackend = "wayland" | "x11";

export type LinuxGpuMode = "hardware" | "software";

export type LinuxSessionType = "wayland" | "x11" | "unknown";

export type LinuxStrategySource = "auto" | "cli" | "env";

export type LinuxCompatWarning = {
  readonly code:
    | "both-display-servers-detected"
    | "session-env-mismatch"
    | "unknown-session"
    | "unknown-desktop";
  readonly message: string;
};

export type LinuxEnvironmentFacts = {
  readonly sessionType: LinuxSessionType;
  readonly desktop: string;
  readonly waylandDisplay: string | null;
  readonly x11Display: string | null;
  readonly isRoot: boolean;
};

export type LinuxCompatReadStatusResponse = {
  readonly platform: NodeJS.Platform;
  readonly enabled: boolean;
  readonly safeMode: boolean;
  readonly backend: LinuxGraphicsBackend;
  readonly gpuMode: LinuxGpuMode;
  readonly backendSource: LinuxStrategySource;
  readonly gpuSource: LinuxStrategySource;
  readonly warnings: readonly LinuxCompatWarning[];
  readonly notes: readonly string[];
  readonly appliedEnv: Readonly<Record<string, string>>;
  readonly appliedSwitches: Readonly<Record<string, string>>;
  readonly facts: LinuxEnvironmentFacts;
  readonly generatedAt: string;
};

export type LinuxCompatExportResponse = {
  readonly ok: boolean;
  readonly filePath?: string;
  readonly error?: string;
};

export type SearchAggregateEngine = {
  readonly id: string;
  readonly label: string;
  readonly accentColor: string;
};

export type SearchAggregateResult = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly displayUrl: string;
  readonly snippet: string;
  readonly sourceEngineIds: readonly string[];
};

export type SearchAggregateEngineBucket = {
  readonly engine: SearchAggregateEngine;
  readonly results: readonly SearchAggregateResult[];
  readonly error?: string;
  readonly latencyMs?: number;
};

export type SearchAggregateRequest = {
  readonly query: string;
  readonly limitPerEngine: number;
  readonly engines: readonly SearchAggregateEngine[];
};

export type SearchAggregateResponse = {
  readonly query: string;
  readonly blendedResults: readonly SearchAggregateResult[];
  readonly engineBuckets: readonly SearchAggregateEngineBucket[];
  readonly fetchedAt: string;
  readonly elapsedMs: number;
};

export type TerminalSessionId = string;

export type TerminalCommandSource = "user" | "ai";

export type TerminalCreateRequest = {
  readonly sessionId?: TerminalSessionId;
  readonly title?: string;
  readonly cwd?: string;
  readonly shell?: string;
  readonly terminalThemePreset?: TerminalThemePresetId;
  readonly uiThemeId?: string;
  readonly cols: number;
  readonly rows: number;
  readonly source: TerminalCommandSource;
};

export type TerminalSessionSnapshot = {
  readonly sessionId: TerminalSessionId;
  readonly title: string;
  readonly cwd?: string;
  readonly shell: string;
  readonly cols: number;
  readonly rows: number;
  readonly createdAt: string;
};

export type TerminalWriteRequest = {
  readonly sessionId: TerminalSessionId;
  readonly data: string;
  readonly source: TerminalCommandSource;
};

export type TerminalResizeRequest = {
  readonly sessionId: TerminalSessionId;
  readonly cols: number;
  readonly rows: number;
};

export type TerminalCloseRequest = {
  readonly sessionId: TerminalSessionId;
};

export type TerminalRestoreRequest = {
  readonly sessions: readonly TerminalCreateRequest[];
};

export type TerminalReloadPromptRequest = {
  readonly sessionId: TerminalSessionId;
  readonly terminalThemePreset?: TerminalThemePresetId;
  readonly uiThemeId?: string;
  readonly source: TerminalCommandSource;
};

export type TerminalReloadPromptResult = {
  readonly applied: boolean;
  readonly deferred: boolean;
  readonly reason?: string;
};

export type TerminalDataEvent = {
  readonly kind: "data";
  readonly sessionId: TerminalSessionId;
  readonly data: string;
};

export type TerminalExitEvent = {
  readonly kind: "exit";
  readonly sessionId: TerminalSessionId;
  readonly exitCode: number;
};

export type TerminalErrorEvent = {
  readonly kind: "error";
  readonly sessionId: TerminalSessionId;
  readonly error: string;
};

export type TerminalEvent = TerminalDataEvent | TerminalExitEvent | TerminalErrorEvent;

export type AiEditorStreamEvent =
  | {
      readonly kind: "plan";
      readonly sessionId: string;
      readonly stepId: string;
      readonly text: string;
    }
  | {
      readonly kind: "patch";
      readonly sessionId: string;
      readonly filePath: string;
      readonly diff: string;
    }
  | {
      readonly kind: "cursor";
      readonly sessionId: string;
      readonly filePath: string;
      readonly line: number;
      readonly column: number;
    }
  | {
      readonly kind: "diagnostic";
      readonly sessionId: string;
      readonly filePath: string;
      readonly severity: "info" | "warning" | "error";
      readonly message: string;
    }
  | {
      readonly kind: "approval";
      readonly sessionId: string;
      readonly approvalId: string;
      readonly summary: string;
      readonly status: "pending" | "approved" | "rejected";
    };

export type LspLanguageId = "typescript" | "javascript" | "rust" | "python";

export type LspDocumentRequest = {
  readonly sessionId: string;
  readonly filePath: string;
  readonly languageId: LspLanguageId;
  readonly content: string;
  readonly version: number;
  readonly projectRoot?: string;
};

export type LspCompletionRequest = {
  readonly sessionId: string;
  readonly filePath: string;
  readonly languageId: LspLanguageId;
  readonly line: number;
  readonly column: number;
  readonly version: number;
  readonly projectRoot?: string;
};

export type LspCompletionItem = {
  readonly label: string;
  readonly insertText?: string;
  readonly detail?: string;
  readonly documentation?: string;
  readonly kind?: number;
  readonly sortText?: string;
  readonly filterText?: string;
};

export type LspCompletionResult = {
  readonly items: readonly LspCompletionItem[];
  readonly isIncomplete: boolean;
};

export type LspDiagnostic = {
  readonly startLine: number;
  readonly startCharacter: number;
  readonly endLine: number;
  readonly endCharacter: number;
  readonly severity?: number;
  readonly code?: string;
  readonly source?: string;
  readonly message: string;
};

export type LspRuntimeEvent =
  | {
      readonly kind: "diagnostic";
      readonly sessionId?: string;
      readonly filePath?: string;
      readonly languageId?: LspLanguageId;
      readonly projectRoot?: string;
      readonly diagnostics: readonly LspDiagnostic[];
    }
  | {
      readonly kind: "server-status";
      readonly languageId?: LspLanguageId;
      readonly projectRoot?: string;
      readonly status: string;
      readonly message?: string;
    }
  | {
      readonly kind: "error";
      readonly sessionId?: string;
      readonly filePath?: string;
      readonly languageId?: LspLanguageId;
      readonly projectRoot?: string;
      readonly message: string;
    };

export type WindowControlsApi = {
  readonly minimize: () => Promise<void>;
  readonly toggleMaximize: () => Promise<void>;
  readonly close: () => Promise<void>;
};

export type ShellEventsApi = {
  readonly onWindowStateChange: (
    listener: (payload: WindowStatePayload) => void
  ) => () => void;
};

export type SearchApi = {
  readonly aggregate: (request: SearchAggregateRequest) => Promise<SearchAggregateResponse>;
};

export type AiApi = {
  readonly readProfiles: () => Promise<readonly AiProviderProfile[]>;
  readonly readProviderCatalog: () => Promise<readonly AiProviderCatalogItem[]>;
  readonly readPresetCatalog: () => Promise<readonly AiProviderPreset[]>;
  readonly upsertProfile: (request: AiUpsertProfileRequest) => Promise<AiProviderProfile>;
  readonly deleteProfile: (request: AiDeleteProfileRequest) => Promise<void>;
  readonly setDefaultProfile: (request: AiSetDefaultProfileRequest) => Promise<AiProviderProfile>;
  readonly validateProfile: (
    request: AiValidateProfileRequest
  ) => Promise<AiProfileValidationResult>;
  readonly discoverModels: (
    request: AiDiscoverModelsRequest
  ) => Promise<AiModelDiscoveryResult>;
  readonly refreshDiscoveredModels: (
    request: AiDiscoverModelsRequest
  ) => Promise<AiModelDiscoveryResult>;
  readonly readSession: (request: AiReadSessionRequest) => Promise<AiChatSession>;
  readonly readSessionHistory: (
    request?: AiReadSessionHistoryRequest
  ) => Promise<readonly AiChatSessionSummary[]>;
  readonly sendChatTurn: (request: AiChatTurnRequest) => Promise<AiChatTurnResponse>;
  readonly cancelChatTurn: (request: AiCancelChatTurnRequest) => Promise<AiChatSession>;
  readonly onEvent: (listener: (event: AiRuntimeEvent) => void) => () => void;
};

export type McpApi = {
  readonly readCatalog: () => Promise<readonly McpCatalogItem[]>;
  readonly readServers: (request: McpReadServersRequest) => Promise<readonly McpServerConfig[]>;
  readonly readEffectiveServers: (
    request?: McpReadEffectiveServersRequest
  ) => Promise<McpEffectiveConfig>;
  readonly createServer: (request: McpCreateServerRequest) => Promise<McpServerConfig>;
  readonly updateServer: (request: McpUpdateServerRequest) => Promise<McpServerConfig>;
  readonly deleteServer: (request: McpDeleteServerRequest) => Promise<void>;
  readonly installTemplate: (request: McpInstallTemplateRequest) => Promise<McpServerConfig>;
  readonly validateServer: (request: McpServerRequest) => Promise<McpValidationResult>;
  readonly startServer: (request: McpServerRequest) => Promise<McpServerConfig>;
  readonly stopServer: (request: McpServerRequest) => Promise<McpServerConfig>;
  readonly restartServer: (request: McpServerRequest) => Promise<McpServerConfig>;
  readonly readServerIntrospection: (request: McpServerRequest) => Promise<McpIntrospectionSnapshot>;
  readonly onEvent: (listener: (event: McpRuntimeEvent) => void) => () => void;
};

export type SkillsApi = {
  readonly readCatalog: () => Promise<readonly SkillCatalogItem[]>;
  readonly readInstalled: (
    request: ReadInstalledSkillsRequest
  ) => Promise<readonly InstalledSkillConfig[]>;
  readonly readEffectiveSkills: (
    request?: ReadEffectiveSkillsRequest
  ) => Promise<readonly EffectiveSkillConfig[]>;
  readonly discoverImportSource: (sourcePath: string) => Promise<SkillImportDiscovery>;
  readonly importSkills: (
    request: SkillImportRequest
  ) => Promise<readonly InstalledSkillConfig[]>;
  readonly createLyraSkill: (
    request: CreateLyraSkillRequest
  ) => Promise<InstalledSkillConfig>;
  readonly updateSkillState: (
    request: UpdateSkillStateRequest
  ) => Promise<InstalledSkillConfig>;
  readonly deleteSkill: (request: DeleteSkillRequest) => Promise<void>;
  readonly readSkillDetails: (request: SkillRequest) => Promise<SkillDetails | null>;
  readonly onEvent: (listener: (event: SkillRuntimeEvent) => void) => () => void;
};

export type LinuxCompatApi = {
  readonly readStatus: () => Promise<LinuxCompatReadStatusResponse>;
  readonly exportDiagnostics: () => Promise<LinuxCompatExportResponse>;
};

export type FilesApi = {
  readonly readHome: () => Promise<FileManagerReadHomeResponse>;
  readonly readDirectory: (request: FileManagerReadDirectoryRequest) => Promise<FileManagerReadDirectoryResponse>;
  readonly readTrash: () => Promise<FileManagerReadTrashResponse>;
  readonly createFile: (request: FileManagerCreateFileRequest) => Promise<FileManagerDirectoryMutationResponse>;
  readonly createFolder: (request: FileManagerCreateFolderRequest) => Promise<FileManagerDirectoryMutationResponse>;
  readonly moveToTrash: (request: FileManagerMoveToTrashRequest) => Promise<void>;
  readonly restoreFromTrash: (request: FileManagerRestoreFromTrashRequest) => Promise<void>;
  readonly emptyTrash: () => Promise<void>;
  readonly mountDevice: (request: FileManagerMountDeviceRequest) => Promise<FileManagerMountDeviceResult>;
  readonly ejectDevice: (request: FileManagerEjectDeviceRequest) => Promise<FileManagerEjectDeviceResult>;
  readonly readFavorites: () => Promise<FileManagerFavoritesPayload>;
  readonly writeFavorites: (payload: FileManagerFavoritesPayload) => Promise<FileManagerFavoritesPayload>;
  readonly readRecentLocations: () => Promise<FileManagerRecentLocationsPayload>;
  readonly writeRecentLocations: (
    payload: FileManagerRecentLocationsPayload
  ) => Promise<FileManagerRecentLocationsPayload>;
  readonly readTextFile: (request: FileReadTextRequest) => Promise<FileReadResult>;
  readonly writeTextFile: (request: FileWriteTextRequest) => Promise<FileWriteResult>;
  readonly statFile: (request: FileStatRequest) => Promise<FileStatResult>;
};

export type ComputerApi = {
  readonly readSession: (
    request: AiComputerReadSessionRequest
  ) => Promise<AiComputerSessionState>;
  readonly readHostStatus: () => Promise<AiComputerHostStatus>;
  readonly powerOn: (request: AiComputerPowerRequest) => Promise<AiComputerSessionState>;
  readonly powerOff: (
    request: AiComputerPowerOffRequest
  ) => Promise<AiComputerSessionState>;
  readonly openApp: (
    request: AiComputerOpenAppRequest
  ) => Promise<AiComputerSessionState>;
  readonly focusApp: (
    request: AiComputerFocusAppRequest
  ) => Promise<AiComputerSessionState>;
  readonly closeApp: (
    request: AiComputerCloseAppRequest
  ) => Promise<AiComputerSessionState>;
  readonly moveAppWindow: (
    request: AiComputerUpdateWindowFrameRequest
  ) => Promise<AiComputerSessionState>;
  readonly resizeAppWindow: (
    request: AiComputerUpdateWindowFrameRequest
  ) => Promise<AiComputerSessionState>;
  readonly minimizeApp: (
    request: AiComputerWindowActionRequest
  ) => Promise<AiComputerSessionState>;
  readonly maximizeApp: (
    request: AiComputerWindowActionRequest
  ) => Promise<AiComputerSessionState>;
  readonly restoreApp: (
    request: AiComputerWindowActionRequest
  ) => Promise<AiComputerSessionState>;
  readonly subscribeSession: (
    sessionId: string,
    listener: (event: AiComputerSessionEvent) => void
  ) => () => void;
};

export type SystemImagesApi = {
  readonly readRegistry: () => Promise<LyraSystemRegistryState>;
  readonly listInstalled: () => Promise<readonly LyraSystemImageDescriptor[]>;
  readonly installFromDirectory: (
    request: LyraSystemInstallFromDirectoryRequest
  ) => Promise<LyraSystemImageDescriptor>;
  readonly installFromPackage: (
    request: LyraSystemInstallFromPackageRequest
  ) => Promise<LyraSystemImageDescriptor>;
  readonly installOfficialSeed: () => Promise<LyraSystemImageDescriptor>;
  readonly uninstall: (request: LyraSystemUninstallRequest) => Promise<LyraSystemRegistryState>;
  readonly setDefaultImage: (
    request: LyraSystemSetDefaultImageRequest
  ) => Promise<LyraSystemRegistryState>;
  readonly assignSessionImage: (
    request: LyraSystemAssignSessionImageRequest
  ) => Promise<LyraSystemResolvedSession>;
  readonly clearSessionImageOverride: (
    request: LyraSystemClearSessionImageOverrideRequest
  ) => Promise<LyraSystemResolvedSession>;
  readonly setRuntimeModeOverride: (
    request: LyraSystemSetRuntimeModeOverrideRequest
  ) => Promise<LyraSystemRegistryState>;
  readonly readResolvedSessionSystem: (
    request: LyraSystemReadResolvedSessionRequest
  ) => Promise<LyraSystemResolvedSession>;
  readonly subscribeSystemEvents: (
    listener: (event: LyraSystemEvent) => void
  ) => () => void;
};

export type TerminalApi = {
  readonly createSession: (request: TerminalCreateRequest) => Promise<TerminalSessionSnapshot>;
  readonly restoreSessions: (request: TerminalRestoreRequest) => Promise<readonly TerminalSessionSnapshot[]>;
  readonly reloadPrompt: (request: TerminalReloadPromptRequest) => Promise<TerminalReloadPromptResult>;
  readonly write: (request: TerminalWriteRequest) => Promise<void>;
  readonly resize: (request: TerminalResizeRequest) => Promise<void>;
  readonly closeSession: (request: TerminalCloseRequest) => Promise<void>;
  readonly onData: (listener: (event: TerminalDataEvent) => void) => () => void;
  readonly onExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  readonly onError: (listener: (event: TerminalErrorEvent) => void) => () => void;
};

export type LspApi = {
  readonly openDocument: (request: LspDocumentRequest) => Promise<void>;
  readonly changeDocument: (request: LspDocumentRequest) => Promise<void>;
  readonly saveDocument: (request: LspDocumentRequest) => Promise<void>;
  readonly closeDocument: (request: LspDocumentRequest) => Promise<void>;
  readonly completion: (request: LspCompletionRequest) => Promise<LspCompletionResult>;
  readonly onEvent: (listener: (event: LspRuntimeEvent) => void) => () => void;
};

export type WorkbenchStateKey =
  | "preferences"
  | "workspace-tabs"
  | "terminal-dock"
  | "notifications"
  | "layout";

export type WorkbenchStateApi = {
  readonly readSync: (key: WorkbenchStateKey) => string | null;
  readonly writeSync: (key: WorkbenchStateKey, json: string) => void;
  readonly removeSync: (key: WorkbenchStateKey) => void;
};

export type LyraDesktopApi = {
  readonly windowControls: WindowControlsApi;
  readonly appMeta: AppMetaPayload;
  readonly shellEvents: ShellEventsApi;
  readonly openExternal: (url: string) => Promise<boolean>;
  readonly linuxCompat: LinuxCompatApi;
  readonly search: SearchApi;
  readonly files: FilesApi;
  readonly ai: AiApi;
  readonly computer: ComputerApi;
  readonly systemImages: SystemImagesApi;
  readonly mcp: McpApi;
  readonly skills: SkillsApi;
  readonly lsp: LspApi;
  readonly terminal: TerminalApi;
  readonly workbenchState: WorkbenchStateApi;
};
