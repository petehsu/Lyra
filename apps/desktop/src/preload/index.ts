import { contextBridge, ipcRenderer } from "electron";

import {
  LYRA_CHANNELS,
  type AiMemoryConfig,
  type AgentAnswerQuestionRequest,
  type AgentAnswerPlanQuestionRequest,
  type AgentBindSessionProjectRequest,
  type AgentEnterPlanModeRequest,
  type AgentCreateSessionRequest,
  type AgentDeleteSessionRequest,
  type AgentGetPendingInteractionsRequest,
  type AgentGetPlanRequest,
  type AgentGetSessionRequest,
  type AgentPendingInteraction,
  type AgentPlanState,
  type AgentResolvePlanApprovalRequest,
  type AgentRuntimeEvent,
  type AgentSendTurnRequest,
  type AgentSendTurnResult,
  type AgentSession,
  type AgentSessionDetail,
  type CommandApprovalSubmitRequest,
  type AiDeleteProfileRequest,
  type AiDiscoverModelsRequest,
  type AiModelDiscoveryResult,
  type AiOpenAiChatGptAuthResult,
  type AiProfileValidationResult,
  type AiProviderCatalogItem,
  type AiProviderPreset,
  type AiProviderProfile,
  type AiSetDefaultProfileRequest,
  type AiUpsertProfileRequest,
  type AiValidateProfileRequest,
  type AppMetaPayload,
  type CapabilityCallResult,
  type CapabilityDescriptor,
  type CapabilityApprovalResolveRequest,
  type CapabilityInvokeRequest,
  type CapabilityListRequest,
  type CapabilityReadRegistryResponse,
  type CapabilityResolveApprovalResponse,
  type CapabilityRuntimeEvent,
  type CreateLyraSkillRequest,
  type DeleteSkillRequest,
  type EffectiveSkillConfig,
  type InstalledSkillConfig,
  type LinuxCompatExportResponse,
  type LinuxCompatReadStatusResponse,
  type ReadEffectiveSkillsRequest,
  type ReadInstalledSkillsRequest,
  type McpCatalogItem,
  type McpCreateServerRequest,
  type McpDeleteServerRequest,
  type McpEffectiveConfig,
  type McpInstallTemplateRequest,
  type McpIntrospectionSnapshot,
  type McpReadEffectiveServersRequest,
  type McpReadServersRequest,
  type McpRuntimeEvent,
  type McpServerConfig,
  type McpServerRequest,
  type McpUpdateServerRequest,
  type McpValidationResult,
  type SkillCatalogItem,
  type SkillDetails,
  type SkillImportDiscovery,
  type SkillImportRequest,
  type SkillRuntimeEvent,
  type SkillRequest,
  type UpdateSkillStateRequest,
  type LspCompletionRequest,
  type LspCompletionResult,
  type LspDocumentRequest,
  type LspRuntimeEvent,
  type TerminalCloseRequest,
  type TerminalCreateRequest,
  type TerminalDataEvent,
  type TerminalErrorEvent,
  type TerminalEvent,
  type TerminalExitEvent,
  type TerminalReadRequest,
  type TerminalReadResponse,
  type TerminalReloadPromptRequest,
  type TerminalReloadPromptResult,
  type TerminalResizeRequest,
  type TerminalRestoreRequest,
  type TerminalSessionSnapshot,
  type TerminalWriteRequest,
  type SearchAggregateRequest,
  type SearchDeepExpandRequest,
  type SearchDeepExpandResponse,
  type SearchDeepStreamCancelRequest,
  type SearchDeepStreamCancelResponse,
  type SearchDeepStreamReadRequest,
  type SearchDeepStreamReadResponse,
  type SearchDeepStreamStartRequest,
  type SearchDeepStreamStartResponse,
  type SearchIndexStatusResponse,
  type SearchLocalRequest,
  type SearchLocalResponse,
  type SearchLocalStreamCancelRequest,
  type SearchLocalStreamCancelResponse,
  type SearchLocalStreamReadRequest,
  type SearchLocalStreamReadResponse,
  type SearchLocalStreamStartRequest,
  type SearchLocalStreamStartResponse,
  type SearchRebuildIndexRequest,
  type SearchRebuildIndexResponse,
  type WorkbenchBrowserEvent,
  type WorkbenchBrowserLayoutSnapshot,
  type WorkbenchBrowserNavigateRequest,
  type WorkbenchBrowserNavigateResult,
  type WorkbenchBrowserPageRuntimeState,
  type WorkbenchBrowserReadPageStateRequest,
  type WorkbenchBrowserTopologySnapshot,
  type WorkbenchStateKey,
  type LyraDesktopApi,
  type WindowStatePayload
} from "../shared/desktop-bridge";
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
} from "../shared/file-manager";

