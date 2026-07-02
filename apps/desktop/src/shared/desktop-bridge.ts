import type {
  FileManagerCreateFileRequest,
  FileManagerCreateFolderRequest,
  FileManagerDirectoryMutationResponse,
  FileManagerDirectoryPatch,
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
  FileManagerSelectedAttachment,
  FileManagerSubscribeDirectoryRequest,
  FileManagerSubscribeDirectoryResponse,
  FileWriteResult,
  FileWriteTextRequest
} from "./file-manager";
import type {
  DownloadManagerBatchRequest,
  DownloadManagerEnqueueRequest,
  DownloadManagerEvent,
  DownloadManagerRemoteApiStartRequest,
  DownloadManagerRemoteApiStatus,
  DownloadManagerSetPriorityRequest,
  DownloadManagerSettings,
  DownloadManagerSnapshot,
  DownloadManagerTask,
  DownloadManagerTaskRequest,
  DownloadManagerUpdateSettingsRequest
} from "./download-manager";
import type {
  ImageViewerCloseSessionRequest,
  ImageViewerEvent,
  ImageViewerOpenRequest,
  ImageViewerOpenResult,
  ImageViewerReadTileRequest,
  ImageViewerTileResponse
} from "./image-viewer";
import type { TerminalThemePresetId } from "./terminal-theme";
import type {
  BrowserSessionSnapshot,
  BrowserStorageStateRef,
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserClearSiteDataRequest,
  WorkbenchBrowserClearSiteDataResult,
  WorkbenchBrowserElementPickerAppearance,
  WorkbenchBrowserElementPickerDisableCause,
  WorkbenchBrowserElementPickerMode,
  WorkbenchBrowserElementPickerOwner,
  WorkbenchBrowserElementPickerPhase,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserAgentElevationCompletionResult,
  WorkbenchBrowserAgentElevationResult,
  WorkbenchBrowserAgentActivityEvent,
  WorkbenchBrowserAuthChallengeSignal,
  WorkbenchBrowserElevationSession,
  WorkbenchBrowserPageDiagnosticsResult,
  WorkbenchBrowserPageRestoreState,
  WorkbenchBrowserSharedControlEvent,
  WorkbenchBrowserSharedControlStateEvent,
  WorkbenchLumenActivityEvent,
  WorkbenchLumenFollowAction,
  WorkbenchLumenFollowAudit,
  WorkbenchLumenFollowFrame,
  WorkbenchLumenFollowSessionStatus,
  WorkbenchLumenStaleTarget,
  WorkbenchLumenTargetCandidate,
  WorkbenchLumenTargetExplanation,
  WorkbenchLumenTargetKind,
  WorkbenchLumenTargetRef,
  WorkbenchLumenTargetStaleReason,
  WorkbenchBrowserEvent,
  WorkbenchBrowserExecutePageContextActionRequest,
  WorkbenchBrowserHoveredElementInfo,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserSearchInPageRequest,
  WorkbenchBrowserSearchInPageResult,
  WorkbenchBrowserSetElementPickerModeRequest,
  WorkbenchBrowserStorageStateRequest,
  WorkbenchBrowserTopologySnapshot,
  PageDragCitationPayload
} from "./workbench-browser";
import type {
  WorkbenchObservationQueryRequest,
  WorkbenchObservationQueryResult,
  WorkbenchVisualCaptureRequest,
  WorkbenchVisualCaptureResult
} from "./workbench-observation";
import type {
  InstalledUiuxPack,
  UiuxInstallFromGitRequest,
  UiuxInstallFromLocalRequest,
  UiuxInstallFromNpmRequest,
  UiuxListPacksResponse,
  UiuxPackRuntime,
  UiuxRequestActivationRequest,
  UiuxRequestActivationResponse,
  UiuxResolveRuntimeRequest,
  UiuxSetTrustStateRequest,
  UiuxUninstallRequest,
  UiuxUninstallResponse
} from "./uiux-packs";
import type {
  SoftwareCapabilitiesQueryRequest,
  SoftwareCapabilitiesQueryResult
} from "./software-capabilities";
import type {
  LoginManagerApi
} from "./login-manager";
import type {
  LyraSensitiveValueApi
} from "./sensitive-value";
import type { AgentApi } from "./agent";

export type {
  AgentApi,
  AgentBrowserFollowModeSnapshot,
  AgentBrowserFollowModeUpdateRequest,
  AgentClarificationRespondRequest,
  AgentFollowState,
  AgentGitChangedFile,
  AgentGitDiffRequest,
  AgentGitDiffResponse,
  AgentGitDiffScope,
  AgentGitFileRequest,
  AgentGitFileStatus,
  AgentGitMutationResponse,
  AgentGitStatusRequest,
  AgentGitStatusSnapshot,
  AgentGitStatusSummary,
  AgentImageAttachmentMaterializeRequest,
  AgentImageAttachmentMaterializeResponse,
  AgentImageInput,
  AgentMemoryAuditResponse,
  AgentMemorySharedSearchRequest,
  AgentMemorySharedUpdateRequest,
  AgentMemorySnapshot,
  AgentMessage,
  AgentMessageResolveRequest,
  AgentMessageResolveResponse,
  AgentPermissionRespondRequest,
  AgentPrivateTerminalCloseRequest,
  AgentPrivateTerminalListRequest,
  AgentPrivateTerminalSnapshot,
  AgentPlanAnnotation,
  AgentPlanPhase,
  AgentPlanReviseRequest,
  AgentPlanReviewRespondAction,
  AgentPlanReviewRespondRequest,
  AgentPlanReviewSnapshot,
  AgentPlanReviewStatus,
  AgentPlanSnapshot,
  AgentPlanVersionSnapshot,
  AgentProjectPlanDeleteRequest,
  AgentProjectPlanDeleteResponse,
  AgentProjectPlanListRequest,
  AgentProjectPlanListResponse,
  AgentProjectPlanReadRequest,
  AgentProjectPlanReadResponse,
  AgentProjectPlanRecord,
  AgentProjectPlanSummary,
  AgentProjectTodoSnapshot,
  AgentProjectTodoStatus,
  AgentProjectTodoReadRequest,
  AgentProjectTodoReadResponse,
  AgentRollbackPreviewResponse,
  AgentRollbackRequest,
  AgentRollbackRestoreResponse,
  AgentRole,
  AgentRuntimeEvent,
  AgentSessionArchiveRequest,
  AgentSessionBindProjectRequest,
  AgentSessionCreateRequest,
  AgentTemporarySessionCreateRequest,
  AgentSessionDeleteRequest,
  AgentSessionDeleteResponse,
  AgentSessionReadRequest,
  AgentSessionRenameRequest,
  AgentSessionSaveRequest,
  AgentSessionSnapshot,
  AgentSessionKind,
  AgentTodoItem,
  AgentToolActivity,
  AgentToolStatus,
  AgentTurnCancelRequest,
  AgentTurnCancelResponse,
  AgentTurnSendRequest,
  AgentTurnSendResponse,
  AgentCodegraphStatus,
  AgentConfigSnapshot,
  AgentConfigUpdateRequest,
  AgentAccountLoginCompleteRequest,
  AgentAccountLoginCompleteResponse,
  AgentAccountLoginRequest,
  AgentAccountLoginStartRequest,
  AgentAccountLoginStartResponse,
  AgentAccountRequest,
  AgentAccountSnapshot,
  AgentAccountsSnapshot,
  AgentActionRunRequest,
  AgentFeedbackRunRequest,
  AgentLoginProviderSnapshot,
  AgentLoginProviderCatalogSnapshot,
  AgentModelEntry,
  AgentModelDeleteRequest,
  AgentModelEnableRequest,
  AgentModelRefreshRequest,
  AgentModelRoute,
  AgentModelCatalogRequest,
  AgentModelCatalogSnapshot,
  AgentModelSwitchRequest,
  AgentMcpListResponse,
  AgentMcpServerMutationResponse,
  AgentMcpServerRemoveResponse,
  AgentMcpServerRequest,
  AgentMcpServerUpsertRequest,
  AgentMcpToolDiscoverRequest,
  AgentMcpToolDiscoverResponse,
  AgentMcpServer,
  AgentMcpToolInfo,
  AgentMcpTransport,
  AgentProviderCapabilitySummary,
  AgentProviderCatalogProfile,
  AgentProviderCatalogSnapshot,
  AgentPermissionPolicySetModeRequest,
  AgentPermissionPolicySnapshot,
  AgentProviderOptionState,
  AgentProviderProtocolEntry,
  AgentProviderOptionsUpdateRequest,
  AgentProviderProfileSaveRequest,
  AgentProviderRouteEntry,
  AgentPokeRequest,
  AgentPokeResponse,
  AgentRegisteredCommand,
  AgentSessionSummary,
  AgentSessionListRequest,
  AgentSessionListResponse,
  AgentProtocolContract,
  AgentInstalledSkill,
  AgentSkillActivationRequest,
  AgentSkillInspectRequest,
  AgentSkillInspectResponse,
  AgentSkillInstallFromGitRequest,
  AgentSkillInstallFromLocalRequest,
  AgentSkillInstallFromStoreRequest,
  AgentSkillManifest,
  AgentSkillMutationResponse,
  AgentSkillRefreshStoreRequest,
  AgentSkillsListResponse,
  AgentSkillSource,
  AgentSkillStoreEntry,
  AgentSkillStoreIndex,
  AgentSkillStoreResponse,
  AgentSkillStoreSnapshot,
  AgentSkillUninstallRequest,
  AgentSkillUninstallResponse,
  EXPECTED_PROTOCOL_VERSION
} from "./agent";
export type {
  ImageViewerCloseSessionRequest,
  ImageViewerEvent,
  ImageViewerLevel,
  ImageViewerOpenRequest,
  ImageViewerOpenResult,
  ImageViewerReadTileRequest,
  ImageViewerTileResponse
} from "./image-viewer";
export type {
  DownloadManagerBtTaskOptions,
  DownloadManagerChecksum,
  DownloadManagerChecksumAlgorithm,
  DownloadManagerBatchRequest,
  DownloadManagerEnqueueRequest,
  DownloadManagerEvent,
  DownloadManagerPriority,
  DownloadManagerRemoteApiStartRequest,
  DownloadManagerRemoteApiStatus,
  DownloadManagerSaveRule,
  DownloadManagerSetPriorityRequest,
  DownloadManagerSettings,
  DownloadManagerSnapshot,
  DownloadManagerTask,
  DownloadManagerTaskRequest,
  DownloadManagerTaskSource,
  DownloadManagerTaskState,
  DownloadManagerUpdateSettingsRequest
} from "./download-manager";
export type {
  LyraPerformanceActivitySignals,
  LyraPerformanceDecisionKind,
  LyraPerformanceIsolationFlags,
  LyraPerformanceKernelEvent,
  LyraPerformanceResourceDescriptor,
  LyraPerformanceResourceKind,
  LyraPerformanceResourceLifecycle
} from "./performance-kernel";
export type {
  BrowserActiveElementRef,
  BrowserElementBounds,
  BrowserFormDraftFieldMetadata,
  BrowserFormDraftMetadata,
  BrowserNavigationHistory,
  BrowserNavigationHistoryEntry,
  BrowserPageLoadState,
  BrowserRecoveryAnchor,
  BrowserSessionSnapshot,
  BrowserSessionTabSnapshot,
  BrowserSiteStorageAvailability,
  BrowserStorageAvailability,
  BrowserStorageScopeManifest,
  BrowserStorageStateRef,
  BrowserTargetRegistryManifest,
  BrowserViewportState,
  WorkbenchBrowserCertificateInfo,
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserChromeSecurityPopoverPayload,
  WorkbenchBrowserClearSiteDataRequest,
  WorkbenchBrowserClearSiteDataResult,
  WorkbenchBrowserClientRect,
  WorkbenchBrowserElementPickerAppearance,
  WorkbenchBrowserElementPickerDisableCause,
  WorkbenchBrowserElementPickerMode,
  WorkbenchBrowserElementPickerOwner,
  WorkbenchBrowserElementPickerPhase,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserAgentElevationCompletionResult,
  WorkbenchBrowserAgentElevationResult,
  WorkbenchBrowserAuthChallengeSignal,
  WorkbenchBrowserElevationSession,
  WorkbenchBrowserAgentActivityEvent,
  WorkbenchBrowserPageDiagnosticEntry,
  WorkbenchBrowserPageDiagnosticsResult,
  WorkbenchBrowserPageRestoreState,
  WorkbenchBrowserProfileMode,
  WorkbenchBrowserRecoveryFailure,
  WorkbenchBrowserRecoveryFailureReason,
  WorkbenchBrowserSecurityLevel,
  WorkbenchBrowserSecurityLocale,
  WorkbenchBrowserSharedControlEvent,
  WorkbenchBrowserSharedControlStateEvent,
  WorkbenchLumenActivityEvent,
  WorkbenchLumenFollowAction,
  WorkbenchLumenFollowAudit,
  WorkbenchLumenFollowFrame,
  WorkbenchLumenFollowSessionStatus,
  WorkbenchLumenStaleTarget,
  WorkbenchLumenTargetCandidate,
  WorkbenchLumenTargetExplanation,
  WorkbenchLumenTargetKind,
  WorkbenchLumenTargetRef,
  WorkbenchLumenTargetStaleReason,
  WorkbenchBrowserEvent,
  WorkbenchBrowserExecutePageContextActionRequest,
  WorkbenchBrowserHoveredElementInfo,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageLayout,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserPageSpec,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserSearchInPageMatch,
  WorkbenchBrowserSearchInPageRequest,
  WorkbenchBrowserSearchInPageResult,
  WorkbenchBrowserSetElementPickerModeRequest,
  WorkbenchBrowserStorageStateRequest,
  WorkbenchBrowserTopologySnapshot,
  WorkbenchBrowserWebThemePalette,
  WorkbenchBrowserWebThemeSnapshot
} from "./workbench-browser";
export type {
  BrowserTabObservation,
  FileEditorObservation,
  FileManagerObservation,
  ImageViewerObservation,
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
  WorkbenchTerminalCloseRequest,
  WorkbenchTerminalCloseResult,
  WorkbenchTerminalFocusRequest,
  WorkbenchTerminalFocusResult,
  WorkbenchTerminalListRequest,
  WorkbenchTerminalListResult,
  WorkbenchTerminalOpenRequest,
  WorkbenchTerminalOpenResult,
  WorkbenchTerminalPaneDescriptor,
  WorkbenchTerminalPlacement,
  WorkbenchVisualCaptureRequest,
  WorkbenchVisualCaptureResult,
  WorkbenchWorkspaceReadRequest,
  WorkbenchWorkspaceSnapshot
} from "./workbench-observation";
export type {
  LyraCapabilityRisk,
  LyraSoftwareActionContext,
  LyraSoftwareActionHandler,
  LyraSoftwareActionManifest,
  LyraSoftwareCapabilitiesContext,
  LyraSoftwareManifest,
  SoftwareCapabilitiesQueryRequest,
  SoftwareCapabilitiesQueryResult,
  SoftwareInspectCapabilityRequest,
  SoftwareInspectCapabilityResponse,
  SoftwareInvokeCapabilityRequest,
  SoftwareInvokeCapabilityResponse,
  SoftwareListCapabilitiesRequest,
  SoftwareListCapabilitiesResponse,
  SoftwareReadStateRequest,
  SoftwareReadStateResponse
} from "./software-capabilities";
export type {
  LoginManagerApi,
  LoginManagerAuthMethod,
  LoginManagerAuthMethodKind,
  LoginManagerClearSiteRequest,
  LoginManagerClearSiteResponse,
  LoginManagerCredential,
  LoginManagerDeleteCredentialRequest,
  LoginManagerEvent,
  LoginManagerFactSource,
  LoginManagerFillCredentialRequest,
  LoginManagerFillCredentialResponse,
  LoginManagerRevealCredentialRequest,
  LoginManagerRevealCredentialResponse,
  LoginManagerSession,
  LoginManagerSessionSignals,
  LoginManagerSessionStatus,
  LoginManagerSnapshot,
  LoginManagerUpdateSessionRequest
} from "./login-manager";
export type {
  LyraSensitiveValueApi,
  LyraSensitiveValueCapability,
  LyraSensitiveValueKind,
  LyraSensitiveValueOwner,
  LyraSensitiveValueOwnerRef,
  LyraSensitiveValueOwnership,
  LyraSensitiveValuePlaintextVisibility,
  LyraSensitiveValueRef,
  LyraSensitiveValueRevealRequest,
  LyraSensitiveValueRevealResponse,
  LyraSensitiveValueStoreRequest,
  LyraSensitiveValueStoreResponse
} from "./sensitive-value";
export type {
  BuiltinUiuxPackSummary,
  InstalledUiuxPack,
  UiuxInstallFromGitRequest,
  UiuxInstallFromLocalRequest,
  UiuxInstallFromNpmRequest,
  UiuxListPacksResponse,
  UiuxPackManifest,
  UiuxPackRuntime,
  UiuxPackSource,
  UiuxPackTrustState,
  UiuxRequestActivationRequest,
  UiuxRequestActivationResponse,
  UiuxResolveRuntimeRequest,
  UiuxSetTrustStateRequest,
  UiuxUninstallRequest,
  UiuxUninstallResponse
} from "./uiux-packs";

