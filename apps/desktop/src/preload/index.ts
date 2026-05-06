import { contextBridge, ipcRenderer } from "electron";

import {
  LYRA_CHANNELS,
  type AppMetaPayload,
  type CreateLyraSkillRequest,
  type DeleteSkillRequest,
  type DownloadManagerBatchRequest,
  type DownloadManagerEnqueueRequest,
  type DownloadManagerEvent,
  type DownloadManagerRemoteApiStartRequest,
  type DownloadManagerRemoteApiStatus,
  type DownloadManagerSetPriorityRequest,
  type DownloadManagerSettings,
  type DownloadManagerSnapshot,
  type DownloadManagerTask,
  type DownloadManagerTaskRequest,
  type DownloadManagerUpdateSettingsRequest,
  type EffectiveSkillConfig,
  type InstalledSkillConfig,
  type LinuxCompatExportResponse,
  type LinuxCompatReadConfigResponse,
  type LinuxCompatReadStatusResponse,
  type LinuxCompatRestartRequest,
  type LinuxCompatRestartResponse,
  type LinuxCompatUpdateConfigRequest,
  type LinuxCompatUpdateConfigResponse,
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
  type SystemNotificationAccessRequestResult,
  type SystemNotificationActivation,
  type SystemNotificationOpenSettingsResult,
  type SystemNotificationPermission,
  type SystemNotificationShowRequest,
  type SystemNotificationShowResult,
  type SystemNotificationStatus,
  type LyraResourceEvent,
  type LyraSystemActivityActionRequest,
  type LyraSystemActivityActionResult,
  type LyraSystemSnapshot,
  type LyraResourceLifecycleRequest,
  type LyraResourceRegisterRequest,
  type LyraResourceSnapshot,
  type ImageViewerCloseSessionRequest,
  type ImageViewerEvent,
  type ImageViewerOpenRequest,
  type ImageViewerOpenResult,
  type ImageViewerReadTileRequest,
  type ImageViewerTileResponse,
  type UiuxInstallFromGitRequest,
  type UiuxInstallFromLocalRequest,
  type UiuxInstallFromNpmRequest,
  type UiuxListPacksResponse,
  type UiuxPackRuntime,
  type UiuxRequestActivationRequest,
  type UiuxRequestActivationResponse,
  type UiuxResolveRuntimeRequest,
  type UiuxSetTrustStateRequest,
  type InstalledUiuxPack,
  type WorkbenchBrowserEvent,
  type WorkbenchBrowserSetElementPickerModeRequest,
  type WorkbenchBrowserLayoutSnapshot,
  type WorkbenchBrowserNavigateRequest,
  type WorkbenchBrowserWebThemeSnapshot,
  type WorkbenchBrowserNavigateResult,
  type WorkbenchObservationQueryRequest,
  type WorkbenchObservationQueryResult,
  type WorkbenchBrowserPageRuntimeState,
  type WorkbenchBrowserReadPageStateRequest,
  type WorkbenchBrowserTopologySnapshot,
  type WorkbenchStateKey,
  type AiDeleteProfileRequest,
  type AiDiscoverModelsRequest,
  type AiModelDiscoveryResult,
  type AiProviderProfile,
  type AiRuntimeConfigSnapshot,
  type AiUpsertProfileRequest,
  type AgentCancelTurnRequest,
  type AgentCancelTurnResult,
  type AgentApplyPatchRequest,
  type AgentApplyPatchResult,
  type AgentArtifactContent,
  type AgentCreateSessionRequest,
  type AgentCreateTodoRequest,
  type AgentCreateTodoResult,
  type AgentReadArtifactRequest,
  type AgentReadSessionRequest,
  type AgentResolveApprovalRequest,
  type AgentResolveApprovalResult,
  type AgentRuntimeStreamEvent,
  type AgentSendTurnRequest,
  type AgentSendTurnResult,
  type AgentSession,
  type AgentSessionDetail,
  type AgentUpdateSessionRequest,
  type LyraDesktopApi,
  type WindowStatePayload
} from "../shared/desktop-bridge";
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
} from "../shared/file-manager";

const fallbackMeta: AppMetaPayload = {
  version: "0.1.0",
  platform: process.platform,
  arch: process.arch,
  isPackaged: false,
  userName: process.env.USER ?? process.env.USERNAME,
  locale: Intl.DateTimeFormat().resolvedOptions().locale,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
};

const readBrowserNotificationPermission = (): SystemNotificationPermission => {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") {
    return "unsupported";
  }
  const permission = window.Notification.permission;
  return permission === "granted" || permission === "denied" || permission === "default"
    ? permission
    : "unknown";
};

