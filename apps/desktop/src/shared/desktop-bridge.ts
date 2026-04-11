import type {
  AiDiscoverModelsRequest,
  AiDeleteProfileRequest,
  AiModelDiscoveryResult,
  AiOpenAiChatGptAuthResult,
  AiProviderCatalogItem,
  AiProviderPreset,
  AiProfileValidationResult,
  AiProviderProfile,
  AiSetDefaultProfileRequest,
  AiUpsertProfileRequest,
  AiValidateProfileRequest
} from "./ai";
import type {
  AiMemoryConfig,
  AgentAnswerQuestionRequest,
  AgentAnswerPlanQuestionRequest,
  AgentBindSessionProjectRequest,
  AgentEnterPlanModeRequest,
  AgentCreateSessionRequest,
  AgentDeleteSessionRequest,
  AgentGetPendingInteractionsRequest,
  AgentGetPlanRequest,
  AgentGetSessionRequest,
  AgentPlanState,
  AgentPendingInteraction,
  AgentResolvePlanApprovalRequest,
  AgentRuntimeEvent,
  AgentSendTurnRequest,
  AgentSendTurnResult,
  AgentSession,
  AgentSessionDetail,
  CommandApprovalSubmitRequest,
  PlanApprovalRequest,
  PlanInteractionResponse,
  PlanQuestionItem,
  PlanQuestionOption,
  PlanQuestionRequest
} from "./agent";
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
import type {
  CapabilityApprovalResolveRequest,
  CapabilityCallResult,
  CapabilityDescriptor,
  CapabilityInvokeRequest,
  CapabilityListRequest,
  CapabilityReadRegistryResponse,
  CapabilityResolveApprovalResponse,
  CapabilityRuntimeEvent
} from "./capabilities";
import type { TerminalThemePresetId } from "./terminal-theme";
import type {
  WorkbenchBrowserAgentTargetInfo,
  WorkbenchBrowserElementPickerAppearance,
  WorkbenchBrowserElementPickerDisableCause,
  WorkbenchBrowserElementPickerOwner,
  WorkbenchBrowserElementPickerPhase,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserEvent,
  WorkbenchBrowserHoveredElementInfo,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserSetElementPickerModeRequest,
  WorkbenchBrowserTopologySnapshot
} from "./workbench-browser";
import type {
  WorkbenchObservationQueryRequest,
  WorkbenchObservationQueryResult
} from "./workbench-observation";