const fallbackMeta: AppMetaPayload = {
  version: "0.1.0",
  platform: process.platform,
  isPackaged: false
};

const terminalDataListeners = new Set<(event: TerminalDataEvent) => void>();
const terminalExitListeners = new Set<(event: TerminalExitEvent) => void>();
const terminalErrorListeners = new Set<(event: TerminalErrorEvent) => void>();
let terminalEventBridgeReady = false;
const workbenchBrowserEventListeners = new Set<(event: WorkbenchBrowserEvent) => void>();
let workbenchBrowserEventBridgeReady = false;
const agentEventListeners = new Set<(event: AgentRuntimeEvent) => void>();
let agentEventBridgeReady = false;
const mcpEventListeners = new Set<(event: McpRuntimeEvent) => void>();
let mcpEventBridgeReady = false;
const skillsEventListeners = new Set<(event: SkillRuntimeEvent) => void>();
let skillsEventBridgeReady = false;
const lspEventListeners = new Set<(event: LspRuntimeEvent) => void>();
let lspEventBridgeReady = false;
const capabilityEventListeners = new Set<(event: CapabilityRuntimeEvent) => void>();
let capabilityEventBridgeReady = false;

const ensureTerminalEventBridge = (): void => {
  if (terminalEventBridgeReady) {
    return;
  }
  terminalEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.terminalEvent,
    (_event: Electron.IpcRendererEvent, payload: TerminalEvent): void => {
      if (payload === null || typeof payload !== "object" || !("kind" in payload)) {
        return;
      }

      if (payload.kind === "data") {
        for (const listener of terminalDataListeners) {
          listener(payload);
        }
        return;
      }

      if (payload.kind === "exit") {
        for (const listener of terminalExitListeners) {
          listener(payload);
        }
        return;
      }

      if (payload.kind === "error") {
        for (const listener of terminalErrorListeners) {
          listener(payload);
        }
      }
    }
  );
};

const ensureWorkbenchBrowserEventBridge = (): void => {
  if (workbenchBrowserEventBridgeReady) {
    return;
  }
  workbenchBrowserEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.workbenchBrowserEvent,
    (_event: Electron.IpcRendererEvent, payload: WorkbenchBrowserEvent): void => {
      if (payload === null || typeof payload !== "object" || typeof payload.kind !== "string") {
        return;
      }
      for (const listener of workbenchBrowserEventListeners) {
        listener(payload);
      }
    }
  );
};

const ensureAgentEventBridge = (): void => {
  if (agentEventBridgeReady) {
    return;
  }
  agentEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.agentEvent,
    (_event: Electron.IpcRendererEvent, payload: AgentRuntimeEvent): void => {
      if (
        payload === null ||
        typeof payload !== "object" ||
        typeof payload.phase !== "string" ||
        typeof payload.sessionId !== "string" ||
        typeof payload.turnId !== "string"
      ) {
        return;
      }
      for (const listener of agentEventListeners) {
        listener(payload);
      }
    }
  );
};