const withBrowserNotificationPermission = (
  status: SystemNotificationStatus,
  permission: SystemNotificationPermission = readBrowserNotificationPermission()
): SystemNotificationStatus => ({
  ...status,
  permission: status.supported ? permission : "unsupported",
  canNotify: status.supported && permission === "granted"
});

const requestBrowserNotificationPermission = async (): Promise<SystemNotificationPermission> => {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") {
    return "unsupported";
  }
  if (window.Notification.permission === "granted" || window.Notification.permission === "denied") {
    return window.Notification.permission;
  }
  try {
    return await window.Notification.requestPermission();
  } catch (_error) {
    return readBrowserNotificationPermission();
  }
};

const terminalDataListeners = new Set<(event: TerminalDataEvent) => void>();
const terminalExitListeners = new Set<(event: TerminalExitEvent) => void>();
const terminalErrorListeners = new Set<(event: TerminalErrorEvent) => void>();
let terminalEventBridgeReady = false;
const workbenchBrowserEventListeners = new Set<(event: WorkbenchBrowserEvent) => void>();
let workbenchBrowserEventBridgeReady = false;
const systemNotificationActivationListeners = new Set<(
  event: SystemNotificationActivation
) => void>();
let systemNotificationActivationBridgeReady = false;
const resourceEventListeners = new Set<(event: LyraResourceEvent) => void>();
let resourceEventBridgeReady = false;
const imageViewerEventListeners = new Set<(event: ImageViewerEvent) => void>();
let imageViewerEventBridgeReady = false;
const directoryPatchListeners = new Set<(patch: FileManagerDirectoryPatch) => void>();
let directoryPatchBridgeReady = false;
const downloadEventListeners = new Set<(event: DownloadManagerEvent) => void>();
let downloadEventBridgeReady = false;
const mcpEventListeners = new Set<(event: McpRuntimeEvent) => void>();
let mcpEventBridgeReady = false;
const skillsEventListeners = new Set<(event: SkillRuntimeEvent) => void>();
let skillsEventBridgeReady = false;
const lspEventListeners = new Set<(event: LspRuntimeEvent) => void>();
let lspEventBridgeReady = false;
const aiEventListeners = new Set<(event: AgentRuntimeStreamEvent) => void>();
let aiEventBridgeReady = false;
let workbenchObservationHandler:
  | ((
      request: WorkbenchObservationQueryRequest
    ) => Promise<WorkbenchObservationQueryResult> | WorkbenchObservationQueryResult)
  | null = null;
let workbenchObservationBridgeReady = false;

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
    (_event: Electron.IpcRendererEvent, payload: AgentRuntimeStreamEvent): void => {
      if (payload === null || typeof payload !== "object" || !("eventType" in payload)) {
        return;
      }
      for (const listener of aiEventListeners) {
        listener(payload);
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

const ensureResourceEventBridge = (): void => {
  if (resourceEventBridgeReady) {
    return;
  }
  resourceEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.resourcesEvent,
    (_event: Electron.IpcRendererEvent, payload: LyraResourceEvent): void => {
      if (payload === null || typeof payload !== "object" || typeof payload.kind !== "string") {
        return;
      }
      for (const listener of resourceEventListeners) {
        listener(payload);
      }
    }
  );
};

const ensureSystemNotificationActivationBridge = (): void => {
  if (systemNotificationActivationBridgeReady) {
    return;
  }
  systemNotificationActivationBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.systemNotificationsActivated,
    (_event: Electron.IpcRendererEvent, payload: SystemNotificationActivation): void => {
      if (
        payload === null
        || typeof payload !== "object"
        || typeof payload.notificationId !== "string"
        || typeof payload.actionId !== "string"
        || typeof payload.activatedAt !== "number"
      ) {
        return;
      }
      for (const listener of systemNotificationActivationListeners) {
        listener(payload);
      }
    }
  );
};

const ensureImageViewerEventBridge = (): void => {
  if (imageViewerEventBridgeReady) {
    return;
  }
  imageViewerEventBridgeReady = true;
  ipcRenderer.on(
    LYRA_CHANNELS.imageViewerEvent,
    (_event: Electron.IpcRendererEvent, payload: ImageViewerEvent): void => {
      for (const listener of imageViewerEventListeners) {
        listener(payload);
      }
    }
  );
};