export type {
  AiDiscoverModelsRequest,
  AiDeleteProfileRequest,
  AiModelDiscoveryResult,
  AiOpenAiChatGptAuthResult,
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
  AiSetDefaultProfileRequest,
  AiUpsertProfileRequest,
  AiValidateProfileRequest
} from "./ai";
export type {
  AiMemoryConfig,
  AgentAnswerQuestionRequest,
  AgentAnswerPlanQuestionRequest,
  AgentBindSessionProjectRequest,
  AgentEnterPlanModeRequest,
  AgentCreateSessionRequest,
  AgentDeleteSessionRequest,
  AgentGetPendingInteractionsRequest,
  AgentGetPlanRequest,
  AgentGetSessionRequest,
  AgentPlanState,
  AgentPendingInteraction,
  AgentPendingInteractionKind,
  AgentPendingInteractionStatus,
  AgentResolvePlanApprovalRequest,
  AgentMessage,
  AgentRuntimeEvent,
  AgentRuntimePhase,
  AgentSendTurnRequest,
  AgentSendTurnResult,
  AgentSession,
  AgentSessionDetail,
  CommandApprovalSubmitRequest,
  PlanApprovalRequest,
  PlanInteractionResponse,
  PlanQuestionItem,
  PlanQuestionOption,
  PlanQuestionRequest,
  AgentToolCall,
  AgentTurn,
  AgentUsage
} from "./agent";
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
  CapabilityAiExposure,
  CapabilityApprovalDecision,
  CapabilityApprovalMode,
  CapabilityApprovalRequest,
  CapabilityApprovalResolution,
  CapabilityCallRequest,
  CapabilityCallResult,
  CapabilityDescriptor,
  CapabilityDomain,
  CapabilityEvent,
  CapabilityError,
  CapabilityApprovalResolveRequest,
  CapabilityInvokeRequest,
  CapabilityListRequest,
  CapabilityListResponse,
  CapabilityRegistrySnapshot,
  CapabilityReadRegistryResponse,
  CapabilityResolveApprovalResponse,
  CapabilityRuntimeEvent,
  LyraAppManifest
} from "./capabilities";
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
export type {
  WorkbenchBrowserAgentTargetInfo,
  WorkbenchBrowserElementPickerAppearance,
  WorkbenchBrowserElementPickerDisableCause,
  WorkbenchBrowserElementPickerOwner,
  WorkbenchBrowserElementPickerPhase,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserEvent,
  WorkbenchBrowserHoveredElementInfo,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageLayout,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserPageSpec,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserSetElementPickerModeRequest,
  WorkbenchBrowserTopologySnapshot
} from "./workbench-browser";
export type {
  BrowserTabObservation,
  DeepSearchObservation,
  FileEditorObservation,
  FileManagerObservation,
  SearchHomeObservation,
  SearchResultsObservation,
  TerminalObservation,
  WorkbenchObservedTabDescriptor,
  WorkbenchObservationDetail,
  WorkbenchObservationError,
  WorkbenchObservationErrorCode,
  WorkbenchObservationKind,
  WorkbenchObservationPageKind,
  WorkbenchObservationQueryRequest,
  WorkbenchObservationQueryResult,
  WorkbenchTabObservation,
  WorkbenchTabObservationResult,
  WorkbenchTabReadRequest,
  WorkbenchTabsListRequest,
  WorkbenchTabsListResult,
  WorkbenchVisualCaptureRequest,
  WorkbenchVisualCaptureResult,
  WorkbenchWorkspaceReadRequest,
  WorkbenchWorkspaceSnapshot
} from "./workbench-observation";

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
  localSearch: "lyra:search/local",
  localSearchStreamStart: "lyra:search/local-stream/start",
  localSearchStreamRead: "lyra:search/local-stream/read",
  localSearchStreamCancel: "lyra:search/local-stream/cancel",
  searchIndexStatus: "lyra:search/index-status",
  searchRebuildIndex: "lyra:search/rebuild-index",
  searchDeepStreamStart: "lyra:search/deep-stream/start",
  searchDeepStreamRead: "lyra:search/deep-stream/read",
  searchDeepStreamCancel: "lyra:search/deep-stream/cancel",
  searchDeepExpand: "lyra:search/deep-stream/expand",
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
  aiAuthorizeOpenAiChatGpt: "lyra:ai/authorize-openai-chatgpt",
  aiAuthorizeOpenAiChatGptDeviceCode: "lyra:ai/authorize-openai-chatgpt-device-code",
  aiUpsertProfile: "lyra:ai/upsert-profile",
  aiDeleteProfile: "lyra:ai/delete-profile",
  aiSetDefaultProfile: "lyra:ai/set-default-profile",
  aiValidateProfile: "lyra:ai/validate-profile",
  aiDiscoverModels: "lyra:ai/discover-models",
  aiRefreshDiscoveredModels: "lyra:ai/refresh-discovered-models",
  agentListSessions: "lyra:agent/list-sessions",
  agentCreateSession: "lyra:agent/create-session",
  agentGetSession: "lyra:agent/get-session",
  agentBindSessionProject: "lyra:agent/bind-session-project",
  agentDeleteSession: "lyra:agent/delete-session",
  agentSendTurn: "lyra:agent/send-turn",
  agentEnterPlanMode: "lyra:agent/enter-plan-mode",
  agentGetPlan: "lyra:agent/get-plan",
  agentGetPendingInteractions: "lyra:agent/get-pending-interactions",
  agentAnswerQuestion: "lyra:agent/answer-question",
  agentAnswerPlanQuestion: "lyra:agent/answer-plan-question",
  agentResolvePlanApproval: "lyra:agent/resolve-plan-approval",
  agentGetMemoryConfig: "lyra:agent/get-memory-config",
  agentUpdateMemoryConfig: "lyra:agent/update-memory-config",
  agentEvent: "lyra:agent/event",
  agentSubmitCommandApproval: "lyra:agent/submit-command-approval",
  workbenchBrowserSyncTopology: "lyra:workbench-browser/sync-topology",
  workbenchBrowserSyncLayout: "lyra:workbench-browser/sync-layout",
  workbenchBrowserNavigate: "lyra:workbench-browser/navigate",
  workbenchBrowserGoBack: "lyra:workbench-browser/go-back",
  workbenchBrowserGoForward: "lyra:workbench-browser/go-forward",
  workbenchBrowserReload: "lyra:workbench-browser/reload",
  workbenchBrowserStop: "lyra:workbench-browser/stop",
  workbenchBrowserReadPageState: "lyra:workbench-browser/read-page-state",
  workbenchBrowserSetElementPickerMode: "lyra:workbench-browser/set-element-picker-mode",
  workbenchBrowserEvent: "lyra:workbench-browser/event",
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
  terminalReadSession: "lyra:terminal/read-session",
  terminalResizeSession: "lyra:terminal/resize-session",
  terminalCloseSession: "lyra:terminal/close-session",
  terminalEvent: "lyra:terminal/event",
  capabilityReadRegistry: "lyra:capabilities/read-registry",
  capabilityList: "lyra:capabilities/list",
  capabilityInvoke: "lyra:capabilities/invoke",
  capabilityResolveApproval: "lyra:capabilities/resolve-approval",
  capabilityEvent: "lyra:capabilities/event",
  workbenchObservationQuery: "lyra:workbench-observation/query",
  workbenchObservationQueryResult: "lyra:workbench-observation/query-result",
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
  readonly endpoint?: string;
};

