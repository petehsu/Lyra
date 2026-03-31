import { contextBridge, ipcRenderer } from "electron";

import {
  LYRA_CHANNELS,
  type AiCancelChatTurnRequest,
  type AiChatSession,
  type AiChatSessionSummary,
  type AiChatTurnRequest,
  type AiChatTurnResponse,
  type AiDeleteProfileRequest,
  type AiDiscoverModelsRequest,
  type AiModelDiscoveryResult,
  type AiProfileValidationResult,
  type AiProviderCatalogItem,
  type AiProviderPreset,
  type AiProviderProfile,
  type AiReadSessionHistoryRequest,
  type AiReadSessionRequest,
  type AiRuntimeEvent,
  type AiSetDefaultProfileRequest,
  type AiUpsertProfileRequest,
  type AiValidateProfileRequest,
  type AiComputerCloseAppRequest,
  type AiComputerFocusAppRequest,
  type AiComputerHostStatus,
  type AiComputerOpenAppRequest,
  type AiComputerPowerOffRequest,
  type AiComputerPowerRequest,
  type AiComputerReadSessionRequest,
  type AiComputerSessionEvent,
  type AiComputerSessionState,
  type AiComputerUpdateWindowFrameRequest,
  type AiComputerWindowActionRequest,
  type LyraSystemAssignSessionImageRequest,
  type LyraSystemClearSessionImageOverrideRequest,
  type LyraSystemEvent,
  type LyraSystemImageDescriptor,
  type LyraSystemInstallFromDirectoryRequest,
  type LyraSystemInstallFromPackageRequest,
  type LyraSystemReadResolvedSessionRequest,
  type LyraSystemRegistryState,
  type LyraSystemResolvedSession,
  type LyraSystemSetDefaultImageRequest,
  type LyraSystemSetRuntimeModeOverrideRequest,
  type LyraSystemUninstallRequest,
  type AppMetaPayload,
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
  type TerminalReloadPromptRequest,
  type TerminalReloadPromptResult,
  type TerminalResizeRequest,
  type TerminalRestoreRequest,
  type TerminalSessionSnapshot,
  type TerminalWriteRequest,
  type SearchAggregateRequest,
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
const aiEventListeners = new Set<(event: AiRuntimeEvent) => void>();
let aiEventBridgeReady = false;
const computerEventListeners = new Set<(event: AiComputerSessionEvent) => void>();
let computerEventBridgeReady = false;
const systemImagesEventListeners = new Set<(event: LyraSystemEvent) => void>();
let systemImagesEventBridgeReady = false;
const mcpEventListeners = new Set<(event: McpRuntimeEvent) => void>();
let mcpEventBridgeReady = false;
const skillsEventListeners = new Set<(event: SkillRuntimeEvent) => void>();
let skillsEventBridgeReady = false;
const lspEventListeners = new Set<(event: LspRuntimeEvent) => void>();
let lspEventBridgeReady = false;

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

const ensureAiEventBridge = (): void => {
  if (aiEventBridgeReady) {
    return;
  }
  aiEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.aiEvent,
    (_event: Electron.IpcRendererEvent, payload: AiRuntimeEvent): void => {
      if (
        payload === null ||
        typeof payload !== "object" ||
        typeof payload.kind !== "string" ||
        payload.session === undefined
      ) {
        return;
      }
      for (const listener of aiEventListeners) {
        listener(payload);
      }
    }
  );
};

const ensureComputerEventBridge = (): void => {
  if (computerEventBridgeReady) {
    return;
  }
  computerEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.computerEvent,
    (_event: Electron.IpcRendererEvent, payload: AiComputerSessionEvent): void => {
      if (
        payload === null ||
        typeof payload !== "object" ||
        typeof payload.sessionId !== "string" ||
        payload.state === undefined
      ) {
        return;
      }
      for (const listener of computerEventListeners) {
        listener(payload);
      }
    }
  );
};