const ensureLspEventBridge = (): void => {
  if (lspEventBridgeReady) {
    return;
  }
  lspEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.lspEvent,
    (_event: Electron.IpcRendererEvent, payload: LspRuntimeEvent): void => {
      if (payload === null || typeof payload !== "object" || !("kind" in payload)) {
        return;
      }
      for (const listener of lspEventListeners) {
        listener(payload);
      }
    }
  );
};

const ensureMcpEventBridge = (): void => {
  if (mcpEventBridgeReady) {
    return;
  }
  mcpEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.mcpEvent,
    (_event: Electron.IpcRendererEvent, payload: McpRuntimeEvent): void => {
      if (payload === null || typeof payload !== "object" || !("kind" in payload)) {
        return;
      }
      for (const listener of mcpEventListeners) {
        listener(payload);
      }
    }
  );
};

const ensureSkillsEventBridge = (): void => {
  if (skillsEventBridgeReady) {
    return;
  }
  skillsEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.skillsEvent,
    (_event: Electron.IpcRendererEvent, payload: SkillRuntimeEvent): void => {
      if (payload === null || typeof payload !== "object" || !("kind" in payload)) {
        return;
      }
      for (const listener of skillsEventListeners) {
        listener(payload);
      }
    }
  );
};

const ensureCapabilityEventBridge = (): void => {
  if (capabilityEventBridgeReady) {
    return;
  }
  capabilityEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.capabilityEvent,
    (_event: Electron.IpcRendererEvent, payload: CapabilityRuntimeEvent): void => {
      if (
        payload === null ||
        typeof payload !== "object" ||
        typeof payload.phase !== "string" ||
        typeof payload.capabilityId !== "string"
      ) {
        return;
      }
      for (const listener of capabilityEventListeners) {
        listener(payload);
      }
    }
  );
};

const readAppMeta = (): AppMetaPayload => {
  try {
    return ipcRenderer.sendSync(LYRA_CHANNELS.readAppMetaSync) as AppMetaPayload;
  } catch (_error) {
    return fallbackMeta;
  }
};

const invokeSyncChannel = <T>(channel: string, payload: unknown): T => {
  const response = ipcRenderer.sendSync(channel, payload) as
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: string };

  if (response === null || typeof response !== "object" || typeof (response as { ok?: unknown }).ok !== "boolean") {
    throw new Error(`invalid sync response for channel: ${channel}`);
  }

  if (response.ok === false) {
    throw new Error(response.error);
  }

  return response.value;
};