export type SearchOfficialCategory =
  | "official_homepage"
  | "official_subsite"
  | "official_docs"
  | "official_login"
  | "official_download"
  | "official_support";

export type SearchAggregateResult = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly displayUrl: string;
  readonly snippet: string;
  readonly sourceEngineIds: readonly string[];
  readonly isOfficialResult?: boolean;
  readonly officialCategory?: SearchOfficialCategory;
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

export type SearchLocalScopePreset = "home" | "full_system" | "workspace" | "custom";

export type SearchLocalRequest = {
  readonly query: string;
  readonly limit: number;
  readonly scopePreset: SearchLocalScopePreset;
  readonly customRoots?: readonly string[];
  readonly projectRoot?: string;
  readonly includeHidden?: boolean;
  readonly enableFuzzy?: boolean;
  readonly enableContent?: boolean;
  readonly enableExtensionMatch?: boolean;
};

export type SearchLocalResultItem = {
  readonly id: string;
  readonly path: string;
  readonly displayPath: string;
  readonly fileName: string;
  readonly extension?: string;
  readonly matchKind: "content" | "file_name" | "extension" | "path" | "fuzzy";
  readonly score: number;
  readonly snippet?: string;
  readonly line?: number;
  readonly modifiedAt?: number;
};

export type SearchLocalStats = {
  readonly scannedFiles: number;
  readonly scannedDirs: number;
  readonly contentScannedFiles: number;
  readonly matchedFiles: number;
  readonly skippedUnreadable: number;
  readonly skippedBinaryOrTooLarge: number;
  readonly usedIndex: boolean;
};

export type SearchLocalResponse = {
  readonly query: string;
  readonly scopePreset: SearchLocalScopePreset;
  readonly roots: readonly string[];
  readonly results: readonly SearchLocalResultItem[];
  readonly truncated: boolean;
  readonly elapsedMs: number;
  readonly stats: SearchLocalStats;
};

export type SearchLocalStreamStartRequest = SearchLocalRequest;

export type SearchLocalStreamStartResponse = {
  readonly streamId: string;
  readonly query: string;
  readonly scopePreset: SearchLocalScopePreset;
  readonly roots: readonly string[];
};

export type SearchLocalStreamReadRequest = {
  readonly streamId: string;
  readonly limit?: number;
};

export type SearchLocalStreamReadResponse = {
  readonly streamId: string;
  readonly query: string;
  readonly scopePreset: SearchLocalScopePreset;
  readonly roots: readonly string[];
  readonly results: readonly SearchLocalResultItem[];
  readonly truncated: boolean;
  readonly elapsedMs: number;
  readonly stats: SearchLocalStats;
  readonly done: boolean;
  readonly error?: string;
};

export type SearchLocalStreamCancelRequest = {
  readonly streamId: string;
};