export const LYRA_CHANNELS = {
  minimizeWindow: "lyra:shell/window/minimize",
  toggleWindowMaximize: "lyra:shell/window/toggle-maximize",
  closeWindow: "lyra:shell/window/close",
  readAppMeta: "lyra:shell/app/meta",
  readAppMetaSync: "lyra:shell/app/meta-sync",
  openExternal: "lyra:shell/open-external",
  detectEditors: "lyra:shell/detect-editors",
  openInEditor: "lyra:shell/open-in-editor",
  revealInFolder: "lyra:shell/reveal-in-folder",
  legalReadThirdPartyNotices: "lyra:legal/read-third-party-notices",
  identityReadUserIcon: "lyra:identity/read-user-icon",
  identityResolveProject: "lyra:identity/resolve-project",
  systemNotificationsReadStatus: "lyra:system-notifications/read-status",
  systemNotificationsShow: "lyra:system-notifications/show",
  systemNotificationsOpenSettings: "lyra:system-notifications/open-settings",
  systemNotificationsActivated: "lyra:system-notifications/activated",
  linuxCompatReadStatus: "lyra:linux-compat/read-status",
  linuxCompatReadConfig: "lyra:linux-compat/read-config",
  linuxCompatUpdateConfig: "lyra:linux-compat/update-config",
  linuxCompatRestart: "lyra:linux-compat/restart",
  windowStateChanged: "lyra:shell/window/state-changed",
  resolveWebSearchEngine: "lyra:search/resolve-web-engine",
  filesReadHome: "lyra:files/read-home",
  filesReadDirectory: "lyra:files/read-directory",
  filesSubscribeDirectory: "lyra:files/subscribe-directory",
  filesUnsubscribeDirectory: "lyra:files/unsubscribe-directory",
  filesDirectoryPatch: "lyra:files/directory-patch",
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
  filesSelectAttachments: "lyra:files/select-attachments",
  filesSelectDirectories: "lyra:files/select-directories",
  downloadsList: "lyra:downloads/list",
  downloadsEnqueue: "lyra:downloads/enqueue",
  downloadsImportExternalBrowser: "lyra:downloads/import-external-browser",
  downloadsPause: "lyra:downloads/pause",
  downloadsResume: "lyra:downloads/resume",
  downloadsCancel: "lyra:downloads/cancel",
  downloadsRetry: "lyra:downloads/retry",
  downloadsRemove: "lyra:downloads/remove",
  downloadsSetPriority: "lyra:downloads/set-priority",
  downloadsPauseAll: "lyra:downloads/pause-all",
  downloadsResumeAll: "lyra:downloads/resume-all",
  downloadsCancelAll: "lyra:downloads/cancel-all",
  downloadsReadSettings: "lyra:downloads/settings/read",
  downloadsUpdateSettings: "lyra:downloads/settings/update",
  downloadsRemoteStatus: "lyra:downloads/remote/status",
  downloadsRemoteStart: "lyra:downloads/remote/start",
  downloadsRemoteStop: "lyra:downloads/remote/stop",
  downloadsOpenFile: "lyra:downloads/open-file",
  downloadsRevealFile: "lyra:downloads/reveal-file",
  downloadsEvent: "lyra:downloads/event",
  imageViewerOpenImage: "lyra:image-viewer/open-image",
  imageViewerReadTile: "lyra:image-viewer/read-tile",
  imageViewerCloseSession: "lyra:image-viewer/close-session",
  imageViewerEvent: "lyra:image-viewer/event",
  workbenchBrowserSyncTopology: "lyra:workbench-browser/sync-topology",
  workbenchBrowserSyncLayout: "lyra:workbench-browser/sync-layout",
  workbenchBrowserNavigate: "lyra:workbench-browser/navigate",
  workbenchBrowserGoBack: "lyra:workbench-browser/go-back",
  workbenchBrowserGoForward: "lyra:workbench-browser/go-forward",
  workbenchBrowserReload: "lyra:workbench-browser/reload",
  workbenchBrowserStop: "lyra:workbench-browser/stop",
  workbenchBrowserReadPageState: "lyra:workbench-browser/read-page-state",
  workbenchBrowserReadSessionSnapshot: "lyra:workbench-browser/read-session-snapshot",
  workbenchBrowserReadStorageState: "lyra:workbench-browser/read-storage-state",
  workbenchBrowserClearSiteData: "lyra:workbench-browser/clear-site-data",
  workbenchBrowserSearchInPage: "lyra:workbench-browser/search-in-page",
  workbenchBrowserSetChromePopover: "lyra:workbench-browser/set-chrome-popover",

  workbenchBrowserSetElementPickerMode: "lyra:workbench-browser/set-element-picker-mode",
  workbenchBrowserSetModalOcclusion: "lyra:workbench-browser/set-modal-occlusion",
  workbenchBrowserCapturePage: "lyra:workbench-browser/capture-page",
  workbenchBrowserCaptureWindow: "lyra:workbench-browser/capture-window",
  workbenchBrowserExecutePageContextAction: "lyra:workbench-browser/execute-page-context-action",
  workbenchBrowserEvent: "lyra:workbench-browser/event",
  workbenchBrowserPageDragCitation: "lyra:workbench-browser/page-drag-citation",
  workbenchBrowserReadActivePageDragCitation:
    "lyra:workbench-browser/read-active-page-drag-citation",
  workbenchBrowserConsumePageDragCitation:
    "lyra:workbench-browser/consume-page-drag-citation",
  workbenchBrowserResolvePageTabId: "lyra:workbench-browser/resolve-page-tab-id",
  loginManagerList: "lyra:login-manager/list",
  loginManagerUpdateSession: "lyra:login-manager/update-session",
  loginManagerDeleteCredential: "lyra:login-manager/delete-credential",
  loginManagerRevealCredential: "lyra:login-manager/reveal-credential",
  loginManagerFillCredential: "lyra:login-manager/fill-credential",
  loginManagerClearSite: "lyra:login-manager/clear-site",
  loginManagerEvent: "lyra:login-manager/event",
  sensitiveValuesRevealToUser: "lyra:sensitive-values/reveal-to-user",
  sensitiveValuesStore: "lyra:sensitive-values/store",
  lspOpenDocument: "lyra:lsp/open-document",
  lspChangeDocument: "lyra:lsp/change-document",
  lspSaveDocument: "lyra:lsp/save-document",
  lspCloseDocument: "lyra:lsp/close-document",
  lspCompletion: "lyra:lsp/completion",
  lspEvent: "lyra:lsp/event",
  terminalCreateSession: "lyra:terminal/create-session",
  terminalRestoreSessions: "lyra:terminal/restore-sessions",
  terminalConnectDataPort: "lyra:terminal/connect-data-port",
  terminalDataPort: "lyra:terminal/data-port",
  terminalAttachRenderer: "lyra:terminal/attach-renderer",
  terminalDetachRenderer: "lyra:terminal/detach-renderer",
  terminalAckData: "lyra:terminal/ack-data",
  terminalReloadPrompt: "lyra:terminal/reload-prompt",
  terminalWriteSession: "lyra:terminal/write-session",
  terminalReadSession: "lyra:terminal/read-session",
  terminalReadMemoryTimeline: "lyra:terminal/read-memory-timeline",
  terminalReadEvents: "lyra:terminal/read-events",
  terminalReadCommands: "lyra:terminal/read-commands",
  terminalReadOutputRange: "lyra:terminal/read-output-range",
  terminalListArtifacts: "lyra:terminal/list-artifacts",
  terminalReadScreen: "lyra:terminal/read-screen",
  terminalWaitUntil: "lyra:terminal/wait-until",
  terminalInputExecute: "lyra:terminal/input-execute",
  terminalPermissionsEvaluate: "lyra:terminal/permissions/evaluate",
  terminalPermissionsRespond: "lyra:terminal/permissions/respond",
  terminalProcessesRead: "lyra:terminal/processes/read",
  terminalProcessesSignal: "lyra:terminal/processes/signal",
  terminalCommandStatus: "lyra:terminal/command/status",
  terminalCommandWait: "lyra:terminal/command/wait",
  terminalCommandReadOutput: "lyra:terminal/command/read-output",
  terminalMapRead: "lyra:terminal/map/read",
  terminalActExecute: "lyra:terminal/act/execute",
  terminalAttachmentsAttach: "lyra:terminal/attachments/attach",
  terminalAttachmentsDetach: "lyra:terminal/attachments/detach",
  terminalAttachmentsList: "lyra:terminal/attachments/list",
  terminalAttachmentsPause: "lyra:terminal/attachments/pause",
  terminalAttachmentsResume: "lyra:terminal/attachments/resume",
  terminalResizeSession: "lyra:terminal/resize-session",
  terminalCloseSession: "lyra:terminal/close-session",
  terminalEvent: "lyra:terminal/event",
  agentSessionCreate: "lyra:agent/session/create",
  agentSessionCreateTemporary: "lyra:agent/session/create-temporary",
  agentSessionRead: "lyra:agent/session/read",
  agentSessionList: "lyra:agent/session/list",
  agentSessionSave: "lyra:agent/session/save",
  agentSessionUnsave: "lyra:agent/session/unsave",
  agentSessionRename: "lyra:agent/session/rename",
  agentSessionArchive: "lyra:agent/session/archive",
  agentSessionDelete: "lyra:agent/session/delete",
  agentSessionBindProject: "lyra:agent/session/bind-project",
  agentCodegraphStatus: "lyra:agent/codegraph/status",
  agentTerminalListPrivate: "lyra:agent/terminal/list-private",
  agentTerminalClosePrivate: "lyra:agent/terminal/close-private",
  agentImageAttachmentMaterialize: "lyra:agent/image-attachment/materialize",
  agentBrowserFollowRead: "lyra:agent/browser-follow/read",
  agentBrowserFollowUpdate: "lyra:agent/browser-follow/update",
  agentTurnStart: "lyra:agent/turn/start",
  agentTurnSend: "lyra:agent/turn/send",
  agentTurnResume: "lyra:agent/turn/resume",
  agentTurnCancel: "lyra:agent/turn/cancel",
  agentMemorySnapshot: "lyra:agent/memory/snapshot",
  agentMemoryAudit: "lyra:agent/memory/audit",
  agentMemoryRecoverRun: "lyra:agent/memory/recover/run",
  agentMemorySharedSearch: "lyra:agent/memory/shared/search",
  agentMemorySharedUpdate: "lyra:agent/memory/shared/update",
  agentRollbackPreview: "lyra:agent/rollback/preview",
  agentRollbackRestore: "lyra:agent/rollback/restore",
  agentMessageResolve: "lyra:agent/message/resolve",
  agentGitStatus: "lyra:agent/git/status",
  agentGitDiff: "lyra:agent/git/diff",
  agentGitStage: "lyra:agent/git/stage",
  agentGitUnstage: "lyra:agent/git/unstage",
  agentGitDiscard: "lyra:agent/git/discard",
  agentPlanList: "lyra:agent/plan/list",
  agentPlanRead: "lyra:agent/plan/read",
  agentPlanDelete: "lyra:agent/plan/delete",
  agentPlanRevise: "lyra:agent/plan/revise",
  agentPlanReviewRespond: "lyra:agent/plan/review/respond",
  agentTodoReadProject: "lyra:agent/todo/read-project",
  agentClarificationRespond: "lyra:agent/clarification/respond",
  agentPermissionRespond: "lyra:agent/permission/respond",
  agentPermissionPolicyRead: "lyra:agent/permission-policy/read",
  agentPermissionPolicySetMode: "lyra:agent/permission-policy/set-mode",
  agentConfigRead: "lyra:agent/config/read",
  agentProviderCatalogRead: "lyra:agent/provider/catalog/read",
  agentConfigUpdate: "lyra:agent/config/update",
  agentProviderProfileSave: "lyra:agent/provider/profile/save",
  agentModelsList: "lyra:agent/models/list",
  agentModelSwitch: "lyra:agent/models/switch",
  agentModelEnable: "lyra:agent/models/enable",
  agentModelDelete: "lyra:agent/models/delete",
  agentModelRefresh: "lyra:agent/models/refresh",
  agentProviderOptionsUpdate: "lyra:agent/provider/options/update",
  agentSkillsList: "lyra:agent/skills/list",
  agentSkillInspect: "lyra:agent/skills/inspect",
  agentSkillActivate: "lyra:agent/skills/activate",
  agentSkillDeactivate: "lyra:agent/skills/deactivate",
  agentSkillInstallFromLocal: "lyra:agent/skills/install-from-local",
  agentSkillInstallFromGit: "lyra:agent/skills/install-from-git",
  agentSkillInstallFromStore: "lyra:agent/skills/install-from-store",
  agentSkillUninstall: "lyra:agent/skills/uninstall",
  agentSkillRefreshStore: "lyra:agent/skills/refresh-store",
  agentSkillUpdateStoreConfig: "lyra:agent/skills/update-store-config",
  agentMcpList: "lyra:agent/mcp/list",
  agentMcpUpsert: "lyra:agent/mcp/upsert",
  agentMcpRemove: "lyra:agent/mcp/remove",
  agentMcpConnect: "lyra:agent/mcp/connect",
  agentMcpDisconnect: "lyra:agent/mcp/disconnect",
  agentMcpReload: "lyra:agent/mcp/reload",
  agentMcpDiscoverTools: "lyra:agent/mcp/discover-tools",
  agentImproveRun: "lyra:agent/action/improve",
  agentRefactorRun: "lyra:agent/action/refactor",
  agentPokeTrigger: "lyra:agent/action/poke",
  agentReviewRun: "lyra:agent/action/review",
  agentJudgeRun: "lyra:agent/action/judge",
  agentAccountsList: "lyra:agent/accounts/list",
  agentAccountsLogin: "lyra:agent/accounts/login",
  agentAccountsLoginProviders: "lyra:agent/accounts/login-providers",
  agentAccountsLoginStart: "lyra:agent/accounts/login-start",
  agentAccountsLoginComplete: "lyra:agent/accounts/login-complete",
  agentAccountsSwitch: "lyra:agent/accounts/switch",
  agentAccountsRemove: "lyra:agent/accounts/remove",
  agentEvent: "lyra:agent/event",
  agentProtocolContract: "lyra:agent/protocol/contract",
  workbenchObservationQuery: "lyra:workbench-observation/query",
  workbenchObservationQueryResult: "lyra:workbench-observation/query-result",
  softwareCapabilitiesQuery: "lyra:software-capabilities/query",
  softwareCapabilitiesQueryResult: "lyra:software-capabilities/query-result",
  uiuxListPacks: "lyra:uiux/list-packs",
  uiuxInstallFromLocal: "lyra:uiux/install-from-local",
  uiuxInstallFromGit: "lyra:uiux/install-from-git",
  uiuxInstallFromNpm: "lyra:uiux/install-from-npm",
  uiuxSetTrustState: "lyra:uiux/set-trust-state",
  uiuxUninstall: "lyra:uiux/uninstall",
  uiuxRequestActivation: "lyra:uiux/request-activation",
  uiuxResolveRuntime: "lyra:uiux/resolve-runtime",
  workbenchStateBootstrapSnapshot: "lyra:workbench-state/bootstrap-snapshot",
  workbenchStateRead: "lyra:workbench-state/read",
  workbenchStateWrite: "lyra:workbench-state/write",
  workbenchStateRemove: "lyra:workbench-state/remove",
  workbenchStateChanged: "lyra:workbench-state/changed",
  locationReadHostCandidates: "lyra:location/read-host-candidates",
  locationOpenSystemSettings: "lyra:location/open-system-settings",
  locationReverseGeocodeCandidates: "lyra:location/reverse-geocode-candidates",
  screenshotPreviewPresent: "lyra:screenshot-preview/present",
  screenshotPreviewDismiss: "lyra:screenshot-preview/dismiss",
  screenshotPreviewEvent: "lyra:screenshot-preview/event",
} as const;