const createLyraDesktopApi = (): LyraDesktopApi => ({
  windowControls: {
    minimize: () => ipcRenderer.invoke(LYRA_CHANNELS.minimizeWindow),
    toggleMaximize: () => ipcRenderer.invoke(LYRA_CHANNELS.toggleWindowMaximize),
    close: () => ipcRenderer.invoke(LYRA_CHANNELS.closeWindow)
  },
  appMeta: readAppMeta(),
  shellEvents: {
    onWindowStateChange: (listener: (payload: WindowStatePayload) => void) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        payload: WindowStatePayload
      ): void => {
        listener(payload);
      };
      ipcRenderer.on(LYRA_CHANNELS.windowStateChanged, wrappedListener);
      return () => {
        ipcRenderer.removeListener(LYRA_CHANNELS.windowStateChanged, wrappedListener);
      };
    }
  },
  openExternal: (url: string) => ipcRenderer.invoke(LYRA_CHANNELS.openExternal, url),
  linuxCompat: {
    readStatus: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.linuxCompatReadStatus) as Promise<LinuxCompatReadStatusResponse>,
    exportDiagnostics: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.linuxCompatExportDiagnostics
      ) as Promise<LinuxCompatExportResponse>
  },
  search: {
    aggregate: (request: SearchAggregateRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aggregateSearch, request),
    local: (request: SearchLocalRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.localSearch,
        request
      ) as Promise<SearchLocalResponse>,
    startLocalStream: (request: SearchLocalStreamStartRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.localSearchStreamStart,
        request
      ) as Promise<SearchLocalStreamStartResponse>,
    readLocalStream: (request: SearchLocalStreamReadRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.localSearchStreamRead,
        request
      ) as Promise<SearchLocalStreamReadResponse>,
    cancelLocalStream: (request: SearchLocalStreamCancelRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.localSearchStreamCancel,
        request
      ) as Promise<SearchLocalStreamCancelResponse>,
    readIndexStatus: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.searchIndexStatus
      ) as Promise<SearchIndexStatusResponse>,
    rebuildIndex: (request: SearchRebuildIndexRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.searchRebuildIndex,
        request
      ) as Promise<SearchRebuildIndexResponse>,
    startDeepStream: (request: SearchDeepStreamStartRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.searchDeepStreamStart,
        request
      ) as Promise<SearchDeepStreamStartResponse>,
    readDeepStream: (request: SearchDeepStreamReadRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.searchDeepStreamRead,
        request
      ) as Promise<SearchDeepStreamReadResponse>,
    cancelDeepStream: (request: SearchDeepStreamCancelRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.searchDeepStreamCancel,
        request
      ) as Promise<SearchDeepStreamCancelResponse>,
    expandDeepNode: (request: SearchDeepExpandRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.searchDeepExpand,
        request
      ) as Promise<SearchDeepExpandResponse>
  },
  ai: {
    readProfiles: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiReadProfiles) as Promise<readonly AiProviderProfile[]>,
    readProviderCatalog: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiReadProviderCatalog) as Promise<readonly AiProviderCatalogItem[]>,
    readPresetCatalog: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiReadPresetCatalog) as Promise<readonly AiProviderPreset[]>,
    authorizeOpenAiChatGpt: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiAuthorizeOpenAiChatGpt) as Promise<AiOpenAiChatGptAuthResult>,
    authorizeOpenAiChatGptDeviceCode: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiAuthorizeOpenAiChatGptDeviceCode) as Promise<AiOpenAiChatGptAuthResult>,
    upsertProfile: (request: AiUpsertProfileRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiUpsertProfile, request) as Promise<AiProviderProfile>,
    deleteProfile: (request: AiDeleteProfileRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiDeleteProfile, request) as Promise<void>,
    setDefaultProfile: (request: AiSetDefaultProfileRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiSetDefaultProfile, request) as Promise<AiProviderProfile>,
    validateProfile: (request: AiValidateProfileRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiValidateProfile, request) as Promise<AiProfileValidationResult>,
    discoverModels: (request: AiDiscoverModelsRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiDiscoverModels, request) as Promise<AiModelDiscoveryResult>,
    refreshDiscoveredModels: (request: AiDiscoverModelsRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiRefreshDiscoveredModels, request) as Promise<AiModelDiscoveryResult>
  },
  agent: {
    listSessions: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentListSessions) as Promise<readonly AgentSession[]>,
    createSession: (request?: AgentCreateSessionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentCreateSession,
        request ?? {}
      ) as Promise<AgentSession>,
    getSession: (request: AgentGetSessionRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentGetSession, request) as Promise<AgentSessionDetail>,
    bindSessionProject: (request: AgentBindSessionProjectRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentBindSessionProject, request) as Promise<AgentSession>,
    deleteSession: (request: AgentDeleteSessionRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentDeleteSession, request) as Promise<void>,
    sendTurn: (request: AgentSendTurnRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentSendTurn, request) as Promise<AgentSendTurnResult>,
    enterPlanMode: (request: AgentEnterPlanModeRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentEnterPlanMode, request) as Promise<AgentSessionDetail>,
    getPlan: (request: AgentGetPlanRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentGetPlan, request) as Promise<AgentPlanState | null>,
    getPendingInteractions: (request: AgentGetPendingInteractionsRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentGetPendingInteractions, request) as Promise<
        readonly AgentPendingInteraction[]
      >,
    answerQuestion: (request: AgentAnswerQuestionRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentAnswerQuestion, request) as Promise<void>,
    answerPlanQuestion: (request: AgentAnswerPlanQuestionRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentAnswerPlanQuestion, request) as Promise<void>,
    resolvePlanApproval: (request: AgentResolvePlanApprovalRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentResolvePlanApproval, request) as Promise<
        AgentSendTurnResult | null
      >,
    getMemoryConfig: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentGetMemoryConfig) as Promise<AiMemoryConfig>,
    updateMemoryConfig: (config: AiMemoryConfig) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentUpdateMemoryConfig, config) as Promise<AiMemoryConfig>,
    onEvent: (listener: (event: AgentRuntimeEvent) => void) => {
      ensureAgentEventBridge();
      agentEventListeners.add(listener);
      return () => {
        agentEventListeners.delete(listener);
      };
    },
    submitCommandApproval: (request: CommandApprovalSubmitRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentSubmitCommandApproval, request) as Promise<void>,
  },
  files: {
    readHome: () => ipcRenderer.invoke(LYRA_CHANNELS.filesReadHome) as Promise<FileManagerReadHomeResponse>,
    readDirectory: (request: FileManagerReadDirectoryRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesReadDirectory, request) as Promise<FileManagerReadDirectoryResponse>,
    readTrash: () => ipcRenderer.invoke(LYRA_CHANNELS.filesReadTrash) as Promise<FileManagerReadTrashResponse>,
    createFile: (request: FileManagerCreateFileRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesCreateFile, request) as Promise<FileManagerDirectoryMutationResponse>,
    createFolder: (request: FileManagerCreateFolderRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesCreateFolder, request) as Promise<FileManagerDirectoryMutationResponse>,
    moveToTrash: (request: FileManagerMoveToTrashRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesMoveToTrash, request) as Promise<void>,
    restoreFromTrash: (request: FileManagerRestoreFromTrashRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesRestoreFromTrash, request) as Promise<void>,
    emptyTrash: () => ipcRenderer.invoke(LYRA_CHANNELS.filesEmptyTrash) as Promise<void>,
    mountDevice: (request: FileManagerMountDeviceRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesMountDevice, request) as Promise<FileManagerMountDeviceResult>,
    ejectDevice: (request: FileManagerEjectDeviceRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesEjectDevice, request) as Promise<FileManagerEjectDeviceResult>,
    readFavorites: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesReadFavorites) as Promise<FileManagerFavoritesPayload>,
    writeFavorites: (payload: FileManagerFavoritesPayload) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesWriteFavorites, payload) as Promise<FileManagerFavoritesPayload>,
    readRecentLocations: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesReadRecentLocations) as Promise<FileManagerRecentLocationsPayload>,
    writeRecentLocations: (payload: FileManagerRecentLocationsPayload) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesWriteRecentLocations, payload) as Promise<FileManagerRecentLocationsPayload>,
    readTextFile: (request: FileReadTextRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesReadTextFile, request) as Promise<FileReadResult>,
    writeTextFile: (request: FileWriteTextRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesWriteTextFile, request) as Promise<FileWriteResult>,
    statFile: (request: FileStatRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesStatFile, request) as Promise<FileStatResult>
  },
  workbenchBrowser: {
    syncTopology: (snapshot: WorkbenchBrowserTopologySnapshot) =>
      ipcRenderer.invoke(LYRA_CHANNELS.workbenchBrowserSyncTopology, snapshot) as Promise<void>,
    syncLayout: (snapshot: WorkbenchBrowserLayoutSnapshot) =>
      ipcRenderer.invoke(LYRA_CHANNELS.workbenchBrowserSyncLayout, snapshot) as Promise<void>,
    navigate: (request: WorkbenchBrowserNavigateRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.workbenchBrowserNavigate, request) as Promise<WorkbenchBrowserNavigateResult>,
    goBack: (request: { readonly tabId: string }) =>
      ipcRenderer.invoke(LYRA_CHANNELS.workbenchBrowserGoBack, request) as Promise<void>,
    goForward: (request: { readonly tabId: string }) =>
      ipcRenderer.invoke(LYRA_CHANNELS.workbenchBrowserGoForward, request) as Promise<void>,
    reload: (request: { readonly tabId: string; readonly ignoreCache?: boolean }) =>
      ipcRenderer.invoke(LYRA_CHANNELS.workbenchBrowserReload, request) as Promise<void>,
    stop: (request: { readonly tabId: string }) =>
      ipcRenderer.invoke(LYRA_CHANNELS.workbenchBrowserStop, request) as Promise<void>,
    readPageState: (request?: WorkbenchBrowserReadPageStateRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserReadPageState,
        request ?? {}
      ) as Promise<WorkbenchBrowserPageRuntimeState | null>,
    onEvent: (listener: (event: WorkbenchBrowserEvent) => void) => {
      ensureWorkbenchBrowserEventBridge();
      workbenchBrowserEventListeners.add(listener);
      return () => {
        workbenchBrowserEventListeners.delete(listener);
      };
    }
  },
  mcp: {
    readCatalog: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpReadCatalog) as Promise<readonly McpCatalogItem[]>,
    readServers: (request: McpReadServersRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpReadServers, request) as Promise<readonly McpServerConfig[]>,
    readEffectiveServers: (request?: McpReadEffectiveServersRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpReadEffectiveServers, request ?? {}) as Promise<McpEffectiveConfig>,
    createServer: (request: McpCreateServerRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpCreateServer, request) as Promise<McpServerConfig>,
    updateServer: (request: McpUpdateServerRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpUpdateServer, request) as Promise<McpServerConfig>,
    deleteServer: (request: McpDeleteServerRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpDeleteServer, request) as Promise<void>,
    installTemplate: (request: McpInstallTemplateRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpInstallTemplate, request) as Promise<McpServerConfig>,
    validateServer: (request: McpServerRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpValidateServer, request) as Promise<McpValidationResult>,
    startServer: (request: McpServerRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpStartServer, request) as Promise<McpServerConfig>,
    stopServer: (request: McpServerRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpStopServer, request) as Promise<McpServerConfig>,
    restartServer: (request: McpServerRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpRestartServer, request) as Promise<McpServerConfig>,
    readServerIntrospection: (request: McpServerRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.mcpReadServerIntrospection, request) as Promise<McpIntrospectionSnapshot>,
    onEvent: (listener: (event: McpRuntimeEvent) => void) => {
      ensureMcpEventBridge();
      mcpEventListeners.add(listener);
      return () => {
        mcpEventListeners.delete(listener);
      };
    }
  },
  skills: {
    readCatalog: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.skillsReadCatalog) as Promise<
        readonly SkillCatalogItem[]
      >,
    readInstalled: (request: ReadInstalledSkillsRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.skillsReadInstalled, request) as Promise<
        readonly InstalledSkillConfig[]
      >,
    readEffectiveSkills: (request?: ReadEffectiveSkillsRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.skillsReadEffective, request ?? {}) as Promise<
        readonly EffectiveSkillConfig[]
      >,
    discoverImportSource: (sourcePath: string) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.skillsDiscoverImportSource,
        sourcePath
      ) as Promise<SkillImportDiscovery>,
    importSkills: (request: SkillImportRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.skillsImport, request) as Promise<
        readonly InstalledSkillConfig[]
      >,
    createLyraSkill: (request: CreateLyraSkillRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.skillsCreateLyraSkill, request) as Promise<
        InstalledSkillConfig
      >,
    updateSkillState: (request: UpdateSkillStateRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.skillsUpdateState, request) as Promise<
        InstalledSkillConfig
      >,
    deleteSkill: (request: DeleteSkillRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.skillsDelete, request) as Promise<void>,
    readSkillDetails: (request: SkillRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.skillsReadDetails, request) as Promise<
        SkillDetails | null
      >,
    onEvent: (listener: (event: SkillRuntimeEvent) => void) => {
      ensureSkillsEventBridge();
      skillsEventListeners.add(listener);
      return () => {
        skillsEventListeners.delete(listener);
      };
    }
  },
  lsp: {
    openDocument: (request: LspDocumentRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.lspOpenDocument, request) as Promise<void>,
    changeDocument: (request: LspDocumentRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.lspChangeDocument, request) as Promise<void>,
    saveDocument: (request: LspDocumentRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.lspSaveDocument, request) as Promise<void>,
    closeDocument: (request: LspDocumentRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.lspCloseDocument, request) as Promise<void>,
    completion: (request: LspCompletionRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.lspCompletion, request) as Promise<LspCompletionResult>,
    onEvent: (listener: (event: LspRuntimeEvent) => void) => {
      ensureLspEventBridge();
      lspEventListeners.add(listener);
      return () => {
        lspEventListeners.delete(listener);
      };
    }
  },
  terminal: {
    createSession: (request: TerminalCreateRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalCreateSession, request) as Promise<TerminalSessionSnapshot>,
    restoreSessions: (request: TerminalRestoreRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalRestoreSessions, request) as Promise<
        readonly TerminalSessionSnapshot[]
      >,
    reloadPrompt: (request: TerminalReloadPromptRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalReloadPrompt, request) as Promise<TerminalReloadPromptResult>,
    write: (request: TerminalWriteRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalWriteSession, request) as Promise<void>,
    read: (request: TerminalReadRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalReadSession, request) as Promise<TerminalReadResponse>,
    resize: (request: TerminalResizeRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalResizeSession, request) as Promise<void>,
    closeSession: (request: TerminalCloseRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalCloseSession, request) as Promise<void>,
    onData: (listener: (event: TerminalDataEvent) => void) => {
      ensureTerminalEventBridge();
      terminalDataListeners.add(listener);
      return () => {
        terminalDataListeners.delete(listener);
      };
    },
    onExit: (listener: (event: TerminalExitEvent) => void) => {
      ensureTerminalEventBridge();
      terminalExitListeners.add(listener);
      return () => {
        terminalExitListeners.delete(listener);
      };
    },
    onError: (listener: (event: TerminalErrorEvent) => void) => {
      ensureTerminalEventBridge();
      terminalErrorListeners.add(listener);
      return () => {
        terminalErrorListeners.delete(listener);
      };
    }
  },
  capabilities: {
    readRegistry: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.capabilityReadRegistry
      ) as Promise<CapabilityReadRegistryResponse>,
    listCapabilities: (request?: CapabilityListRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.capabilityList,
        request ?? {}
      ) as Promise<readonly CapabilityDescriptor[]>,
    invokeCapability: (request: CapabilityInvokeRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.capabilityInvoke,
        request
      ) as Promise<CapabilityCallResult>,
    resolveApproval: (request: CapabilityApprovalResolveRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.capabilityResolveApproval,
        request
      ) as Promise<CapabilityResolveApprovalResponse>,
    onEvent: (listener: (event: CapabilityRuntimeEvent) => void) => {
      ensureCapabilityEventBridge();
      capabilityEventListeners.add(listener);
      return () => {
        capabilityEventListeners.delete(listener);
      };
    }
  },
  workbenchState: {
    readSync: (key: WorkbenchStateKey) =>
      invokeSyncChannel<string | null>(LYRA_CHANNELS.workbenchStateReadSync, {
        key
      }),
    writeSync: (key: WorkbenchStateKey, json: string) => {
      invokeSyncChannel<null>(LYRA_CHANNELS.workbenchStateWriteSync, {
        key,
        json
      });
    },
    removeSync: (key: WorkbenchStateKey) => {
      invokeSyncChannel<null>(LYRA_CHANNELS.workbenchStateRemoveSync, {
        key
      });
    }
  }
});

contextBridge.exposeInMainWorld("lyraDesktop", createLyraDesktopApi());