export type SearchLocalStreamCancelResponse = {
  readonly removed: boolean;
};

export type SearchIndexStatusResponse = {
  readonly state: "idle" | "building" | "ready" | "failed";
  readonly indexedFiles: number;
  readonly indexedDirs: number;
  readonly lastBuiltAt?: string;
  readonly progress?: number;
  readonly error?: string;
};

export type SearchRebuildIndexRequest = {
  readonly scopePreset: SearchLocalScopePreset;
  readonly customRoots?: readonly string[];
  readonly projectRoot?: string;
  readonly includeHidden?: boolean;
  readonly force?: boolean;
};

export type SearchRebuildIndexResponse = {
  readonly status: SearchIndexStatusResponse;
  readonly scopePreset: SearchLocalScopePreset;
  readonly roots: readonly string[];
};

export type SearchDeepBudgetPreset = "low" | "medium" | "high";
export type SearchDeepCrawlPolicy = "accessibility_only";

export type SearchDeepNodeKind =
  | "root_query"
  | "derived_query"
  | "site_domain"
  | "site_subdomain"
  | "web_page"
  | "local_result";

export type SearchDeepEdgeKind =
  | "discovered_from"
  | "expanded_to"
  | "hosts_subdomain"
  | "contains_page"
  | "related_to";

export type SearchDeepEdgeReasonCode =
  | "web_match"
  | "local_match"
  | "query_expansion"
  | "semantic_overlap"
  | "domain_guess"
  | "domain_verify"
  | "subdomain_guess"
  | "sitemap_discovery"
  | "html_link_discovery"
  | "redirect_canonical";

export type SearchDeepNodeStatus = "loading" | "ready" | "error";

export type SearchDeepQueryNodeMetadata = {
  readonly query: string;
};

export type SearchDeepSiteDomainNodeMetadata = {
  readonly registrableDomain: string;
  readonly finalUrl: string;
  readonly verificationScore: number;
  readonly verifiedFrom: "result" | "guessed" | "redirect";
  readonly guessSources: readonly string[];
  readonly isOfficialResult?: boolean;
};

export type SearchDeepSiteSubdomainNodeMetadata = {
  readonly hostname: string;
  readonly registrableDomain: string;
  readonly finalUrl: string;
  readonly verificationScore: number;
  readonly discoveredBy: "result" | "guess" | "sitemap" | "html";
  readonly isOfficialResult?: boolean;
};

export type SearchDeepWebPageNodeMetadata = {
  readonly url: string;
  readonly canonicalUrl?: string;
  readonly hostname: string;
  readonly registrableDomain: string;
  readonly snippet?: string;
  readonly contentPreview?: string;
  readonly fetchDepth: number;
  readonly discoveredBy: "search" | "sitemap" | "html" | "redirect";
  readonly sourceEngineIds?: readonly string[];
  readonly isOfficialResult?: boolean;
};

export type SearchDeepLocalNodeMetadata = {
  readonly path: string;
  readonly displayPath: string;
  readonly snippet?: string;
  readonly line?: number;
  readonly extension?: string;
  readonly modifiedAt?: number;
  readonly matchKind?: "content" | "file_name" | "extension" | "path" | "fuzzy";
};

export type SearchDeepNodeMetadata = {
  readonly query?: string;
  readonly registrableDomain?: string;
  readonly finalUrl?: string;
  readonly verificationScore?: number;
  readonly verifiedFrom?: "result" | "guessed" | "redirect";
  readonly guessSources?: readonly string[];
  readonly hostname?: string;
  readonly discoveredBy?: "result" | "guess" | "sitemap" | "html" | "redirect" | "search";
  readonly url?: string;
  readonly canonicalUrl?: string;
  readonly snippet?: string;
  readonly contentPreview?: string;
  readonly fetchDepth?: number;
  readonly sourceEngineIds?: readonly string[];
  readonly isOfficialResult?: boolean;
  readonly officialCategory?: SearchOfficialCategory;
  readonly path?: string;
  readonly displayPath?: string;
  readonly line?: number;
  readonly extension?: string;
  readonly modifiedAt?: number;
  readonly matchKind?: "content" | "file_name" | "extension" | "path" | "fuzzy";
};