export type WindowStatePayload = {
  readonly isMaximized: boolean;
  readonly isFullScreen?: boolean;
  readonly isFocused: boolean;
};

export type AppMetaPayload = {
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture | undefined;
  readonly windowMaterialMode?: "native" | "opaque" | undefined;
  readonly desktopTargetId?: string | undefined;
  readonly desktopSupportTier?: "tier1" | "tier2" | "unsupported" | undefined;
  readonly linuxLibc?: "glibc" | "musl" | "unknown" | null | undefined;
  readonly isPackaged: boolean;
  readonly userName?: string | undefined;
  readonly hostName?: string | undefined;
  readonly locale?: string | undefined;
  readonly timeZone?: string | undefined;
};

export type ThirdPartyNoticeItem = {
  readonly name: string;
  readonly version?: string;
  readonly ecosystem: string;
  readonly license: string;
  readonly source?: string;
  readonly repository?: string;
  readonly homepage?: string;
  readonly notes?: string;
  readonly licenseText?: string;
  readonly noticeText?: string;
};

export type ThirdPartyNoticesDocument = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly packageCount: number;
  readonly ecosystems: Record<string, number>;
  readonly items: readonly ThirdPartyNoticeItem[];
  readonly markdown: string;
};

export type SystemNotificationMode = "off" | "background" | "all";
export type SystemNotificationClickBehavior = "open_center" | "open_source";
export type SystemNotificationLevel = "info" | "success" | "warning" | "error";
export type SystemNotificationActionId = "open-center" | "open-source" | "mark-read";
export type SystemNotificationPermission =
  | "granted"
  | "denied"
  | "default"
  | "unsupported"
  | "unknown";