const ensureSystemImagesEventBridge = (): void => {
  if (systemImagesEventBridgeReady) {
    return;
  }
  systemImagesEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.systemImagesEvent,
    (_event: Electron.IpcRendererEvent, payload: LyraSystemEvent): void => {
      if (payload === null || typeof payload !== "object" || typeof payload.kind !== "string") {
        return;
      }
      for (const listener of systemImagesEventListeners) {
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
      ipcRenderer.invoke(LYRA_CHANNELS.aggregateSearch, request)
  },
  ai: {
    readProfiles: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiReadProfiles) as Promise<readonly AiProviderProfile[]>,
    readProviderCatalog: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiReadProviderCatalog) as Promise<readonly AiProviderCatalogItem[]>,
    readPresetCatalog: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiReadPresetCatalog) as Promise<readonly AiProviderPreset[]>,
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
      ipcRenderer.invoke(LYRA_CHANNELS.aiRefreshDiscoveredModels, request) as Promise<AiModelDiscoveryResult>,
    readSession: (request: AiReadSessionRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiReadSession, request) as Promise<AiChatSession>,
    readSessionHistory: (request?: AiReadSessionHistoryRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.aiReadSessionHistory,
        request ?? {}
      ) as Promise<readonly AiChatSessionSummary[]>,
    sendChatTurn: (request: AiChatTurnRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiSendChatTurn, request) as Promise<AiChatTurnResponse>,
    cancelChatTurn: (request: AiCancelChatTurnRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiCancelChatTurn, request) as Promise<AiChatSession>,
    onEvent: (listener: (event: AiRuntimeEvent) => void) => {
      ensureAiEventBridge();
      aiEventListeners.add(listener);
      return () => {
        aiEventListeners.delete(listener);
      };
    }
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
  computer: {
    readSession: (request: AiComputerReadSessionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerReadSession,
        request
      ) as Promise<AiComputerSessionState>,
    readHostStatus: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerReadHostStatus
      ) as Promise<AiComputerHostStatus>,
    powerOn: (request: AiComputerPowerRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerPowerOn,
        request
      ) as Promise<AiComputerSessionState>,
    powerOff: (request: AiComputerPowerOffRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerPowerOff,
        request
      ) as Promise<AiComputerSessionState>,
    openApp: (request: AiComputerOpenAppRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerOpenApp,
        request
      ) as Promise<AiComputerSessionState>,
    focusApp: (request: AiComputerFocusAppRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerFocusApp,
        request
      ) as Promise<AiComputerSessionState>,
    closeApp: (request: AiComputerCloseAppRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerCloseApp,
        request
      ) as Promise<AiComputerSessionState>,
    moveAppWindow: (request: AiComputerUpdateWindowFrameRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerMoveAppWindow,
        request
      ) as Promise<AiComputerSessionState>,
    resizeAppWindow: (request: AiComputerUpdateWindowFrameRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerResizeAppWindow,
        request
      ) as Promise<AiComputerSessionState>,
    minimizeApp: (request: AiComputerWindowActionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerMinimizeApp,
        request
      ) as Promise<AiComputerSessionState>,
    maximizeApp: (request: AiComputerWindowActionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerMaximizeApp,
        request
      ) as Promise<AiComputerSessionState>,
    restoreApp: (request: AiComputerWindowActionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.computerRestoreApp,
        request
      ) as Promise<AiComputerSessionState>,
    subscribeSession: (sessionId: string, listener: (event: AiComputerSessionEvent) => void) => {
      ensureComputerEventBridge();
      const wrappedListener = (event: AiComputerSessionEvent): void => {
        if (event.sessionId !== sessionId) {
          return;
        }
        listener(event);
      };
      computerEventListeners.add(wrappedListener);
      return () => {
        computerEventListeners.delete(wrappedListener);
      };
    }
  },
  systemImages: {
    readRegistry: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesReadRegistry
      ) as Promise<LyraSystemRegistryState>,
    listInstalled: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesListInstalled
      ) as Promise<readonly LyraSystemImageDescriptor[]>,
    installFromDirectory: (request: LyraSystemInstallFromDirectoryRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesInstallFromDirectory,
        request
      ) as Promise<LyraSystemImageDescriptor>,
    installFromPackage: (request: LyraSystemInstallFromPackageRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesInstallFromPackage,
        request
      ) as Promise<LyraSystemImageDescriptor>,
    installOfficialSeed: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesInstallOfficialSeed
      ) as Promise<LyraSystemImageDescriptor>,
    uninstall: (request: LyraSystemUninstallRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesUninstall,
        request
      ) as Promise<LyraSystemRegistryState>,
    setDefaultImage: (request: LyraSystemSetDefaultImageRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesSetDefault,
        request
      ) as Promise<LyraSystemRegistryState>,
    assignSessionImage: (request: LyraSystemAssignSessionImageRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesAssignSession,
        request
      ) as Promise<LyraSystemResolvedSession>,
    clearSessionImageOverride: (request: LyraSystemClearSessionImageOverrideRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesClearSessionOverride,
        request
      ) as Promise<LyraSystemResolvedSession>,
    setRuntimeModeOverride: (request: LyraSystemSetRuntimeModeOverrideRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesSetRuntimeModeOverride,
        request
      ) as Promise<LyraSystemRegistryState>,
    readResolvedSessionSystem: (request: LyraSystemReadResolvedSessionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemImagesReadResolvedSession,
        request
      ) as Promise<LyraSystemResolvedSession>,
    subscribeSystemEvents: (listener: (event: LyraSystemEvent) => void) => {
      ensureSystemImagesEventBridge();
      systemImagesEventListeners.add(listener);
      return () => {
        systemImagesEventListeners.delete(listener);
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