export type SearchDeepNode = {
  readonly id: string;
  readonly kind: SearchDeepNodeKind;
  readonly title: string;
  readonly subtitle?: string;
  readonly status: SearchDeepNodeStatus;
  readonly score?: number;
  readonly sourceKinds?: readonly ("web" | "local")[];
  readonly metadata?: SearchDeepNodeMetadata;
};

export type SearchDeepEdge = {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: SearchDeepEdgeKind;
  readonly reasonCode?: SearchDeepEdgeReasonCode;
  readonly metadata?: {
    readonly sharedTokens?: readonly string[];
    readonly overlapScore?: number;
    readonly sourceEngineIds?: readonly string[];
    readonly matchKind?: "content" | "file_name" | "extension" | "path" | "fuzzy";
    readonly line?: number;
    readonly seedQuery?: string;
    readonly derivedToken?: string;
    readonly guessSources?: readonly string[];
    readonly registrableDomain?: string;
    readonly finalUrl?: string;
    readonly discoveredBy?: "result" | "guess" | "sitemap" | "html" | "redirect" | "search";
  };
};

export type SearchDeepRequest = {
  readonly query: string;
  readonly budgetPreset: SearchDeepBudgetPreset;
  readonly scopePreset: SearchLocalScopePreset;
  readonly customRoots?: readonly string[];
  readonly projectRoot?: string;
  readonly includeHidden?: boolean;
  readonly enableFuzzy?: boolean;
  readonly enableContent?: boolean;
  readonly enableExtensionMatch?: boolean;
  readonly engines: readonly SearchAggregateEngine[];
  readonly enableSiteExpansion?: boolean;
  readonly enableProactiveDomainGuessing?: boolean;
  readonly crawlPolicy?: SearchDeepCrawlPolicy;
};

export type SearchDeepSnapshot = {
  readonly query: string;
  readonly budgetPreset: SearchDeepBudgetPreset;
  readonly phase: "bootstrapping" | "streaming" | "completed" | "error";
  readonly nodes: readonly SearchDeepNode[];
  readonly edges: readonly SearchDeepEdge[];
  readonly web: {
    readonly status: "idle" | "loading" | "ready" | "error";
    readonly engineBuckets: readonly SearchAggregateEngineBucket[];
    readonly blendedCount: number;
    readonly siteExpansion?: {
      readonly status: "idle" | "loading" | "ready" | "error";
      readonly domainCandidates: number;
      readonly verifiedDomains: number;
      readonly discoveredSubdomains: number;
      readonly visitedPages: number;
      readonly queuedPages: number;
      readonly droppedPages: number;
      readonly guessAttempts: number;
      readonly error?: string;
    };
    readonly error?: string;
  };
  readonly local: {
    readonly status: "idle" | "loading" | "ready" | "error";
    readonly scopePreset: SearchLocalScopePreset;
    readonly roots: readonly string[];
    readonly elapsedMs: number;
    readonly stats: SearchLocalStats;
    readonly indexStatus?: SearchIndexStatusResponse;
    readonly error?: string;
  };
  readonly stats: {
    readonly dedupedResults: number;
    readonly derivedQueries: number;
    readonly expansionRounds: number;
  };
  readonly lastUpdatedAt: string;
};

export type SearchDeepStreamStartRequest = SearchDeepRequest;

export type SearchDeepStreamStartResponse = {
  readonly streamId: string;
  readonly snapshot: SearchDeepSnapshot;
};

export type SearchDeepStreamReadRequest = {
  readonly streamId: string;
};

export type SearchDeepStreamReadResponse = {
  readonly streamId: string;
  readonly snapshot: SearchDeepSnapshot;
  readonly done: boolean;
  readonly error?: string;
};

export type SearchDeepStreamCancelRequest = {
  readonly streamId: string;
};

export type SearchDeepStreamCancelResponse = {
  readonly removed: boolean;
};

export type SearchDeepExpandRequest = {
  readonly streamId: string;
  readonly nodeId: string;
};

export type SearchDeepExpandResponse = {
  readonly streamId: string;
  readonly accepted: boolean;
};

export type TerminalSessionId = string;

export type TerminalCommandSource = "user" | "ai" | "capability";
export type TerminalSessionMode = "command" | "shell";