export type SystemNotificationAction = {
  readonly id: SystemNotificationActionId;
  readonly title: string;
};

export type SystemNotificationShowRequest = {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly sourceTitle?: string;
  readonly level: SystemNotificationLevel;
  readonly mode: SystemNotificationMode;
  readonly clickBehavior: SystemNotificationClickBehavior;
  readonly actionsEnabled: boolean;
  readonly actions?: readonly SystemNotificationAction[];
};

export type SystemNotificationShowResult =
  | {
      readonly status: "shown";
      readonly notificationId: string;
    }
  | {
      readonly status: "skipped";
      readonly reason: "disabled" | "foreground" | "unsupported" | "invalid" | "permission";
    }
  | {
      readonly status: "failed";
      readonly reason: "show-error";
      readonly message: string;
    };

export type SystemNotificationStatus = {
  readonly platform: NodeJS.Platform;
  readonly supported: boolean;
  readonly permission: SystemNotificationPermission;
  readonly canNotify: boolean;
  readonly canOpenSettings: boolean;
  readonly appUserModelId?: string;
  readonly actionSupport: "native" | "windows-toast" | "none";
};

export type SystemNotificationAccessRequestResult = SystemNotificationStatus & {
  readonly openedSettings: boolean;
};

export type SystemNotificationOpenSettingsResult = {
  readonly opened: boolean;
  readonly target?: string;
  readonly reason?: "unsupported-platform" | "open-failed";
};

export type SystemNotificationActivation = {
  readonly notificationId: string;
  readonly actionId: SystemNotificationActionId;
  readonly activatedAt: number;
};

export type LinuxGraphicsBackend = "wayland" | "x11";

export type LinuxGpuMode = "hardware" | "software";

export type LinuxCompatProfile = "reliable" | "native" | "performance";

export type LinuxPackageType =
  | "appimage"
  | "deb"
  | "dev"
  | "flatpak"
  | "rpm"
  | "snap"
  | "tar"
  | "unknown";

export type LinuxGpuVendor =
  | "amd"
  | "intel"
  | "nvidia"
  | "software"
  | "virtio"
  | "unknown";

export type LinuxSessionType = "wayland" | "x11" | "unknown";

export type LinuxStrategySource = "auto" | "cli" | "config" | "env" | "history" | "recovery";

export type LinuxCompatWarning = {
  readonly code:
    | "both-display-servers-detected"
    | "gpu-compat-fallback"
    | "missing-display-server"
    | "previous-launch-failed"
    | "recovery-mode"
    | "session-env-mismatch"
    | "unknown-session"
    | "unknown-desktop";
  readonly message: string;
};

export type LinuxCompatConfig = {
  readonly version: 1;
  readonly profile: LinuxCompatProfile;
  readonly updatedAt: string;
};

export type LinuxGpuFacts = {
  readonly vendor: LinuxGpuVendor;
  readonly deviceCount: number;
  readonly hasDiscreteGpu: boolean;
  readonly driverHint: string | null;
  readonly hardwareAccelerationEnabled: boolean | null;
  readonly featureStatus: Readonly<Record<string, unknown>> | null;
};

export type LinuxEnvironmentFacts = {
  readonly sessionType: LinuxSessionType;
  readonly architecture: NodeJS.Architecture;
  readonly kernelRelease: string;
  readonly libc: "glibc" | "musl" | "unknown" | null;
  readonly desktop: string;
  readonly desktopRaw: string;
  readonly distributionId: string | null;
  readonly distributionVersion: string | null;
  readonly distributionLike: readonly string[];
  readonly packageType: LinuxPackageType;
  readonly waylandDisplay: string | null;
  readonly x11Display: string | null;
  readonly isContainer: boolean;
  readonly isRoot: boolean;
  readonly gpu: LinuxGpuFacts;
};

export type LinuxCompatRecoveryStatus = {
  readonly active: boolean;
  readonly autoRestarted: boolean;
  readonly launchId: string;
  readonly previousFailureReason: string | null;
};

export type LinuxCompatReadStatusResponse = {
  readonly platform: NodeJS.Platform;
  readonly enabled: boolean;
  readonly profile: LinuxCompatProfile;
  readonly recommendedProfile: LinuxCompatProfile;
  readonly safeMode: boolean;
  readonly backend: LinuxGraphicsBackend;
  readonly gpuMode: LinuxGpuMode;
  readonly profileSource: LinuxStrategySource;
  readonly backendSource: LinuxStrategySource;
  readonly gpuSource: LinuxStrategySource;
  readonly warnings: readonly LinuxCompatWarning[];
  readonly notes: readonly string[];
  readonly appliedEnv: Readonly<Record<string, string>>;
  readonly appliedSwitches: Readonly<Record<string, string>>;
  readonly facts: LinuxEnvironmentFacts;
  readonly recovery: LinuxCompatRecoveryStatus;
  readonly generatedAt: string;
};

export type LinuxCompatReadConfigResponse = LinuxCompatConfig;

export type LinuxCompatUpdateConfigRequest = {
  readonly profile: LinuxCompatProfile;
};

export type LinuxCompatUpdateConfigResponse = {
  readonly ok: boolean;
  readonly config?: LinuxCompatConfig;
  readonly error?: string;
};

export type LinuxCompatRestartRequest = {
  readonly recovery?: boolean;
  readonly reason?: string;
};

export type LinuxCompatRestartResponse = {
  readonly ok: boolean;
  readonly error?: string;
};

export type SearchAggregateEngine = {
  readonly id: string;
  readonly label: string;
  readonly accentColor: string;
  readonly endpoint?: string;
  readonly searchUrlTemplate?: string;
  readonly probeUrlTemplate?: string;
  readonly enabledByDefault?: boolean;
};

export type SearchWebEngineDefinition = SearchAggregateEngine & {
  readonly searchUrlTemplate: string;
};

export type SearchResolveWebEngineRequest = {
  readonly query: string;
  readonly engines: readonly SearchWebEngineDefinition[];
  readonly timeoutMs?: number;
};