const ensureDirectoryPatchBridge = (): void => {
  if (directoryPatchBridgeReady) {
    return;
  }
  directoryPatchBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.filesDirectoryPatch,
    (_event: Electron.IpcRendererEvent, payload: FileManagerDirectoryPatch): void => {
      if (
        payload === null
        || typeof payload !== "object"
        || typeof payload.subscriptionId !== "string"
        || typeof payload.kind !== "string"
      ) {
        return;
      }
      for (const listener of directoryPatchListeners) {
        listener(payload);
      }
    }
  );
};

const ensureDownloadEventBridge = (): void => {
  if (downloadEventBridgeReady) {
    return;
  }
  downloadEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.downloadsEvent,
    (_event: Electron.IpcRendererEvent, payload: DownloadManagerEvent): void => {
      if (payload === null || typeof payload !== "object" || typeof payload.kind !== "string") {
        return;
      }
      for (const listener of downloadEventListeners) {
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

const ensureWorkbenchObservationBridge = (): void => {
  if (workbenchObservationBridgeReady) {
    return;
  }
  workbenchObservationBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.workbenchObservationQuery,
    (_event: Electron.IpcRendererEvent, payload: WorkbenchObservationQueryRequest): void => {
      const handler = workbenchObservationHandler;
      if (handler === null) {
        void ipcRenderer.invoke(LYRA_CHANNELS.workbenchObservationQueryResult, {
          requestId: payload.requestId,
          ok: false,
          error: {
            code: "renderer_bridge_unavailable",
            message: "Renderer workbench observation handler is not registered."
          }
        } satisfies WorkbenchObservationQueryResult);
        return;
      }

      void Promise.resolve(handler(payload))
        .catch((error: unknown): WorkbenchObservationQueryResult => ({
          requestId: payload.requestId,
          ok: false,
          error: {
            code: "renderer_bridge_unavailable",
            message: error instanceof Error ? error.message : String(error)
          }
        }))
        .then((result) =>
          ipcRenderer.invoke(LYRA_CHANNELS.workbenchObservationQueryResult, result)
        );
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
  systemNotifications: {
    readStatus: () =>
      (ipcRenderer.invoke(
        LYRA_CHANNELS.systemNotificationsReadStatus
      ) as Promise<SystemNotificationStatus>).then((status) =>
        withBrowserNotificationPermission(status)
      ),
    requestAccess: async () => {
      const hostStatus = await ipcRenderer.invoke(
        LYRA_CHANNELS.systemNotificationsReadStatus
      ) as SystemNotificationStatus;
      if (hostStatus.supported === false) {
        return {
          ...withBrowserNotificationPermission(hostStatus, "unsupported"),
          openedSettings: false
        } satisfies SystemNotificationAccessRequestResult;
      }
      const permission = await requestBrowserNotificationPermission();
      const openedSettings =
        permission === "granted"
          ? false
          : (await ipcRenderer.invoke(
              LYRA_CHANNELS.systemNotificationsOpenSettings
            ) as SystemNotificationOpenSettingsResult).opened;
      return {
        ...withBrowserNotificationPermission(hostStatus, permission),
        openedSettings
      } satisfies SystemNotificationAccessRequestResult;
    },
    openSettings: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.systemNotificationsOpenSettings
      ) as Promise<SystemNotificationOpenSettingsResult>,
    show: (request: SystemNotificationShowRequest) => {
      if (readBrowserNotificationPermission() !== "granted") {
        return Promise.resolve({
          status: "skipped",
          reason: "permission"
        } satisfies SystemNotificationShowResult);
      }
      return ipcRenderer.invoke(
        LYRA_CHANNELS.systemNotificationsShow,
        request
      ) as Promise<SystemNotificationShowResult>;
    },
    onActivated: (listener: (event: SystemNotificationActivation) => void) => {
      ensureSystemNotificationActivationBridge();
      systemNotificationActivationListeners.add(listener);
      return () => {
        systemNotificationActivationListeners.delete(listener);
      };
    }
  },
  linuxCompat: {
    readStatus: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.linuxCompatReadStatus) as Promise<LinuxCompatReadStatusResponse>,
    readConfig: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.linuxCompatReadConfig) as Promise<LinuxCompatReadConfigResponse>,
    updateConfig: (request: LinuxCompatUpdateConfigRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.linuxCompatUpdateConfig,
        request
      ) as Promise<LinuxCompatUpdateConfigResponse>,
    requestRestart: (request?: LinuxCompatRestartRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.linuxCompatRestart,
        request
      ) as Promise<LinuxCompatRestartResponse>,
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
  files: {
    readHome: () => ipcRenderer.invoke(LYRA_CHANNELS.filesReadHome) as Promise<FileManagerReadHomeResponse>,
    readDirectory: (request: FileManagerReadDirectoryRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesReadDirectory, request) as Promise<FileManagerReadDirectoryResponse>,
    subscribeDirectory: (request: FileManagerSubscribeDirectoryRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.filesSubscribeDirectory,
        request
      ) as Promise<FileManagerSubscribeDirectoryResponse>,
    unsubscribeDirectory: async (subscriptionId: string) => {
      await ipcRenderer.invoke(LYRA_CHANNELS.filesUnsubscribeDirectory, { subscriptionId });
    },
    onDirectoryPatch: (listener: (patch: FileManagerDirectoryPatch) => void) => {
      ensureDirectoryPatchBridge();
      directoryPatchListeners.add(listener);
      return () => {
        directoryPatchListeners.delete(listener);
      };
    },
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
      ipcRenderer.invoke(LYRA_CHANNELS.filesStatFile, request) as Promise<FileStatResult>,
    selectAttachments: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesSelectAttachments) as Promise<readonly FileManagerSelectedAttachment[]>,
    selectDirectories: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.filesSelectDirectories) as Promise<readonly FileManagerSelectedAttachment[]>
  },
  downloads: {
    list: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsList) as Promise<DownloadManagerSnapshot>,
    enqueue: (request: DownloadManagerEnqueueRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsEnqueue, request) as Promise<DownloadManagerSnapshot>,
    importExternalBrowser: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsImportExternalBrowser) as Promise<DownloadManagerSnapshot>,
    pause: (request: DownloadManagerTaskRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsPause, request) as Promise<DownloadManagerTask | null>,
    resume: (request: DownloadManagerTaskRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsResume, request) as Promise<DownloadManagerTask | null>,
    cancel: (request: DownloadManagerTaskRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsCancel, request) as Promise<DownloadManagerTask | null>,
    retry: (request: DownloadManagerTaskRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsRetry, request) as Promise<DownloadManagerTask | null>,
    remove: async (request: DownloadManagerTaskRequest) => {
      await ipcRenderer.invoke(LYRA_CHANNELS.downloadsRemove, request);
    },
    setPriority: (request: DownloadManagerSetPriorityRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsSetPriority, request) as Promise<DownloadManagerTask | null>,
    pauseAll: (request?: DownloadManagerBatchRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsPauseAll, request) as Promise<DownloadManagerSnapshot>,
    resumeAll: (request?: DownloadManagerBatchRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsResumeAll, request) as Promise<DownloadManagerSnapshot>,
    cancelAll: (request?: DownloadManagerBatchRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsCancelAll, request) as Promise<DownloadManagerSnapshot>,
    readSettings: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsReadSettings) as Promise<DownloadManagerSettings>,
    updateSettings: (request: DownloadManagerUpdateSettingsRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsUpdateSettings, request) as Promise<DownloadManagerSettings>,
    readRemoteApiStatus: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsRemoteStatus) as Promise<DownloadManagerRemoteApiStatus>,
    startRemoteApi: (request?: DownloadManagerRemoteApiStartRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsRemoteStart, request) as Promise<DownloadManagerRemoteApiStatus>,
    stopRemoteApi: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsRemoteStop) as Promise<DownloadManagerRemoteApiStatus>,
    openFile: (request: DownloadManagerTaskRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsOpenFile, request) as Promise<boolean>,
    revealFile: (request: DownloadManagerTaskRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.downloadsRevealFile, request) as Promise<boolean>,
    onEvent: (listener: (event: DownloadManagerEvent) => void) => {
      ensureDownloadEventBridge();
      downloadEventListeners.add(listener);
      return () => {
        downloadEventListeners.delete(listener);
      };
    }
  },
  imageViewer: {
    openImage: (request: ImageViewerOpenRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.imageViewerOpenImage, request) as Promise<ImageViewerOpenResult>,
    readTile: (request: ImageViewerReadTileRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.imageViewerReadTile, request) as Promise<ImageViewerTileResponse>,
    closeSession: async (request: ImageViewerCloseSessionRequest) => {
      await ipcRenderer.invoke(LYRA_CHANNELS.imageViewerCloseSession, request);
    },
    onEvent: (listener: (event: ImageViewerEvent) => void) => {
      ensureImageViewerEventBridge();
      imageViewerEventListeners.add(listener);
      return () => {
        imageViewerEventListeners.delete(listener);
      };
    }
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
    setElementPickerMode: (request: WorkbenchBrowserSetElementPickerModeRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserSetElementPickerMode,
        request
      ) as Promise<void>,
    applyWebTheme: (snapshot: WorkbenchBrowserWebThemeSnapshot) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserApplyWebTheme,
        snapshot
      ) as Promise<void>,
    onEvent: (listener: (event: WorkbenchBrowserEvent) => void) => {
      ensureWorkbenchBrowserEventBridge();
      workbenchBrowserEventListeners.add(listener);
      return () => {
        workbenchBrowserEventListeners.delete(listener);
      };
    }
  },
  resources: {
    readSnapshot: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.resourcesReadSnapshot
      ) as Promise<LyraResourceSnapshot>,
    readSystemSnapshot: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.resourcesReadSystemSnapshot
      ) as Promise<LyraSystemSnapshot>,
    registerOrUpdate: (request: LyraResourceRegisterRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.resourcesRegisterOrUpdate,
        request
      ) as Promise<void>,
    remove: (resourceId: string) =>
      ipcRenderer.invoke(LYRA_CHANNELS.resourcesRemove, resourceId) as Promise<void>,
    requestLifecycle: (request: LyraResourceLifecycleRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.resourcesRequestLifecycle,
        request
      ) as Promise<void>,
    requestActivityAction: (request: LyraSystemActivityActionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.resourcesRequestActivityAction,
        request
      ) as Promise<LyraSystemActivityActionResult>,
    onEvent: (listener: (event: LyraResourceEvent) => void) => {
      ensureResourceEventBridge();
      resourceEventListeners.add(listener);
      return () => {
        resourceEventListeners.delete(listener);
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
  ai: {
    readConfig: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiReadConfig) as Promise<AiRuntimeConfigSnapshot>,
    upsertProfile: (request: AiUpsertProfileRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiUpsertProfile, request) as Promise<AiProviderProfile>,
    deleteProfile: (request: AiDeleteProfileRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiDeleteProfile, request) as Promise<void>,
    discoverModels: (request: AiDiscoverModelsRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiDiscoverModels, request) as Promise<AiModelDiscoveryResult>,
    listSessions: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiListSessions) as Promise<readonly AgentSession[]>,
    createSession: (request: AgentCreateSessionRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiCreateSession, request) as Promise<AgentSessionDetail>,
    readSession: (request: AgentReadSessionRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiReadSession, request) as Promise<AgentSessionDetail>,
    updateSession: (request: AgentUpdateSessionRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiUpdateSession, request) as Promise<AgentSessionDetail>,
    sendTurn: (request: AgentSendTurnRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiSendTurn, request) as Promise<AgentSendTurnResult>,
    cancelTurn: (request: AgentCancelTurnRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiCancelTurn, request) as Promise<AgentCancelTurnResult>,
    createTodo: (request: AgentCreateTodoRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiCreateTodo, request) as Promise<AgentCreateTodoResult>,
    readArtifact: (request: AgentReadArtifactRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiReadArtifact, request) as Promise<AgentArtifactContent>,
    applyPatch: (request: AgentApplyPatchRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiApplyPatch, request) as Promise<AgentApplyPatchResult>,
    resolveApproval: (request: AgentResolveApprovalRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.aiResolveApproval, request) as Promise<AgentResolveApprovalResult>,
    onAgentEvent: (listener: (event: AgentRuntimeStreamEvent) => void) => {
      ensureAiEventBridge();
      aiEventListeners.add(listener);
      return () => {
        aiEventListeners.delete(listener);
      };
    }
  },
  workbenchObservation: {
    registerHandler: (handler) => {
      ensureWorkbenchObservationBridge();
      workbenchObservationHandler = handler;
      return () => {
        if (workbenchObservationHandler === handler) {
          workbenchObservationHandler = null;
        }
      };
    }
  },
  uiux: {
    listPacks: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.uiuxListPacks) as Promise<UiuxListPacksResponse>,
    installFromLocal: (request: UiuxInstallFromLocalRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.uiuxInstallFromLocal, request) as Promise<InstalledUiuxPack>,
    installFromGit: (request: UiuxInstallFromGitRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.uiuxInstallFromGit, request) as Promise<InstalledUiuxPack>,
    installFromNpm: (request: UiuxInstallFromNpmRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.uiuxInstallFromNpm, request) as Promise<InstalledUiuxPack>,
    setTrustState: (request: UiuxSetTrustStateRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.uiuxSetTrustState, request) as Promise<InstalledUiuxPack>,
    requestActivation: (request: UiuxRequestActivationRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.uiuxRequestActivation,
        request
      ) as Promise<UiuxRequestActivationResponse>,
    resolveRuntime: (request: UiuxResolveRuntimeRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.uiuxResolveRuntime, request) as Promise<UiuxPackRuntime | null>
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