export type TerminalCreateRequest = {
  readonly sessionId?: TerminalSessionId;
  readonly title?: string;
  readonly cwd?: string;
  readonly shell?: string;
  readonly mode?: TerminalSessionMode;
  readonly command?: string;
  readonly persist?: boolean;
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
  readonly source?: TerminalCommandSource;
  readonly mode?: TerminalSessionMode;
  readonly command?: string;
  readonly persist?: boolean;
  readonly running?: boolean;
  readonly exitCode?: number | null;
};

export type TerminalWriteRequest = {
  readonly sessionId: TerminalSessionId;
  readonly data?: string;
  readonly text?: string;
  readonly keys?: readonly (
    | "enter"
    | "escape"
    | "tab"
    | "ctrl_c"
    | "ctrl_d"
    | "up"
    | "down"
    | "left"
    | "right"
    | "page_up"
    | "page_down"
    | "home"
    | "end"
  )[];
  readonly appendNewline?: boolean;
  readonly source: TerminalCommandSource;
};

export type TerminalReadRequest = {
  readonly sessionId: TerminalSessionId;
  readonly cursor?: string;
  readonly maxBytes?: number;
  readonly waitMs?: number;
};

export type TerminalReadResponse = {
  readonly sessionId: TerminalSessionId;
  readonly cursor: string;
  readonly output: string;
  readonly running: boolean;
  readonly exitCode: number | null;
  readonly truncated: boolean;
  readonly source: TerminalCommandSource;
  readonly mode: TerminalSessionMode;
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
  readonly local: (request: SearchLocalRequest) => Promise<SearchLocalResponse>;
  readonly startLocalStream: (
    request: SearchLocalStreamStartRequest
  ) => Promise<SearchLocalStreamStartResponse>;
  readonly readLocalStream: (
    request: SearchLocalStreamReadRequest
  ) => Promise<SearchLocalStreamReadResponse>;
  readonly cancelLocalStream: (
    request: SearchLocalStreamCancelRequest
  ) => Promise<SearchLocalStreamCancelResponse>;
  readonly readIndexStatus: () => Promise<SearchIndexStatusResponse>;
  readonly rebuildIndex: (
    request: SearchRebuildIndexRequest
  ) => Promise<SearchRebuildIndexResponse>;
  readonly startDeepStream: (
    request: SearchDeepStreamStartRequest
  ) => Promise<SearchDeepStreamStartResponse>;
  readonly readDeepStream: (
    request: SearchDeepStreamReadRequest
  ) => Promise<SearchDeepStreamReadResponse>;
  readonly cancelDeepStream: (
    request: SearchDeepStreamCancelRequest
  ) => Promise<SearchDeepStreamCancelResponse>;
  readonly expandDeepNode: (
    request: SearchDeepExpandRequest
  ) => Promise<SearchDeepExpandResponse>;
};

export type AiApi = {
  readonly readProfiles: () => Promise<readonly AiProviderProfile[]>;
  readonly readProviderCatalog: () => Promise<readonly AiProviderCatalogItem[]>;
  readonly readPresetCatalog: () => Promise<readonly AiProviderPreset[]>;
  readonly authorizeOpenAiChatGpt: () => Promise<AiOpenAiChatGptAuthResult>;
  readonly authorizeOpenAiChatGptDeviceCode: () => Promise<AiOpenAiChatGptAuthResult>;
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
};