export type SearchResolveWebEngineResponse = {
  readonly engine: SearchWebEngineDefinition;
  readonly searchUrl: string;
  readonly fallbackUsed: boolean;
  readonly latencyMs?: number;
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

export type TerminalSessionId = string;

export type TerminalCommandSource = "user" | "agent" | "system";
export type TerminalSessionMode = "command" | "shell";

export type TerminalLifecycleProjection = {
  readonly sessionId: TerminalSessionId;
  readonly state:
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled"
    | "inputSent"
    | "runtimeUnavailable"
    | "unknown"
    | string;
  readonly phase: string;
  readonly reason?: string | null;
  readonly terminalRunning: boolean;
  readonly commandId?: string | null;
  readonly commandStatus?: string | null;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly source?: TerminalCommandSource | string | null;
  readonly mode?: TerminalSessionMode | string | null;
  readonly currentCwd?: string | null;
  readonly waiting: boolean;
  readonly background: boolean;
};

export type TerminalMemoryActor = {
  readonly kind:
    | "human_user"
    | "agent"
    | "subagent"
    | "terminal_kernel"
    | "process"
    | "system"
    | "permission";
  readonly displayName?: string | null;
  readonly agentSessionId?: string | null;
  readonly runtimeTurnId?: string | null;
  readonly toolCallId?: string | null;
  readonly processId?: number | null;
  readonly processName?: string | null;
};

export type TerminalMemoryCorrelation = {
  readonly agentSessionId?: string | null;
  readonly runtimeTurnId?: string | null;
  readonly parentRuntimeTurnId?: string | null;
  readonly toolCallId?: string | null;
  readonly terminalToolName?: string | null;
  readonly commandId?: string | null;
  readonly inputId?: string | null;
  readonly outputArtifactId?: string | null;
  readonly permissionId?: string | null;
  readonly uiWindowId?: string | null;
  readonly terminalTabId?: string | null;
  readonly paneId?: string | null;
  readonly workbenchTabId?: string | null;
  readonly projectRoot?: string | null;
  readonly cwd?: string | null;
};

export type TerminalMemoryMetadata = {
  readonly sessionRootPath?: string;
  readonly eventLogPath: string;
  readonly summaryPath: string;
  readonly uiTimelinePath: string;
  readonly outputTextPath: string;
  readonly rawOutputPath: string;
  readonly outputSummaryPath?: string;
  readonly lineIndexPath: string;
  readonly errorIndexPath: string;
  readonly commandsPath: string;
  readonly commandArtifactsRootPath?: string;
  readonly permissionsPath?: string;
  readonly processesPath?: string;
  readonly attachmentsPath?: string;
  readonly screenDiffsPath?: string;
  readonly retentionManifestPath?: string;
  readonly repairLogPath?: string;
  readonly indexManifestPath?: string;
  readonly terminalSessionsIndexPath?: string;
  readonly terminalEventsIndexPath?: string;
  readonly terminalCommandsIndexPath?: string;
  readonly terminalOutputArtifactsIndexPath?: string;
  readonly terminalPermissionsIndexPath?: string;
  readonly agentTerminalLinksIndexPath?: string;
  readonly outputCompactionPath?: string;
  readonly outputRedactionsPath?: string;
  readonly restoration?: {
    readonly metadataRestorable: boolean;
    readonly historyReadable: boolean;
    readonly screenReplayable: boolean;
    readonly ptyRestorable: boolean;
    readonly ptyRecreatable?: boolean;
    readonly liveProcessRestorable?: boolean;
    readonly liveProcessReconnectable?: boolean;
    readonly reconnectRequiresLivePtyHost?: boolean;
    readonly reason?: string;
  };
  readonly eventSeqRange?: {
    readonly start: number;
    readonly end: number;
  } | null;
  readonly outputByteRange: {
    readonly start: number;
    readonly end: number;
  };
  readonly estimatedTokens: number;
  readonly projectionRecommendation?: "inline" | "cache" | "summary" | string;
  readonly lineCount?: number;
  readonly errorCount?: number;
  readonly latestOutputPreview?: string;
  readonly truncatedByProjection: boolean;
  readonly searchHints?: Readonly<Record<string, unknown>>;
};

export type TerminalMemoryTimelineArtifact = {
  readonly artifactId?: string;
  readonly label: string;
  readonly path: string;
  readonly kind?: string;
  readonly mediaType?: string;
  readonly role?: string;
  readonly byteLength?: number;
  readonly exists?: boolean;
};

export type TerminalMemoryTimelineItem = {
  readonly itemId: string;
  readonly terminalSessionId: TerminalSessionId;
  readonly seq: number;
  readonly kind: string;
  readonly actorKind: TerminalMemoryActor["kind"] | string;
  readonly actorLabel: string;
  readonly createdAt: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly preview?: string;
  readonly commandId?: string;
  readonly agentSessionId?: string;
  readonly runtimeTurnId?: string;
  readonly toolCallId?: string;
  readonly terminalToolName?: string;
  readonly permissionId?: string;
  readonly actor?: TerminalMemoryActor | Readonly<Record<string, unknown>>;
  readonly correlation?: TerminalMemoryCorrelation | Readonly<Record<string, unknown>>;
  readonly audit?: {
    readonly actor?: TerminalMemoryActor | Readonly<Record<string, unknown>>;
    readonly correlation?: TerminalMemoryCorrelation | Readonly<Record<string, unknown>>;
    readonly permissionChain?: readonly Readonly<Record<string, unknown>>[];
    readonly latestPermission?: Readonly<Record<string, unknown>> | null;
    readonly answer?: string | null;
  };
  readonly artifacts?: readonly TerminalMemoryTimelineArtifact[];
};

export type TerminalMemoryTimelineSummary = {
  readonly terminalSessionId: TerminalSessionId;
  readonly itemCount: number;
  readonly eventCount: number;
  readonly lineCount: number;
  readonly errorCount: number;
  readonly estimatedTokens: number;
  readonly updatedAt?: string;
  readonly latestEventKind?: string | null;
  readonly latestItemPreview?: string;
};

export type TerminalMemoryTimelineReadRequest = {
  readonly sessionId: TerminalSessionId;
  /** Timeline event seq cursor token returned by nextCursor for older-page reads. */
  readonly cursor?: string;
  readonly limit?: number;
  readonly kinds?: readonly string[];
  readonly actors?: readonly string[];
  readonly commandId?: string;
  readonly toolCallId?: string;
  readonly agentSessionId?: string;
  readonly seqStart?: number;
  readonly seqEnd?: number;
  readonly timeStartMs?: number;
  readonly timeEndMs?: number;
  readonly audit?: boolean;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalMemoryTimelineReadResponse = {
  readonly sessionId: TerminalSessionId;
  readonly cursor: string | null;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly summary: TerminalMemoryTimelineSummary;
  readonly memory: TerminalMemoryMetadata;
  readonly items: readonly TerminalMemoryTimelineItem[];
};

export type TerminalMemoryEventItem = {
  readonly eventId?: string;
  readonly terminalSessionId: TerminalSessionId;
  readonly seq: number;
  readonly kind: string;
  readonly actor: TerminalMemoryActor | Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
  readonly createdAtMs?: number;
  readonly correlation?: TerminalMemoryCorrelation | Readonly<Record<string, unknown>>;
  readonly visibility?: string;
  readonly modelContextPolicy?: string;
  readonly uiPolicy?: string;
  readonly auditPolicy?: string;
};

export type TerminalEventsReadRequest = {
  readonly sessionId: TerminalSessionId;
  /** Last consumed event seq encoded as a string cursor token. */
  readonly cursor?: string;
  readonly limit?: number;
  readonly kinds?: readonly string[];
  readonly actors?: readonly string[];
  readonly audit?: boolean;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalEventsReadResponse = {
  readonly sessionId: TerminalSessionId;
  readonly cursor: string;
  readonly nextCursor: string;
  readonly hasMore: boolean;
  readonly memory: TerminalMemoryMetadata;
  readonly items: readonly TerminalMemoryEventItem[];
};

export type TerminalCommandJournalItem = {
  readonly commandSeq: number;
  readonly commandId: string;
  readonly terminalSessionId: TerminalSessionId;
  readonly commandText?: string;
  readonly normalizedCommandText?: string;
  readonly actor?: TerminalMemoryActor | Readonly<Record<string, unknown>>;
  readonly status?: "running" | "completed" | "failed" | string;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly correlation?: TerminalMemoryCorrelation | Readonly<Record<string, unknown>>;
  readonly artifactRootPath?: string;
  readonly commandMetaPath?: string;
  readonly commandOutputTextPath?: string;
  readonly commandRawOutputPath?: string;
  readonly commandEventsPath?: string;
  readonly commandSummaryPath?: string;
  readonly confidence?: number;
  readonly recordedAt?: string;
};

export type TerminalCommandsReadRequest = {
  readonly sessionId: TerminalSessionId;
  /** Last consumed command journal seq encoded as a string cursor token. */
  readonly cursor?: string;
  readonly limit?: number;
  readonly status?: "running" | "completed" | "failed" | "all" | string;
  readonly audit?: boolean;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalCommandsReadResponse = {
  readonly sessionId: TerminalSessionId;
  readonly cursor: string;
  readonly nextCursor: string;
  readonly hasMore: boolean;
  readonly memory: TerminalMemoryMetadata;
  readonly items: readonly TerminalCommandJournalItem[];
};

export type TerminalOutputRangeReadRequest = {
  readonly sessionId: TerminalSessionId;
  readonly start: number;
  readonly end: number;
  readonly raw?: boolean;
  readonly audit?: boolean;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalOutputRangeReadResponse = {
  readonly sessionId: TerminalSessionId;
  readonly raw: boolean;
  readonly encoding: "utf8" | "utf8-lossy" | string;
  readonly requestedRange: {
    readonly start: number;
    readonly end: number;
  };
  readonly range: {
    readonly start: number;
    readonly end: number;
  };
  readonly nextStart: number;
  readonly byteLength: number;
  readonly totalBytes: number;
  readonly output: string;
  readonly rawBytesHex?: string | null;
  readonly sha256?: string;
  readonly truncated: boolean;
  readonly memory: TerminalMemoryMetadata;
};

export type TerminalArtifactsListRequest = {
  readonly sessionId: TerminalSessionId;
  readonly audit?: boolean;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalArtifactsListResponse = {
  readonly sessionId: TerminalSessionId;
  readonly memory: TerminalMemoryMetadata;
  readonly items: readonly TerminalMemoryTimelineArtifact[];
};

export type TerminalPermissionRisk =
  | "none"
  | "low"
  | "shell"
  | "dangerous"
  | "sensitive"
  | string;

export type TerminalPermissionDecision =
  | "allow"
  | "deny"
  | "needsApproval"
  | "expired"
  | "revoked"
  | string;

export type TerminalPermissionScope = {
  readonly kind:
    | "oneShot"
    | "session"
    | "commandPattern"
    | "cwd"
    | "toolCall"
    | "agentSession"
    | "timeLimited"
    | string;
  readonly summary?: string;
  readonly expiresAt?: string | null;
  readonly commandPattern?: string | null;
  readonly cwd?: string | null;
  readonly agentSessionId?: string | null;
  readonly runtimeTurnId?: string | null;
  readonly toolCallId?: string | null;
};

export type TerminalContractEventRef = {
  readonly eventId?: string;
  readonly kind: string;
  readonly seq?: number;
};

export type TerminalWaitUntilRequest = {
  readonly sessionId: TerminalSessionId;
  readonly target: "output" | "screen" | "prompt" | "command" | "event";
  readonly text?: string;
  readonly regex?: string;
  readonly commandId?: string;
  readonly status?: string;
  readonly cursor?: string;
  readonly screenCursor?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalWaitUntilResponse = {
  readonly sessionId: TerminalSessionId;
  readonly matched: boolean;
  readonly reason: "output" | "screen" | "prompt" | "command" | "event" | "exit" | "timeout";
  readonly cursor?: string | null;
  readonly screenCursor?: string | null;
  readonly commandId?: string | null;
  readonly output?: string;
  readonly memory?: TerminalMemoryMetadata;
  readonly lifecycle?: TerminalLifecycleProjection;
};

export type TerminalSemanticInputAction =
  | "runCommand"
  | "submitInput"
  | "pasteText"
  | "pressKeys"
  | "selectRegion"
  | "sendSignal"
  | "resize"
  | "attachAgent"
  | "detachAgent"
  | string;

export type TerminalInputExecuteRequest = {
  readonly sessionId: TerminalSessionId;
  readonly action: TerminalSemanticInputAction;
  readonly command?: string;
  readonly text?: string;
  readonly keys?: readonly string[];
  readonly appendNewline?: boolean;
  readonly bracketedPaste?: boolean;
  readonly sensitiveRefs?: readonly string[];
  readonly regionId?: string;
  readonly screenCursor?: string;
  readonly signal?: string;
  readonly cols?: number;
  readonly rows?: number;
  readonly reason?: string;
  readonly actor: TerminalMemoryActor;
  readonly correlation: TerminalMemoryCorrelation;
};

export type TerminalInputExecuteResponse = {
  readonly sessionId: TerminalSessionId;
  readonly inputId: string;
  readonly action: TerminalSemanticInputAction;
  readonly status: "executed" | "needsApproval" | "denied" | "cancelled" | "notImplemented" | string;
  readonly permissionId?: string | null;
  readonly events: readonly TerminalContractEventRef[];
  readonly memory?: TerminalMemoryMetadata;
  readonly lifecycle?: TerminalLifecycleProjection;
};

export type TerminalPermissionEvaluateRequest = {
  readonly sessionId: TerminalSessionId;
  readonly action: TerminalSemanticInputAction;
  readonly inputId?: string;
  readonly commandId?: string;
  readonly risk?: TerminalPermissionRisk;
  readonly title?: string;
  readonly summary?: string;
  readonly detail?: string;
  readonly redactedPreview?: string;
  readonly scope?: TerminalPermissionScope;
  readonly actor: TerminalMemoryActor;
  readonly correlation: TerminalMemoryCorrelation;
};

export type TerminalPermissionEvaluateResponse = {
  readonly sessionId: TerminalSessionId;
  readonly permissionId: string;
  readonly decision: TerminalPermissionDecision;
  readonly risk: TerminalPermissionRisk;
  readonly scope?: TerminalPermissionScope;
  readonly reason?: string;
  readonly expiresAt?: string | null;
  readonly memory?: TerminalMemoryMetadata;
};

export type TerminalPermissionRespondRequest = {
  readonly sessionId: TerminalSessionId;
  readonly permissionId: string;
  readonly decision: "allow" | "deny";
  readonly scope?: TerminalPermissionScope;
  readonly reason?: string;
  readonly expiresAt?: string | null;
  readonly actor: TerminalMemoryActor;
  readonly correlation: TerminalMemoryCorrelation;
};

export type TerminalPermissionRespondResponse = {
  readonly sessionId: TerminalSessionId;
  readonly permissionId: string;
  readonly decision: TerminalPermissionDecision;
  readonly scope?: TerminalPermissionScope;
  readonly expiresAt?: string | null;
  readonly memory?: TerminalMemoryMetadata;
};

export type TerminalProcessSnapshot = {
  readonly pid: number;
  readonly parentPid?: number | null;
  readonly foreground?: boolean;
  readonly commandId?: string | null;
  readonly name?: string | null;
  readonly commandLine?: string | null;
  readonly cwd?: string | null;
  readonly running: boolean;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly children?: readonly TerminalProcessSnapshot[];
};

export type TerminalProcessesReadRequest = {
  readonly sessionId: TerminalSessionId;
  readonly pid?: number;
  readonly includeTree?: boolean;
  readonly includeCommand?: boolean;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalProcessesReadResponse = {
  readonly sessionId: TerminalSessionId;
  readonly pid?: number | null;
  readonly foregroundPid?: number | null;
  readonly running: boolean;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly limited?: boolean;
  readonly processes: readonly TerminalProcessSnapshot[];
  readonly memory?: TerminalMemoryMetadata;
  readonly lifecycle?: TerminalLifecycleProjection;
};

export type TerminalProcessSignalRequest = {
  readonly sessionId: TerminalSessionId;
  readonly pid?: number;
  readonly signal: string;
  readonly reason?: string;
  readonly actor: TerminalMemoryActor;
  readonly correlation: TerminalMemoryCorrelation;
};

export type TerminalProcessSignalResponse = {
  readonly sessionId: TerminalSessionId;
  readonly pid?: number | null;
  readonly signal: string;
  readonly status: "sent" | "needsApproval" | "denied" | "notImplemented" | string;
  readonly inputId?: string | null;
  readonly permissionId?: string | null;
  readonly memory?: TerminalMemoryMetadata;
};

export type TerminalCommandSnapshot = {
  readonly commandId: string;
  readonly sessionId: TerminalSessionId;
  readonly commandText?: string;
  readonly normalizedCommandText?: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled" | "unknown" | string;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly submittedAt?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly durationMs?: number | null;
  readonly cwdBefore?: string | null;
  readonly cwdAfter?: string | null;
  readonly outputRange?: { readonly start: number; readonly end: number } | null;
  readonly rawOutputRange?: { readonly start: number; readonly end: number } | null;
  readonly screenVersionRange?: { readonly start: number; readonly end: number } | null;
  readonly artifactRootPath?: string | null;
  readonly commandMetaPath?: string | null;
  readonly commandOutputTextPath?: string | null;
  readonly commandRawOutputPath?: string | null;
  readonly commandEventsPath?: string | null;
  readonly commandSummaryPath?: string | null;
  readonly confidence?: number;
};

export type TerminalCommandStatusRequest = {
  readonly sessionId: TerminalSessionId;
  readonly commandId?: string;
  readonly includeOutputSummary?: boolean;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalCommandStatusResponse = {
  readonly sessionId: TerminalSessionId;
  readonly commandId?: string | null;
  readonly command?: TerminalCommandSnapshot | null;
  readonly memory?: TerminalMemoryMetadata;
  readonly lifecycle?: TerminalLifecycleProjection;
};

export type TerminalCommandWaitRequest = {
  readonly sessionId: TerminalSessionId;
  readonly commandId?: string;
  readonly status?: "completed" | "failed" | "cancelled" | "notRunning" | "any" | string;
  readonly timeoutMs?: number;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalCommandWaitResponse = {
  readonly sessionId: TerminalSessionId;
  readonly commandId?: string | null;
  readonly status: "completed" | "failed" | "cancelled" | "running" | "timeout" | "unknown" | string;
  readonly reason: "status" | "exit" | "signal" | "timeout" | "notFound" | string;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly memory?: TerminalMemoryMetadata;
  readonly lifecycle?: TerminalLifecycleProjection;
};

export type TerminalCommandOutputReadRequest = {
  readonly sessionId: TerminalSessionId;
  readonly commandId: string;
  readonly start?: number;
  readonly end?: number;
  readonly maxBytes?: number;
  readonly raw?: boolean;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalCommandOutputReadResponse = TerminalOutputRangeReadResponse & {
  readonly commandId: string;
};

export type TerminalMapReadRequest = {
  readonly sessionId: TerminalSessionId;
  readonly screenCursor?: string;
  readonly maxRegions?: number;
  readonly includeText?: boolean;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalMapReadResponse = {
  readonly sessionId: TerminalSessionId;
  readonly screen: TerminalScreenReadResponse;
  readonly regions: readonly TerminalScreenRegion[];
  readonly stale?: boolean;
  readonly warning?: string;
  readonly memory?: TerminalMemoryMetadata;
};

export type TerminalActExecuteRequest = {
  readonly sessionId: TerminalSessionId;
  readonly action: "select" | "confirm" | "cancel" | "toggle" | "type" | "focus" | "scroll" | "read" | string;
  readonly regionId?: string;
  readonly screenCursor?: string;
  readonly text?: string;
  readonly direction?: "up" | "down" | "left" | "right" | "pageUp" | "pageDown" | string;
  readonly amount?: number;
  readonly reason?: string;
  readonly actor: TerminalMemoryActor;
  readonly correlation: TerminalMemoryCorrelation;
};

export type TerminalActExecuteResponse = {
  readonly sessionId: TerminalSessionId;
  readonly actId: string;
  readonly status: "executed" | "needsApproval" | "denied" | "staleTarget" | "notImplemented" | string;
  readonly inputId?: string | null;
  readonly permissionId?: string | null;
  readonly screenCursor?: string | null;
  readonly map?: TerminalMapReadResponse;
  readonly memory?: TerminalMemoryMetadata;
};

export type TerminalAttachmentMode = "observe" | "control" | "takeover" | "delegated" | string;
export type TerminalAttachmentStatus = "active" | "paused" | "detached" | "revoked" | string;

export type TerminalAttachmentSnapshot = {
  readonly attachmentId: string;
  readonly terminalSessionId: TerminalSessionId;
  readonly agentSessionId: string;
  readonly runtimeTurnId?: string | null;
  readonly toolCallId?: string | null;
  readonly mode: TerminalAttachmentMode;
  readonly status: TerminalAttachmentStatus;
  readonly permissionId?: string | null;
  readonly attachedAt?: string | null;
  readonly detachedAt?: string | null;
  readonly pausedAt?: string | null;
  readonly reason?: string | null;
};

export type TerminalAttachmentAttachRequest = {
  readonly sessionId: TerminalSessionId;
  readonly agentSessionId: string;
  readonly runtimeTurnId?: string;
  readonly toolCallId?: string;
  readonly mode: TerminalAttachmentMode;
  readonly reason?: string;
  readonly ttlMs?: number;
  readonly actor: TerminalMemoryActor;
  readonly correlation: TerminalMemoryCorrelation;
};

export type TerminalAttachmentAttachResponse = {
  readonly sessionId: TerminalSessionId;
  readonly attachment: TerminalAttachmentSnapshot;
  readonly permissionId?: string | null;
  readonly memory?: TerminalMemoryMetadata;
};

export type TerminalAttachmentDetachRequest = {
  readonly sessionId: TerminalSessionId;
  readonly attachmentId: string;
  readonly reason?: string;
  readonly actor: TerminalMemoryActor;
  readonly correlation: TerminalMemoryCorrelation;
};

export type TerminalAttachmentDetachResponse = {
  readonly sessionId: TerminalSessionId;
  readonly attachmentId: string;
  readonly status: TerminalAttachmentStatus;
  readonly memory?: TerminalMemoryMetadata;
};

export type TerminalAttachmentListRequest = {
  readonly sessionId?: TerminalSessionId;
  readonly agentSessionId?: string;
  readonly includeDetached?: boolean;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalAttachmentListResponse = {
  readonly sessionId?: TerminalSessionId;
  readonly items: readonly TerminalAttachmentSnapshot[];
  readonly memory?: TerminalMemoryMetadata;
};

export type TerminalAttachmentPauseRequest = {
  readonly sessionId: TerminalSessionId;
  readonly attachmentId: string;
  readonly reason?: string;
  readonly actor: TerminalMemoryActor;
  readonly correlation: TerminalMemoryCorrelation;
};

export type TerminalAttachmentPauseResponse = TerminalAttachmentDetachResponse;

export type TerminalAttachmentResumeRequest = {
  readonly sessionId: TerminalSessionId;
  readonly attachmentId: string;
  readonly reason?: string;
  readonly actor: TerminalMemoryActor;
  readonly correlation: TerminalMemoryCorrelation;
};

export type TerminalAttachmentResumeResponse = TerminalAttachmentDetachResponse;

export type TerminalCreateRequest = {
  readonly sessionId?: TerminalSessionId;
  readonly title?: string;
  readonly cwd?: string;
  readonly sourceAgentSessionId?: string;
  readonly shell?: string;
  readonly env?: readonly TerminalShellLaunchEnvPair[];
  readonly mode?: TerminalSessionMode;
  readonly command?: string;
  readonly persist?: boolean;
  readonly terminalThemePreset?: TerminalThemePresetId;
  readonly uiThemeId?: string;
  readonly cols: number;
  readonly rows: number;
  readonly source: TerminalCommandSource;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalShellLaunchEnvPair = {
  readonly key: string;
  readonly value: string;
};

export type TerminalShellLaunchPlanRequest = {
  readonly shell: string;
};

export type TerminalShellLaunchPlanResponse = {
  readonly shell: string;
  readonly args: readonly string[];
  readonly env: readonly TerminalShellLaunchEnvPair[];
  readonly integrationEnabled: boolean;
  readonly integrationFamily?: string | null;
  readonly integrationScriptAsset?: string | null;
};

export type TerminalSessionSnapshot = {
  readonly sessionId: TerminalSessionId;
  readonly title: string;
  readonly cwd?: string;
  readonly currentCwd?: string;
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
  readonly keys?: readonly string[];
  readonly appendNewline?: boolean;
  readonly source: TerminalCommandSource;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalReadRequest = {
  readonly sessionId: TerminalSessionId;
  /** UTF-8 byte offset into session-output.txt encoded as a string cursor token. */
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
  readonly memory?: TerminalMemoryMetadata;
  readonly reason?: "output" | "exit" | "timeout";
  readonly lifecycle?: TerminalLifecycleProjection;
};

export type TerminalScreenCursorPosition = {
  readonly row: number;
  readonly col: number;
  readonly visible: boolean;
};

export type TerminalScreenVisibleRow = {
  readonly row: number;
  readonly text: string;
  readonly wrapped: boolean;
};

export type TerminalScreenCell = {
  readonly row: number;
  readonly col: number;
  readonly text: string;
  readonly width: number;
  readonly styleId?: string | null;
  readonly hyperlinkId?: string | null;
};

export type TerminalScreenStyle = {
  readonly styleId: string;
  readonly foreground: string;
  readonly background: string;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
};

export type TerminalScreenLink = {
  readonly linkId: string;
  readonly uri: string;
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly colStart: number;
  readonly colEnd: number;
};

export type TerminalScreenInputModes = {
  readonly applicationCursor: boolean;
  readonly applicationKeypad: boolean;
  readonly bracketedPaste: boolean;
  readonly mouseReporting: "none" | "press" | "pressRelease" | "buttonMotion" | "anyMotion" | string;
  readonly mouseEncoding: "default" | "utf8" | "sgr" | string;
  readonly lineWrap: boolean;
};

export type TerminalScreenRegion = {
  readonly regionId: string;
  readonly kind: string;
  readonly text: string;
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly colStart: number;
  readonly colEnd: number;
  readonly confidence: number;
  readonly suggestedActions: readonly string[];
};

export type TerminalScreenReadRequest = {
  readonly sessionId: TerminalSessionId;
  /**
   * Screen version encoded as a string cursor token. This cursor is independent
   * from TerminalReadResponse.cursor, which is a UTF-8 output byte offset.
   */
  readonly cursor?: string;
  readonly includeScrollback?: boolean;
  readonly maxRows?: number;
  readonly maxBytes?: number;
  readonly selectedText?: string | null;
};

export type TerminalScreenReadResponse = {
  readonly sessionId: TerminalSessionId;
  readonly cursor: string;
  readonly screenVersion: number;
  readonly rows: number;
  readonly cols: number;
  readonly mode: "normal" | "alternate" | "unknown";
  readonly visibleText: string;
  readonly visibleRows: readonly TerminalScreenVisibleRow[];
  readonly scrollbackText?: string | null;
  readonly scrollbackCursor: string;
  readonly scrollbackRows: readonly TerminalScreenVisibleRow[];
  readonly cursorPosition: TerminalScreenCursorPosition;
  readonly cells: readonly TerminalScreenCell[];
  readonly cellsTruncated: boolean;
  readonly styles: readonly TerminalScreenStyle[];
  readonly links: readonly TerminalScreenLink[];
  readonly inputModes: TerminalScreenInputModes;
  readonly selectedText?: string | null;
  readonly activeCommand?: string | null;
  readonly prompt?: string | null;
  readonly regions: readonly TerminalScreenRegion[];
  readonly running: boolean;
  readonly exitCode: number | null;
  readonly truncated: boolean;
  readonly memory?: TerminalMemoryMetadata;
  readonly lifecycle?: TerminalLifecycleProjection;
};

export type TerminalResizeRequest = {
  readonly sessionId: TerminalSessionId;
  readonly cols: number;
  readonly rows: number;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalCloseRequest = {
  readonly sessionId: TerminalSessionId;
  readonly actor?: TerminalMemoryActor;
  readonly correlation?: TerminalMemoryCorrelation;
};

export type TerminalRendererAttachRequest = {
  readonly sessionId: TerminalSessionId;
};

export type TerminalRendererAttachResponse = {
  readonly sessionId: TerminalSessionId;
  readonly attached: boolean;
};

export type TerminalRendererDetachRequest = {
  readonly sessionId: TerminalSessionId;
};

export type TerminalDataAckRequest = {
  readonly sessionId: TerminalSessionId;
  readonly dataSeq: number;
  readonly byteLength: number;
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
  readonly dataSeq?: number;
  readonly byteLength?: number;
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

export type TerminalCwdChangedEvent = {
  readonly kind: "cwdChanged";
  readonly sessionId: TerminalSessionId;
  readonly cwd: string;
  readonly currentCwd: string;
  readonly source?: TerminalCommandSource | string | null;
  readonly mode?: TerminalSessionMode | string | null;
};

export type TerminalCommandCompletedRuntimeEvent = {
  readonly kind: "commandCompleted";
  readonly sessionId: TerminalSessionId;
  readonly commandId: string;
  readonly exitCode?: number | null;
  readonly source?: TerminalCommandSource;
  readonly mode?: TerminalSessionMode;
  readonly command: {
    readonly terminalSessionId: TerminalSessionId;
    readonly commandId: string;
    readonly commandText?: string | null;
    readonly status: "completed" | "failed" | "cancelled" | string;
    readonly exitCode?: number | null;
    readonly signal?: string | null;
    readonly actor?: TerminalMemoryActor | Readonly<Record<string, unknown>>;
    readonly correlation?: TerminalMemoryCorrelation | Readonly<Record<string, unknown>>;
    readonly outputTextRange?: { readonly start: number; readonly end: number };
    readonly rawOutputRange?: { readonly start: number; readonly end: number };
    readonly artifactRootPath?: string;
    readonly commandMetaPath?: string;
    readonly commandOutputTextPath?: string;
    readonly commandRawOutputPath?: string;
    readonly commandEventsPath?: string;
    readonly commandSummaryPath?: string;
    readonly completedAt?: string;
  };
};

export type TerminalEvent =
  | TerminalDataEvent
  | TerminalExitEvent
  | TerminalErrorEvent
  | TerminalCwdChangedEvent
  | TerminalCommandCompletedRuntimeEvent;

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

export type LspRuntimeEvent =
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

export type SystemNotificationsApi = {
  readonly readStatus: () => Promise<SystemNotificationStatus>;
  readonly requestAccess: () => Promise<SystemNotificationAccessRequestResult>;
  readonly openSettings: () => Promise<SystemNotificationOpenSettingsResult>;
  readonly show: (
    request: SystemNotificationShowRequest
  ) => Promise<SystemNotificationShowResult>;
  readonly onActivated: (
    listener: (event: SystemNotificationActivation) => void
  ) => () => void;
};

export type SearchApi = {
  readonly resolveWebSearchEngine: (
    request: SearchResolveWebEngineRequest
  ) => Promise<SearchResolveWebEngineResponse>;
};

export type LinuxCompatApi = {
  readonly readStatus: () => Promise<LinuxCompatReadStatusResponse>;
  readonly readConfig: () => Promise<LinuxCompatReadConfigResponse>;
  readonly updateConfig: (
    request: LinuxCompatUpdateConfigRequest
  ) => Promise<LinuxCompatUpdateConfigResponse>;
  readonly requestRestart: (
    request?: LinuxCompatRestartRequest
  ) => Promise<LinuxCompatRestartResponse>;
};

export type FilesApi = {
  readonly readHome: () => Promise<FileManagerReadHomeResponse>;
  readonly readDirectory: (request: FileManagerReadDirectoryRequest) => Promise<FileManagerReadDirectoryResponse>;
  readonly subscribeDirectory?: (
    request: FileManagerSubscribeDirectoryRequest
  ) => Promise<FileManagerSubscribeDirectoryResponse>;
  readonly unsubscribeDirectory?: (subscriptionId: string) => Promise<void>;
  readonly onDirectoryPatch?: (listener: (patch: FileManagerDirectoryPatch) => void) => () => void;
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
  readonly selectAttachments: () => Promise<readonly FileManagerSelectedAttachment[]>;
  readonly selectDirectories: () => Promise<readonly FileManagerSelectedAttachment[]>;
  /** Resolve a drag/drop File to an absolute path (required in sandboxed renderers). */
  readonly getPathForFile: (file: File) => string;
};

export type DownloadManagerApi = {
  readonly list: () => Promise<DownloadManagerSnapshot>;
  readonly enqueue: (request: DownloadManagerEnqueueRequest) => Promise<DownloadManagerSnapshot>;
  readonly importExternalBrowser: () => Promise<DownloadManagerSnapshot>;
  readonly pause: (request: DownloadManagerTaskRequest) => Promise<DownloadManagerTask | null>;
  readonly resume: (request: DownloadManagerTaskRequest) => Promise<DownloadManagerTask | null>;
  readonly cancel: (request: DownloadManagerTaskRequest) => Promise<DownloadManagerTask | null>;
  readonly retry: (request: DownloadManagerTaskRequest) => Promise<DownloadManagerTask | null>;
  readonly remove: (request: DownloadManagerTaskRequest) => Promise<void>;
  readonly setPriority: (request: DownloadManagerSetPriorityRequest) => Promise<DownloadManagerTask | null>;
  readonly pauseAll: (request?: DownloadManagerBatchRequest) => Promise<DownloadManagerSnapshot>;
  readonly resumeAll: (request?: DownloadManagerBatchRequest) => Promise<DownloadManagerSnapshot>;
  readonly cancelAll: (request?: DownloadManagerBatchRequest) => Promise<DownloadManagerSnapshot>;
  readonly readSettings: () => Promise<DownloadManagerSettings>;
  readonly updateSettings: (
    request: DownloadManagerUpdateSettingsRequest
  ) => Promise<DownloadManagerSettings>;
  readonly readRemoteApiStatus: () => Promise<DownloadManagerRemoteApiStatus>;
  readonly startRemoteApi: (
    request?: DownloadManagerRemoteApiStartRequest
  ) => Promise<DownloadManagerRemoteApiStatus>;
  readonly stopRemoteApi: () => Promise<DownloadManagerRemoteApiStatus>;
  readonly openFile: (request: DownloadManagerTaskRequest) => Promise<boolean>;
  readonly revealFile: (request: DownloadManagerTaskRequest) => Promise<boolean>;
  readonly onEvent: (listener: (event: DownloadManagerEvent) => void) => () => void;
};

export type ImageViewerApi = {
  readonly openImage: (request: ImageViewerOpenRequest) => Promise<ImageViewerOpenResult>;
  readonly readTile: (request: ImageViewerReadTileRequest) => Promise<ImageViewerTileResponse>;
  readonly closeSession: (request: ImageViewerCloseSessionRequest) => Promise<void>;
  readonly onEvent: (listener: (event: ImageViewerEvent) => void) => () => void;
};

export type WorkbenchBrowserApi = {
  readonly syncTopology: (
    snapshot: WorkbenchBrowserTopologySnapshot
  ) => Promise<void>;
  readonly syncLayout: (snapshot: WorkbenchBrowserLayoutSnapshot) => void;
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
  readonly readSessionSnapshot: () => Promise<BrowserSessionSnapshot | null>;
  readonly readStorageState: (
    request?: WorkbenchBrowserStorageStateRequest
  ) => Promise<BrowserStorageStateRef>;
  readonly clearSiteData: (
    request: WorkbenchBrowserClearSiteDataRequest
  ) => Promise<WorkbenchBrowserClearSiteDataResult>;
  readonly searchInPage: (
    request: WorkbenchBrowserSearchInPageRequest
  ) => Promise<WorkbenchBrowserSearchInPageResult>;
  readonly setChromePopover?: (
    request: WorkbenchBrowserChromePopoverRequest
  ) => Promise<void>;
  readonly setElementPickerMode: (
    request: WorkbenchBrowserSetElementPickerModeRequest
  ) => Promise<void>;
  readonly setModalOcclusion?: (
    request: { readonly active: boolean }
  ) => Promise<void>;
  readonly capturePage: (
    request?: WorkbenchVisualCaptureRequest
  ) => Promise<WorkbenchVisualCaptureResult>;
  readonly captureWindow: () => Promise<WorkbenchVisualCaptureResult>;
  readonly executePageContextAction: (
    request: WorkbenchBrowserExecutePageContextActionRequest
  ) => Promise<void>;
  readonly readActivePageDragCitation: () => PageDragCitationPayload | null;
  readonly consumePageDragCitation: () => void;
  readonly onEvent: (listener: (event: WorkbenchBrowserEvent) => void) => () => void;
};

export type TerminalApi = {
  readonly createSession: (request: TerminalCreateRequest) => Promise<TerminalSessionSnapshot>;
  readonly restoreSessions: (request: TerminalRestoreRequest) => Promise<readonly TerminalSessionSnapshot[]>;
  readonly attachRenderer?: (request: TerminalRendererAttachRequest) => Promise<TerminalRendererAttachResponse>;
  readonly detachRenderer?: (request: TerminalRendererDetachRequest) => Promise<void>;
  readonly ackData?: (request: TerminalDataAckRequest) => Promise<void>;
  readonly reloadPrompt: (request: TerminalReloadPromptRequest) => Promise<TerminalReloadPromptResult>;
  readonly writeFast?: (request: TerminalWriteRequest) => boolean;
  readonly write: (request: TerminalWriteRequest) => Promise<void>;
  readonly read: (request: TerminalReadRequest) => Promise<TerminalReadResponse>;
  readonly readScreen: (request: TerminalScreenReadRequest) => Promise<TerminalScreenReadResponse>;
  readonly readEvents: (request: TerminalEventsReadRequest) => Promise<TerminalEventsReadResponse>;
  readonly readCommands: (
    request: TerminalCommandsReadRequest
  ) => Promise<TerminalCommandsReadResponse>;
  readonly readOutputRange: (
    request: TerminalOutputRangeReadRequest
  ) => Promise<TerminalOutputRangeReadResponse>;
  readonly listArtifacts: (
    request: TerminalArtifactsListRequest
  ) => Promise<TerminalArtifactsListResponse>;
  readonly readMemoryTimeline: (
    request: TerminalMemoryTimelineReadRequest
  ) => Promise<TerminalMemoryTimelineReadResponse>;
  readonly waitUntil?: (request: TerminalWaitUntilRequest) => Promise<TerminalWaitUntilResponse>;
  readonly executeInput?: (
    request: TerminalInputExecuteRequest
  ) => Promise<TerminalInputExecuteResponse>;
  readonly evaluatePermission?: (
    request: TerminalPermissionEvaluateRequest
  ) => Promise<TerminalPermissionEvaluateResponse>;
  readonly respondPermission?: (
    request: TerminalPermissionRespondRequest
  ) => Promise<TerminalPermissionRespondResponse>;
  readonly readProcesses?: (
    request: TerminalProcessesReadRequest
  ) => Promise<TerminalProcessesReadResponse>;
  readonly signalProcess?: (
    request: TerminalProcessSignalRequest
  ) => Promise<TerminalProcessSignalResponse>;
  readonly readCommandStatus?: (
    request: TerminalCommandStatusRequest
  ) => Promise<TerminalCommandStatusResponse>;
  readonly waitCommand?: (
    request: TerminalCommandWaitRequest
  ) => Promise<TerminalCommandWaitResponse>;
  readonly readCommandOutput?: (
    request: TerminalCommandOutputReadRequest
  ) => Promise<TerminalCommandOutputReadResponse>;
  readonly readMap?: (request: TerminalMapReadRequest) => Promise<TerminalMapReadResponse>;
  readonly executeAct?: (
    request: TerminalActExecuteRequest
  ) => Promise<TerminalActExecuteResponse>;
  readonly attachAgent?: (
    request: TerminalAttachmentAttachRequest
  ) => Promise<TerminalAttachmentAttachResponse>;
  readonly detachAgent?: (
    request: TerminalAttachmentDetachRequest
  ) => Promise<TerminalAttachmentDetachResponse>;
  readonly listAttachments?: (
    request: TerminalAttachmentListRequest
  ) => Promise<TerminalAttachmentListResponse>;
  readonly pauseAttachment?: (
    request: TerminalAttachmentPauseRequest
  ) => Promise<TerminalAttachmentPauseResponse>;
  readonly resumeAttachment?: (
    request: TerminalAttachmentResumeRequest
  ) => Promise<TerminalAttachmentResumeResponse>;
  readonly resize: (request: TerminalResizeRequest) => Promise<void>;
  readonly closeSession: (request: TerminalCloseRequest) => Promise<void>;
  readonly onData: (listener: (event: TerminalDataEvent) => void) => () => void;
  readonly onExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  readonly onError: (listener: (event: TerminalErrorEvent) => void) => () => void;
  readonly onCwdChanged?: (listener: (event: TerminalCwdChangedEvent) => void) => () => void;
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
  | "browser-session"
  | "browser-history"
  | "ai-panel-tabs"
  | "terminal-dock"
  | "notifications"
  | "layout"
  | "location";

export type WorkbenchStateSnapshot = Readonly<Record<WorkbenchStateKey, string | null>>;

export type WorkbenchStateChangeEvent = {
  readonly key: WorkbenchStateKey;
  readonly json: string | null;
};

export type WorkbenchStateApi = {
  readonly readCached: (key: WorkbenchStateKey) => string | null;
  readonly read: (key: WorkbenchStateKey) => Promise<string | null>;
  readonly write: (key: WorkbenchStateKey, json: string) => Promise<void>;
  readonly remove: (key: WorkbenchStateKey) => Promise<void>;
  readonly onDidChange: (listener: (event: WorkbenchStateChangeEvent) => void) => () => void;
};

export type IdentityIconSnapshot = {
  readonly url: string;
  readonly source: "user" | "project";
  readonly label?: string;
  readonly path?: string;
  readonly updatedAt?: string;
};

export type ProjectIdentityResolveRequest = {
  readonly path: string;
};

export type ProjectIdentitySnapshot = {
  readonly rootPath: string;
  readonly name: string;
  readonly logo?: IdentityIconSnapshot | null;
};

export type IdentityApi = {
  readonly readUserIcon: () => Promise<IdentityIconSnapshot | null>;
  readonly resolveProjectIdentity: (
    request: ProjectIdentityResolveRequest
  ) => Promise<ProjectIdentitySnapshot | null>;
};

export type LocationCandidateSource = "browser" | "os" | "ip";

export type LocationCandidateStatus = "ok" | "unsupported" | "error";

export type LocationCandidate = {
  readonly id: string;
  readonly source: LocationCandidateSource;
  readonly status: LocationCandidateStatus;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly accuracyMeters?: number;
  readonly capturedAt: string;
  readonly label?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
};

export type LocationResolvedAddress = {
  readonly displayName: string;
  readonly precision:
    | "poi"
    | "house"
    | "road"
    | "neighbourhood"
    | "district"
    | "city"
    | "region"
    | "country"
    | "coordinate";
  readonly attribution?: string;
};

export type LocationResolvedCandidate = LocationCandidate & {
  readonly resolvedAddress?: LocationResolvedAddress;
};

export type LocationHostCandidatesRequest = {
  readonly locale?: string;
};

export type LocationHostCandidatesResponse = {
  readonly candidates: readonly LocationCandidate[];
};

export type LocationReverseGeocodeRequest = {
  readonly locale?: string;
  readonly candidates: readonly LocationCandidate[];
};

export type LocationReverseGeocodeResponse = {
  readonly candidates: readonly LocationResolvedCandidate[];
};

export type LocationApi = {
  readonly readHostCandidates: (
    request?: LocationHostCandidatesRequest
  ) => Promise<LocationHostCandidatesResponse>;
  readonly openSystemSettings: () => Promise<boolean>;
  readonly reverseGeocodeCandidates: (
    request: LocationReverseGeocodeRequest
  ) => Promise<LocationReverseGeocodeResponse>;
};

export type ScreenshotPreviewPresentRequest = {
  readonly imageBase64: string;
  readonly mimeType?: "image/png" | "image/jpeg";
  readonly label?: string;
  readonly source?: string;
  readonly width?: number;
  readonly height?: number;
  readonly workspaceTabId?: string;
  readonly workspaceTabTitle?: string;
  readonly workspaceTabPageKind?: string;
  readonly workspaceTabAddress?: string;
};

export type ScreenshotPreviewEvent =
  | {
      readonly kind: "presented";
      readonly previewId: string;
    }
  | {
      readonly kind: "dismissed";
      readonly previewId: string;
    }
  | {
      readonly kind: "drag-started";
      readonly previewId: string;
    };

export type ScreenshotPreviewApi = {
  readonly present: (
    request: ScreenshotPreviewPresentRequest
  ) => Promise<{ readonly previewId: string | null }>;
  readonly dismiss: () => Promise<void>;
  readonly onEvent: (listener: (event: ScreenshotPreviewEvent) => void) => () => void;
};

export type WorkbenchObservationBridgeApi = {
  readonly registerHandler: (
    handler: (
      request: WorkbenchObservationQueryRequest
    ) => Promise<WorkbenchObservationQueryResult> | WorkbenchObservationQueryResult
  ) => () => void;
};

export type SoftwareCapabilitiesBridgeApi = {
  readonly registerHandler: (
    handler: (
      request: SoftwareCapabilitiesQueryRequest
    ) => Promise<SoftwareCapabilitiesQueryResult> | SoftwareCapabilitiesQueryResult
  ) => () => void;
};

export type UiuxPacksApi = {
  readonly listPacks: () => Promise<UiuxListPacksResponse>;
  readonly installFromLocal: (request: UiuxInstallFromLocalRequest) => Promise<InstalledUiuxPack>;
  readonly installFromGit: (request: UiuxInstallFromGitRequest) => Promise<InstalledUiuxPack>;
  readonly installFromNpm: (request: UiuxInstallFromNpmRequest) => Promise<InstalledUiuxPack>;
  readonly setTrustState: (request: UiuxSetTrustStateRequest) => Promise<InstalledUiuxPack>;
  readonly uninstall: (request: UiuxUninstallRequest) => Promise<UiuxUninstallResponse>;
  readonly requestActivation: (
    request: UiuxRequestActivationRequest
  ) => Promise<UiuxRequestActivationResponse>;
  readonly resolveRuntime: (request: UiuxResolveRuntimeRequest) => Promise<UiuxPackRuntime | null>;
};

export type LegalApi = {
  readonly readThirdPartyNotices: () => Promise<ThirdPartyNoticesDocument>;
};

export type DetectedEditor = { id: string; label: string; icon?: string };
export type OpenInEditorRequest = { editorId: string; path: string };

export type LyraDesktopApi = {
  readonly windowControls: WindowControlsApi;
  readonly appMeta: AppMetaPayload;
  readonly shellEvents: ShellEventsApi;
  readonly screenshotPreview: ScreenshotPreviewApi;
  readonly openExternal: (url: string) => Promise<boolean>;
  readonly detectEditors: () => Promise<DetectedEditor[]>;
  readonly openInEditor: (request: OpenInEditorRequest) => Promise<boolean>;
  readonly revealInFolder: (path: string) => Promise<boolean>;
  readonly legal?: LegalApi;
  readonly identity?: IdentityApi;
  readonly systemNotifications?: SystemNotificationsApi;
  readonly linuxCompat: LinuxCompatApi;
  readonly search: SearchApi;
  readonly files: FilesApi;
  readonly downloads?: DownloadManagerApi;
  readonly imageViewer?: ImageViewerApi;
  readonly workbenchBrowser: WorkbenchBrowserApi;
  readonly loginManager?: LoginManagerApi;
  readonly sensitiveValues?: LyraSensitiveValueApi;
  readonly lsp: LspApi;
  readonly terminal: TerminalApi;
  readonly agent?: AgentApi;
  readonly workbenchObservation: WorkbenchObservationBridgeApi;
  readonly softwareCapabilities?: SoftwareCapabilitiesBridgeApi;
  readonly uiux: UiuxPacksApi;
  readonly workbenchState: WorkbenchStateApi;
  readonly location?: LocationApi;
};