export type AgentApi = {
  readonly listSessions: () => Promise<readonly AgentSession[]>;
  readonly createSession: (request?: AgentCreateSessionRequest) => Promise<AgentSession>;
  readonly getSession: (request: AgentGetSessionRequest) => Promise<AgentSessionDetail>;
  readonly bindSessionProject: (
    request: AgentBindSessionProjectRequest
  ) => Promise<AgentSession>;
  readonly deleteSession: (request: AgentDeleteSessionRequest) => Promise<void>;
  readonly sendTurn: (request: AgentSendTurnRequest) => Promise<AgentSendTurnResult>;
  readonly enterPlanMode: (request: AgentEnterPlanModeRequest) => Promise<AgentSessionDetail>;
  readonly getPlan: (request: AgentGetPlanRequest) => Promise<AgentPlanState | null>;
  readonly getPendingInteractions: (
    request: AgentGetPendingInteractionsRequest
  ) => Promise<readonly AgentPendingInteraction[]>;
  readonly answerQuestion: (request: AgentAnswerQuestionRequest) => Promise<void>;
  readonly answerPlanQuestion: (request: AgentAnswerPlanQuestionRequest) => Promise<void>;
  readonly resolvePlanApproval: (
    request: AgentResolvePlanApprovalRequest
  ) => Promise<AgentSendTurnResult | null>;
  readonly getMemoryConfig: () => Promise<AiMemoryConfig>;
  readonly updateMemoryConfig: (config: AiMemoryConfig) => Promise<AiMemoryConfig>;
  readonly submitCommandApproval: (request: CommandApprovalSubmitRequest) => Promise<void>;
  readonly onEvent: (listener: (event: AgentRuntimeEvent) => void) => () => void;
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

export type WorkbenchBrowserApi = {
  readonly syncTopology: (
    snapshot: WorkbenchBrowserTopologySnapshot
  ) => Promise<void>;
  readonly syncLayout: (
    snapshot: WorkbenchBrowserLayoutSnapshot
  ) => Promise<void>;
  readonly navigate: (
    request: WorkbenchBrowserNavigateRequest
  ) => Promise<WorkbenchBrowserNavigateResult>;
  readonly goBack: (request: { readonly tabId: string }) => Promise<void>;
  readonly goForward: (request: { readonly tabId: string }) => Promise<void>;
  readonly reload: (
    request: { readonly tabId: string; readonly ignoreCache?: boolean }
  ) => Promise<void>;
  readonly stop: (request: { readonly tabId: string }) => Promise<void>;
  readonly readPageState: (
    request?: WorkbenchBrowserReadPageStateRequest
  ) => Promise<WorkbenchBrowserPageRuntimeState | null>;
  readonly setElementPickerMode: (
    request: WorkbenchBrowserSetElementPickerModeRequest
  ) => Promise<void>;
  readonly onEvent: (listener: (event: WorkbenchBrowserEvent) => void) => () => void;
};

export type TerminalApi = {
  readonly createSession: (request: TerminalCreateRequest) => Promise<TerminalSessionSnapshot>;
  readonly restoreSessions: (request: TerminalRestoreRequest) => Promise<readonly TerminalSessionSnapshot[]>;
  readonly reloadPrompt: (request: TerminalReloadPromptRequest) => Promise<TerminalReloadPromptResult>;
  readonly write: (request: TerminalWriteRequest) => Promise<void>;
  readonly read: (request: TerminalReadRequest) => Promise<TerminalReadResponse>;
  readonly resize: (request: TerminalResizeRequest) => Promise<void>;
  readonly closeSession: (request: TerminalCloseRequest) => Promise<void>;
  readonly onData: (listener: (event: TerminalDataEvent) => void) => () => void;
  readonly onExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  readonly onError: (listener: (event: TerminalErrorEvent) => void) => () => void;
};

export type CapabilitiesApi = {
  readonly readRegistry: () => Promise<CapabilityReadRegistryResponse>;
  readonly listCapabilities: (
    request?: CapabilityListRequest
  ) => Promise<readonly CapabilityDescriptor[]>;
  readonly invokeCapability: (
    request: CapabilityInvokeRequest
  ) => Promise<CapabilityCallResult>;
  readonly resolveApproval: (
    request: CapabilityApprovalResolveRequest
  ) => Promise<CapabilityResolveApprovalResponse>;
  readonly onEvent: (listener: (event: CapabilityRuntimeEvent) => void) => () => void;
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

export type WorkbenchObservationBridgeApi = {
  readonly registerHandler: (
    handler: (
      request: WorkbenchObservationQueryRequest
    ) => Promise<WorkbenchObservationQueryResult> | WorkbenchObservationQueryResult
  ) => () => void;
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
  readonly agent?: AgentApi;
  readonly workbenchBrowser: WorkbenchBrowserApi;
  readonly mcp: McpApi;
  readonly skills: SkillsApi;
  readonly lsp: LspApi;
  readonly terminal: TerminalApi;
  readonly capabilities: CapabilitiesApi;
  readonly workbenchObservation: WorkbenchObservationBridgeApi;
  readonly workbenchState: WorkbenchStateApi;
};
