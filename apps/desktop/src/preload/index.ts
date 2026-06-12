import { contextBridge, ipcRenderer } from "electron";

import {
  LYRA_CHANNELS,
  type AgentBrowserFollowModeSnapshot,
  type AgentBrowserFollowModeUpdateRequest,
  type AgentClarificationRespondRequest,
  type AgentGitDiffRequest,
  type AgentGitDiffResponse,
  type AgentGitFileRequest,
  type AgentGitMutationResponse,
  type AgentGitStatusRequest,
  type AgentGitStatusSnapshot,
  type AgentImageAttachmentMaterializeRequest,
  type AgentImageAttachmentMaterializeResponse,
  type AgentMemoryAuditResponse,
  type AgentMemorySharedSearchRequest,
  type AgentMemorySharedUpdateRequest,
  type AgentMemorySnapshot,
  type AgentMemoryTrimRunRequest,
  type AgentPermissionPolicySetModeRequest,
  type AgentPermissionPolicySnapshot,
  type AgentPermissionRespondRequest,
  type AgentRollbackPreviewResponse,
  type AgentRollbackRequest,
  type AgentRollbackRestoreResponse,
  type AgentRuntimeEvent,
  type AgentSelfDevStartRequest,
  type AgentSelfDevStartResponse,
  type AgentSelfDevStatusRequest,
  type AgentSelfDevStatusResponse,
  type AgentSessionArchiveRequest,
  type AgentSessionBindProjectRequest,
  type AgentSessionCreateRequest,
  type AgentSessionDeleteRequest,
  type AgentSessionDeleteResponse,
  type AgentSessionReadRequest,
  type AgentSessionRenameRequest,
  type AgentSessionSaveRequest,
  type AgentSessionSnapshot,
  type AgentTurnCancelRequest,
  type AgentTurnCancelResponse,
  type AgentTurnSendRequest,
  type AgentTurnSendResponse,
  type AppMetaPayload,
  type AgentAccountLoginCompleteRequest,
  type AgentAccountLoginCompleteResponse,
  type AgentAccountLoginRequest,
  type AgentAccountLoginStartRequest,
  type AgentAccountLoginStartResponse,
  type AgentAccountRequest,
  type AgentAccountsSnapshot,
  type AgentAutomationUpdateRequest,
  type AgentAutomationUpdateResponse,
  type AgentBtwRunRequest,
  type AgentCompactResponse,
  type AgentConfigSnapshot,
  type AgentConfigUpdateRequest,
  type AgentActionRunRequest,
  type AgentRolesUpdateRequest,
  type AgentFeedbackRunRequest,
  type AgentGoalsRequest,
  type AgentGoalsResponse,
  type AgentLoginProviderCatalogSnapshot,
  type AgentModelRefreshRequest,
  type AgentModelCatalogRequest,
  type AgentModelCatalogSnapshot,
  type AgentModelSwitchRequest,
  type AgentOvernightListResponse,
  type AgentOvernightRunRequest,
  type AgentOvernightRunResponse,
  type AgentOvernightStartRequest,
  type AgentOvernightStartResponse,
  type AgentProviderOptionsUpdateRequest,
  type AgentProviderProfileSaveRequest,
  type AgentPokeRequest,
  type AgentPokeResponse,
  type AgentSessionActionRequest,
  type AgentSessionForkResponse,
  type AgentSessionSummary,
  type AgentSessionListRequest,
  type AgentSessionListResponse,
  type AgentSidePanelActionResponse,
  type AgentSubagentRunRequest,
  type AgentSubagentRunResponse,
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
  type LinuxCompatReadConfigResponse,
  type LinuxCompatReadStatusResponse,
  type LinuxCompatRestartRequest,
  type LinuxCompatRestartResponse,
  type LinuxCompatUpdateConfigRequest,
  type LinuxCompatUpdateConfigResponse,
  type LspCompletionRequest,
  type LspCompletionResult,
  type LspDocumentRequest,
  type LspRuntimeEvent,
  type TerminalCloseRequest,
  type TerminalActExecuteRequest,
  type TerminalActExecuteResponse,
  type TerminalAttachmentAttachRequest,
  type TerminalAttachmentAttachResponse,
  type TerminalAttachmentDetachRequest,
  type TerminalAttachmentDetachResponse,
  type TerminalAttachmentListRequest,
  type TerminalAttachmentListResponse,
  type TerminalAttachmentPauseRequest,
  type TerminalAttachmentPauseResponse,
  type TerminalAttachmentResumeRequest,
  type TerminalAttachmentResumeResponse,
  type TerminalArtifactsListRequest,
  type TerminalArtifactsListResponse,
  type TerminalCommandOutputReadRequest,
  type TerminalCommandOutputReadResponse,
  type TerminalCommandStatusRequest,
  type TerminalCommandStatusResponse,
  type TerminalCommandWaitRequest,
  type TerminalCommandWaitResponse,
  type TerminalCommandsReadRequest,
  type TerminalCommandsReadResponse,
  type TerminalCreateRequest,
  type TerminalDataEvent,
  type TerminalErrorEvent,
  type TerminalEventsReadRequest,
  type TerminalEventsReadResponse,
  type TerminalEvent,
  type TerminalExitEvent,
  type TerminalInputExecuteRequest,
  type TerminalInputExecuteResponse,
  type TerminalMapReadRequest,
  type TerminalMapReadResponse,
  type TerminalMemoryTimelineReadRequest,
  type TerminalMemoryTimelineReadResponse,
  type TerminalOutputRangeReadRequest,
  type TerminalOutputRangeReadResponse,
  type TerminalPermissionEvaluateRequest,
  type TerminalPermissionEvaluateResponse,
  type TerminalPermissionRespondRequest,
  type TerminalPermissionRespondResponse,
  type TerminalProcessesReadRequest,
  type TerminalProcessesReadResponse,
  type TerminalProcessSignalRequest,
  type TerminalProcessSignalResponse,
  type TerminalDataAckRequest,
  type TerminalReadRequest,
  type TerminalReadResponse,
  type TerminalReloadPromptRequest,
  type TerminalReloadPromptResult,
  type TerminalRendererAttachRequest,
  type TerminalRendererAttachResponse,
  type TerminalRendererDetachRequest,
  type TerminalResizeRequest,
  type TerminalScreenReadRequest,
  type TerminalScreenReadResponse,
  type TerminalRestoreRequest,
  type TerminalSessionSnapshot,
  type TerminalWaitUntilRequest,
  type TerminalWaitUntilResponse,
  type TerminalWriteRequest,
  type SearchResolveWebEngineRequest,
  type SearchResolveWebEngineResponse,
  type SearchLocalRequest,
  type SearchLocalResponse,
  type SearchLocalStreamCancelRequest,
  type SearchLocalStreamCancelResponse,
  type SearchLocalStreamReadRequest,
  type SearchLocalStreamReadResponse,
  type SearchLocalStreamStartRequest,
  type SearchLocalStreamStartResponse,
  type SearchIndexStatusRequest,
  type SearchIndexStatusResponse,
  type SearchRebuildIndexRequest,
  type SearchRebuildIndexResponse,
  type SystemNotificationAccessRequestResult,
  type SystemNotificationActivation,
  type SystemNotificationOpenSettingsResult,
  type SystemNotificationPermission,
  type SystemNotificationShowRequest,
  type SystemNotificationShowResult,
  type SystemNotificationStatus,
  type ImageViewerCloseSessionRequest,
  type ImageViewerEvent,
  type ImageViewerOpenRequest,
  type ImageViewerOpenResult,
  type ImageViewerReadTileRequest,
  type ImageViewerTileResponse,
  type LoginManagerClearSiteRequest,
  type LoginManagerClearSiteResponse,
  type LoginManagerDeleteCredentialRequest,
  type LoginManagerEvent,
  type LoginManagerFillCredentialRequest,
  type LoginManagerFillCredentialResponse,
  type LoginManagerRevealCredentialRequest,
  type LoginManagerRevealCredentialResponse,
  type LoginManagerSnapshot,
  type LoginManagerUpdateSessionRequest,
  type LyraSensitiveValueRevealRequest,
  type LyraSensitiveValueRevealResponse,
  type LyraSensitiveValueStoreRequest,
  type LyraSensitiveValueStoreResponse,
  type UiuxInstallFromGitRequest,
  type UiuxInstallFromLocalRequest,
  type UiuxInstallFromNpmRequest,
  type UiuxListPacksResponse,
  type UiuxPackRuntime,
  type UiuxRequestActivationRequest,
  type UiuxRequestActivationResponse,
  type UiuxResolveRuntimeRequest,
  type UiuxSetTrustStateRequest,
  type UiuxUninstallRequest,
  type UiuxUninstallResponse,
  type SoftwareCapabilitiesQueryRequest,
  type SoftwareCapabilitiesQueryResult,
  type InstalledUiuxPack,
  type WorkbenchBrowserEvent,
  type BrowserSessionSnapshot,
  type BrowserStorageStateRef,
  type WorkbenchBrowserChromePopoverRequest,
  type WorkbenchBrowserClearSiteDataRequest,
  type WorkbenchBrowserClearSiteDataResult,
  type WorkbenchBrowserSetElementPickerModeRequest,
  type WorkbenchBrowserLayoutSnapshot,
  type WorkbenchBrowserNavigateRequest,
  type WorkbenchBrowserWebThemeSnapshot,
  type WorkbenchBrowserNavigateResult,
  type WorkbenchObservationQueryRequest,
  type WorkbenchObservationQueryResult,
  type WorkbenchVisualCaptureRequest,
  type WorkbenchVisualCaptureResult,
  type WorkbenchBrowserPageRuntimeState,
  type WorkbenchBrowserReadPageStateRequest,
  type WorkbenchBrowserSearchInPageRequest,
  type WorkbenchBrowserSearchInPageResult,
  type WorkbenchBrowserStorageStateRequest,
  type WorkbenchBrowserTopologySnapshot,
  type WorkbenchStateKey,
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
  windowMaterialMode: "opaque",
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
let terminalDataPortRequested = false;
let terminalDataPort: MessagePort | null = null;
const workbenchBrowserEventListeners = new Set<(event: WorkbenchBrowserEvent) => void>();
let workbenchBrowserEventBridgeReady = false;
const loginManagerEventListeners = new Set<(event: LoginManagerEvent) => void>();
let loginManagerEventBridgeReady = false;
const systemNotificationActivationListeners = new Set<(
  event: SystemNotificationActivation
) => void>();
let systemNotificationActivationBridgeReady = false;
const imageViewerEventListeners = new Set<(event: ImageViewerEvent) => void>();
let imageViewerEventBridgeReady = false;
const directoryPatchListeners = new Set<(patch: FileManagerDirectoryPatch) => void>();
let directoryPatchBridgeReady = false;
const downloadEventListeners = new Set<(event: DownloadManagerEvent) => void>();
let downloadEventBridgeReady = false;
const lspEventListeners = new Set<(event: LspRuntimeEvent) => void>();
let lspEventBridgeReady = false;
const agentEventListeners = new Set<(event: AgentRuntimeEvent) => void>();
let agentEventBridgeReady = false;
let workbenchObservationHandler:
  | ((
      request: WorkbenchObservationQueryRequest
    ) => Promise<WorkbenchObservationQueryResult> | WorkbenchObservationQueryResult)
  | null = null;
let workbenchObservationBridgeReady = false;
let softwareCapabilitiesHandler:
  | ((
      request: SoftwareCapabilitiesQueryRequest
    ) => Promise<SoftwareCapabilitiesQueryResult> | SoftwareCapabilitiesQueryResult)
  | null = null;
let softwareCapabilitiesBridgeReady = false;

const ensureTerminalEventBridge = (): void => {
  if (terminalEventBridgeReady) {
    return;
  }
  terminalEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.terminalDataPort,
    (event: Electron.IpcRendererEvent): void => {
      const port = event.ports[0];
      if (port === undefined) {
        return;
      }
      terminalDataPort?.close();
      terminalDataPort = port;
      terminalDataPort.onmessage = (messageEvent: MessageEvent<TerminalDataEvent>) => {
        const payload = messageEvent.data;
        if (payload === null || typeof payload !== "object" || payload.kind !== "data") {
          return;
        }
        for (const listener of terminalDataListeners) {
          listener(payload);
        }
      };
      terminalDataPort.start();
    }
  );

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

const ensureTerminalDataPort = (): void => {
  ensureTerminalEventBridge();
  if (terminalDataPortRequested) {
    return;
  }
  terminalDataPortRequested = true;
  void ipcRenderer.invoke(LYRA_CHANNELS.terminalConnectDataPort).catch((_error) => {
    terminalDataPortRequested = false;
  });
};

const writeTerminalFast = (request: TerminalWriteRequest): boolean => {
  ensureTerminalDataPort();
  if (terminalDataPort === null) {
    return false;
  }
  try {
    terminalDataPort.postMessage({
      kind: "input",
      request
    });
    return true;
  } catch (_error) {
    return false;
  }
};

const ensureAgentEventBridge = (): void => {
  if (agentEventBridgeReady) {
    return;
  }
  agentEventBridgeReady = true;
  ipcRenderer.on(
    LYRA_CHANNELS.agentEvent,
    (_event: Electron.IpcRendererEvent, payload: AgentRuntimeEvent): void => {
      if (payload === null || typeof payload !== "object" || !("kind" in payload)) {
        return;
      }
      for (const listener of agentEventListeners) {
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

const ensureLoginManagerEventBridge = (): void => {
  if (loginManagerEventBridgeReady) {
    return;
  }
  loginManagerEventBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.loginManagerEvent,
    (_event: Electron.IpcRendererEvent, payload: LoginManagerEvent): void => {
      if (payload === null || typeof payload !== "object" || payload.kind !== "snapshot") {
        return;
      }
      for (const listener of loginManagerEventListeners) {
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

const ensureSoftwareCapabilitiesBridge = (): void => {
  if (softwareCapabilitiesBridgeReady) {
    return;
  }
  softwareCapabilitiesBridgeReady = true;

  ipcRenderer.on(
    LYRA_CHANNELS.softwareCapabilitiesQuery,
    (_event: Electron.IpcRendererEvent, payload: SoftwareCapabilitiesQueryRequest): void => {
      const handler = softwareCapabilitiesHandler;
      if (handler === null) {
        void ipcRenderer.invoke(LYRA_CHANNELS.softwareCapabilitiesQueryResult, {
          requestId: payload.requestId,
          ok: false,
          error: {
            code: "renderer_bridge_unavailable",
            message: "Renderer software capability handler is not registered."
          }
        } satisfies SoftwareCapabilitiesQueryResult);
        return;
      }

      void Promise.resolve(handler(payload))
        .catch((error: unknown): SoftwareCapabilitiesQueryResult => ({
          requestId: payload.requestId,
          ok: false,
          error: {
            code: "renderer_bridge_unavailable",
            message: error instanceof Error ? error.message : String(error)
          }
        }))
        .then((result) =>
          ipcRenderer.invoke(LYRA_CHANNELS.softwareCapabilitiesQueryResult, result)
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
      ) as Promise<LinuxCompatRestartResponse>
  },
  search: {
    resolveWebSearchEngine: (request: SearchResolveWebEngineRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.resolveWebSearchEngine,
        request
      ) as Promise<SearchResolveWebEngineResponse>,
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
    readIndexStatus: (request?: SearchIndexStatusRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.searchIndexStatus,
        request ?? {}
      ) as Promise<SearchIndexStatusResponse>,
    rebuildIndex: (request?: SearchRebuildIndexRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.searchIndexRebuild,
        request ?? {}
      ) as Promise<SearchRebuildIndexResponse>
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
    readSessionSnapshot: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserReadSessionSnapshot
      ) as Promise<BrowserSessionSnapshot | null>,
    readStorageState: (request?: WorkbenchBrowserStorageStateRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserReadStorageState,
        request ?? {}
      ) as Promise<BrowserStorageStateRef>,
    clearSiteData: (request: WorkbenchBrowserClearSiteDataRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserClearSiteData,
        request
      ) as Promise<WorkbenchBrowserClearSiteDataResult>,
    searchInPage: (request: WorkbenchBrowserSearchInPageRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserSearchInPage,
        request
      ) as Promise<WorkbenchBrowserSearchInPageResult>,
    setChromePopover: (request: WorkbenchBrowserChromePopoverRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserSetChromePopover,
        request
      ) as Promise<void>,
    setElementPickerMode: (request: WorkbenchBrowserSetElementPickerModeRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserSetElementPickerMode,
        request
      ) as Promise<void>,
    setModalOcclusion: (request: { readonly active: boolean }) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserSetModalOcclusion,
        request
      ) as Promise<void>,
    applyWebTheme: (snapshot: WorkbenchBrowserWebThemeSnapshot) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserApplyWebTheme,
        snapshot
      ) as Promise<void>,
    capturePage: (request?: WorkbenchVisualCaptureRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserCapturePage,
        request ?? {}
      ) as Promise<WorkbenchVisualCaptureResult>,
    captureWindow: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.workbenchBrowserCaptureWindow
      ) as Promise<WorkbenchVisualCaptureResult>,
    onEvent: (listener: (event: WorkbenchBrowserEvent) => void) => {
      ensureWorkbenchBrowserEventBridge();
      workbenchBrowserEventListeners.add(listener);
      return () => {
        workbenchBrowserEventListeners.delete(listener);
      };
    }
  },
  loginManager: {
    list: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.loginManagerList) as Promise<LoginManagerSnapshot>,
    updateSession: (request: LoginManagerUpdateSessionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.loginManagerUpdateSession,
        request
      ) as Promise<LoginManagerSnapshot>,
    deleteCredential: (request: LoginManagerDeleteCredentialRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.loginManagerDeleteCredential,
        request
      ) as Promise<LoginManagerSnapshot>,
    revealCredential: (request: LoginManagerRevealCredentialRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.loginManagerRevealCredential,
        request
      ) as Promise<LoginManagerRevealCredentialResponse>,
    fillCredential: (request: LoginManagerFillCredentialRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.loginManagerFillCredential,
        request
      ) as Promise<LoginManagerFillCredentialResponse>,
    clearSite: (request: LoginManagerClearSiteRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.loginManagerClearSite,
        request
      ) as Promise<LoginManagerClearSiteResponse>,
    onEvent: (listener: (event: LoginManagerEvent) => void) => {
      ensureLoginManagerEventBridge();
      loginManagerEventListeners.add(listener);
      return () => {
        loginManagerEventListeners.delete(listener);
      };
    }
  },
  sensitiveValues: {
    store: async (
      request: LyraSensitiveValueStoreRequest
    ): Promise<LyraSensitiveValueStoreResponse> =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.sensitiveValuesStore,
        request
      ) as Promise<LyraSensitiveValueStoreResponse>,
    revealToUser: async (
      request: LyraSensitiveValueRevealRequest
    ): Promise<LyraSensitiveValueRevealResponse> =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.sensitiveValuesRevealToUser,
        request
      ) as Promise<LyraSensitiveValueRevealResponse>
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
    attachRenderer: (request: TerminalRendererAttachRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalAttachRenderer, request) as Promise<TerminalRendererAttachResponse>,
    detachRenderer: (request: TerminalRendererDetachRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalDetachRenderer, request) as Promise<void>,
    ackData: (request: TerminalDataAckRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalAckData, request) as Promise<void>,
    reloadPrompt: (request: TerminalReloadPromptRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalReloadPrompt, request) as Promise<TerminalReloadPromptResult>,
    writeFast: (request: TerminalWriteRequest) => writeTerminalFast(request),
    write: (request: TerminalWriteRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalWriteSession, request) as Promise<void>,
    read: (request: TerminalReadRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalReadSession, request) as Promise<TerminalReadResponse>,
    readScreen: (request: TerminalScreenReadRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalReadScreen, request) as Promise<TerminalScreenReadResponse>,
    readEvents: (request: TerminalEventsReadRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalReadEvents, request) as Promise<TerminalEventsReadResponse>,
    readCommands: (request: TerminalCommandsReadRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalReadCommands, request) as Promise<TerminalCommandsReadResponse>,
    readOutputRange: (request: TerminalOutputRangeReadRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalReadOutputRange, request) as Promise<
        TerminalOutputRangeReadResponse
      >,
    listArtifacts: (request: TerminalArtifactsListRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalListArtifacts, request) as Promise<
        TerminalArtifactsListResponse
      >,
    readMemoryTimeline: (request: TerminalMemoryTimelineReadRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalReadMemoryTimeline, request) as Promise<
        TerminalMemoryTimelineReadResponse
      >,
    waitUntil: (request: TerminalWaitUntilRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalWaitUntil, request) as Promise<TerminalWaitUntilResponse>,
    executeInput: (request: TerminalInputExecuteRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalInputExecute, request) as Promise<
        TerminalInputExecuteResponse
      >,
    evaluatePermission: (request: TerminalPermissionEvaluateRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalPermissionsEvaluate, request) as Promise<
        TerminalPermissionEvaluateResponse
      >,
    respondPermission: (request: TerminalPermissionRespondRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalPermissionsRespond, request) as Promise<
        TerminalPermissionRespondResponse
      >,
    readProcesses: (request: TerminalProcessesReadRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalProcessesRead, request) as Promise<
        TerminalProcessesReadResponse
      >,
    signalProcess: (request: TerminalProcessSignalRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalProcessesSignal, request) as Promise<
        TerminalProcessSignalResponse
      >,
    readCommandStatus: (request: TerminalCommandStatusRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalCommandStatus, request) as Promise<
        TerminalCommandStatusResponse
      >,
    waitCommand: (request: TerminalCommandWaitRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalCommandWait, request) as Promise<
        TerminalCommandWaitResponse
      >,
    readCommandOutput: (request: TerminalCommandOutputReadRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalCommandReadOutput, request) as Promise<
        TerminalCommandOutputReadResponse
      >,
    readMap: (request: TerminalMapReadRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalMapRead, request) as Promise<TerminalMapReadResponse>,
    executeAct: (request: TerminalActExecuteRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalActExecute, request) as Promise<
        TerminalActExecuteResponse
      >,
    attachAgent: (request: TerminalAttachmentAttachRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalAttachmentsAttach, request) as Promise<
        TerminalAttachmentAttachResponse
      >,
    detachAgent: (request: TerminalAttachmentDetachRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalAttachmentsDetach, request) as Promise<
        TerminalAttachmentDetachResponse
      >,
    listAttachments: (request: TerminalAttachmentListRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalAttachmentsList, request) as Promise<
        TerminalAttachmentListResponse
      >,
    pauseAttachment: (request: TerminalAttachmentPauseRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalAttachmentsPause, request) as Promise<
        TerminalAttachmentPauseResponse
      >,
    resumeAttachment: (request: TerminalAttachmentResumeRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalAttachmentsResume, request) as Promise<
        TerminalAttachmentResumeResponse
      >,
    resize: (request: TerminalResizeRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalResizeSession, request) as Promise<void>,
    closeSession: (request: TerminalCloseRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.terminalCloseSession, request) as Promise<void>,
    onData: (listener: (event: TerminalDataEvent) => void) => {
      ensureTerminalDataPort();
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
  agent: {
    createSession: (request?: AgentSessionCreateRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionCreate,
        request ?? {}
      ) as Promise<AgentSessionSnapshot>,
    readSession: (request?: AgentSessionReadRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionRead,
        request ?? {}
      ) as Promise<AgentSessionSnapshot>,
    listSessions: (request?: AgentSessionListRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionList,
        request ?? {}
      ) as Promise<AgentSessionListResponse>,
    saveSession: (request: AgentSessionSaveRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionSave,
        request
      ) as Promise<AgentSessionSummary>,
    unsaveSession: (request: AgentSessionDeleteRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionUnsave,
        request
      ) as Promise<AgentSessionSummary>,
    renameSession: (request: AgentSessionRenameRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionRename,
        request
      ) as Promise<AgentSessionSummary>,
    archiveSession: (request: AgentSessionArchiveRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionArchive,
        request
      ) as Promise<AgentSessionSummary>,
    deleteSession: (request: AgentSessionDeleteRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionDelete,
        request
      ) as Promise<AgentSessionDeleteResponse>,
    bindProject: (request: AgentSessionBindProjectRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionBindProject,
        request
      ) as Promise<AgentSessionSnapshot>,
    startSelfDev: (request?: AgentSelfDevStartRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSelfDevStart,
        request ?? {}
      ) as Promise<AgentSelfDevStartResponse>,
    readSelfDevStatus: (request?: AgentSelfDevStatusRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSelfDevStatus,
        request ?? {}
      ) as Promise<AgentSelfDevStatusResponse>,
    sendSelfDevTurn: (request: AgentTurnSendRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSelfDevSendTurn,
        request
      ) as Promise<AgentTurnSendResponse>,
    startOvernight: (request: AgentOvernightStartRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentOvernightStart,
        request
      ) as Promise<AgentOvernightStartResponse>,
    listOvernightRuns: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentOvernightList
      ) as Promise<AgentOvernightListResponse>,
    readOvernightStatus: (request?: AgentOvernightRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentOvernightStatus,
        request ?? {}
      ) as Promise<AgentOvernightRunResponse>,
    readOvernightLog: (request?: AgentOvernightRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentOvernightLog,
        request ?? {}
      ) as Promise<AgentOvernightRunResponse>,
    readOvernightReview: (request?: AgentOvernightRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentOvernightReview,
        request ?? {}
      ) as Promise<AgentOvernightRunResponse>,
    cancelOvernight: (request?: AgentOvernightRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentOvernightCancel,
        request ?? {}
      ) as Promise<AgentOvernightRunResponse>,
    startTurn: (request: AgentTurnSendRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentTurnStart,
        request
      ) as Promise<AgentTurnSendResponse>,
    sendTurn: (request: AgentTurnSendRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentTurnSend,
        request
      ) as Promise<AgentTurnSendResponse>,
    resumeTurn: (request: AgentTurnSendRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentTurnResume,
        request
      ) as Promise<AgentTurnSendResponse>,
    cancelTurn: (request: AgentTurnCancelRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentTurnCancel,
        request
      ) as Promise<AgentTurnCancelResponse>,
    retryTurn: (request: AgentTurnSendRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentTurnRetry,
        request
      ) as Promise<AgentTurnSendResponse>,
    readMemorySnapshot: (request?: AgentSessionReadRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentMemorySnapshot,
        request ?? {}
      ) as Promise<AgentMemorySnapshot>,
    readMemoryAudit: (request?: AgentSessionReadRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentMemoryAudit,
        request ?? {}
      ) as Promise<AgentMemoryAuditResponse>,
    runMemoryTrim: (request?: AgentMemoryTrimRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentMemoryTrimRun,
        request ?? {}
      ) as Promise<unknown>,
    runMemoryRecovery: (request?: AgentSessionReadRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentMemoryRecoverRun,
        request ?? {}
      ) as Promise<unknown>,
    searchSharedMemory: (request?: AgentMemorySharedSearchRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentMemorySharedSearch,
        request ?? {}
      ) as Promise<{ readonly records: readonly unknown[] }>,
    updateSharedMemory: (request: AgentMemorySharedUpdateRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentMemorySharedUpdate,
        request
      ) as Promise<unknown>,
    previewRollback: (request: AgentRollbackRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentRollbackPreview,
        request
      ) as Promise<AgentRollbackPreviewResponse>,
    restoreRollback: (request: AgentRollbackRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentRollbackRestore,
        request
      ) as Promise<AgentRollbackRestoreResponse>,
    readGitStatus: (request: AgentGitStatusRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentGitStatus,
        request
      ) as Promise<AgentGitStatusSnapshot>,
    readGitDiff: (request: AgentGitDiffRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentGitDiff,
        request
      ) as Promise<AgentGitDiffResponse>,
    stageGitFile: (request: AgentGitFileRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentGitStage,
        request
      ) as Promise<AgentGitMutationResponse>,
    unstageGitFile: (request: AgentGitFileRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentGitUnstage,
        request
      ) as Promise<AgentGitMutationResponse>,
    discardGitFile: (request: AgentGitFileRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentGitDiscard,
        request
      ) as Promise<AgentGitMutationResponse>,
    respondClarification: (request: AgentClarificationRespondRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentClarificationRespond, request) as Promise<unknown>,
    respondPermission: (request: AgentPermissionRespondRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentPermissionRespond, request) as Promise<unknown>,
    readPermissionPolicy: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentPermissionPolicyRead
      ) as Promise<AgentPermissionPolicySnapshot>,
    setPermissionPolicyMode: (request: AgentPermissionPolicySetModeRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentPermissionPolicySetMode,
        request
      ) as Promise<AgentPermissionPolicySnapshot>,
    readAgentConfig: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentConfigRead) as Promise<AgentConfigSnapshot>,
    updateAgentConfig: (request: AgentConfigUpdateRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentConfigUpdate,
        request
      ) as Promise<AgentConfigSnapshot>,
    saveAgentProviderProfile: (request: AgentProviderProfileSaveRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentProviderProfileSave,
        request
      ) as Promise<AgentConfigSnapshot>,
    listAgentModels: (request?: AgentModelCatalogRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentModelsList,
        request ?? {}
      ) as Promise<AgentModelCatalogSnapshot>,
    switchAgentModel: (request: AgentModelSwitchRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentModelSwitch,
        request
      ) as Promise<AgentModelCatalogSnapshot>,
    refreshAgentModels: (request?: AgentModelRefreshRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentModelRefresh,
        request ?? {}
      ) as Promise<AgentModelCatalogSnapshot>,
    updateAgentProviderOptions: (request: AgentProviderOptionsUpdateRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentProviderOptionsUpdate,
        request
      ) as Promise<AgentModelCatalogSnapshot>,
    updateAgentRoles: (request: AgentRolesUpdateRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentRolesUpdate,
        request
      ) as Promise<AgentConfigSnapshot>,
    runImprove: (request?: AgentActionRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentImproveRun,
        request ?? {}
      ) as Promise<AgentTurnSendResponse>,
    runRefactor: (request?: AgentActionRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentRefactorRun,
        request ?? {}
      ) as Promise<AgentTurnSendResponse>,
    triggerPoke: (request?: AgentPokeRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentPokeTrigger,
        request ?? {}
      ) as Promise<AgentPokeResponse>,
    runReview: (request?: AgentFeedbackRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentReviewRun,
        request ?? {}
      ) as Promise<AgentTurnSendResponse>,
    runJudge: (request?: AgentFeedbackRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentJudgeRun,
        request ?? {}
      ) as Promise<AgentTurnSendResponse>,
    runSubagent: (request: AgentSubagentRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSubagentRun,
        request
      ) as Promise<AgentSubagentRunResponse>,
    runBtw: (request: AgentBtwRunRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentBtwRun,
        request
      ) as Promise<AgentSidePanelActionResponse>,
    splitSession: (request?: AgentSessionActionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionSplit,
        request ?? {}
      ) as Promise<AgentSessionForkResponse>,
    transferSession: (request?: AgentSessionActionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionTransfer,
        request ?? {}
      ) as Promise<AgentSessionForkResponse>,
    compactSession: (request?: AgentSessionActionRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionCompact,
        request ?? {}
      ) as Promise<AgentCompactResponse>,
    updateSessionAutomation: (request: AgentAutomationUpdateRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentSessionAutomationUpdate,
        request
      ) as Promise<AgentAutomationUpdateResponse>,
    listGoals: (request?: AgentGoalsRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentGoalsList,
        request ?? {}
      ) as Promise<AgentGoalsResponse>,
    openGoals: (request?: AgentGoalsRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentGoalsOpen,
        request ?? {}
      ) as Promise<AgentGoalsResponse>,
    resumeGoal: (request?: AgentGoalsRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentGoalsResume,
        request ?? {}
      ) as Promise<AgentGoalsResponse>,
    showGoal: (request: AgentGoalsRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentGoalsShow,
        request
      ) as Promise<AgentGoalsResponse>,
    listAccounts: () =>
      ipcRenderer.invoke(LYRA_CHANNELS.agentAccountsList) as Promise<AgentAccountsSnapshot>,
    loginAccount: (request: AgentAccountLoginRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentAccountsLogin,
        request
      ) as Promise<AgentAccountsSnapshot>,
    listLoginProviders: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentAccountsLoginProviders
      ) as Promise<AgentLoginProviderCatalogSnapshot>,
    startAccountLogin: (request: AgentAccountLoginStartRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentAccountsLoginStart,
        request
      ) as Promise<AgentAccountLoginStartResponse>,
    completeAccountLogin: (request: AgentAccountLoginCompleteRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentAccountsLoginComplete,
        request
      ) as Promise<AgentAccountLoginCompleteResponse>,
    switchAccount: (request: AgentAccountRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentAccountsSwitch,
        request
      ) as Promise<AgentAccountsSnapshot>,
    removeAccount: (request: AgentAccountRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentAccountsRemove,
        request
      ) as Promise<AgentAccountsSnapshot>,
    readBrowserFollowMode: () =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentBrowserFollowRead
      ) as Promise<AgentBrowserFollowModeSnapshot>,
    updateBrowserFollowMode: (request: AgentBrowserFollowModeUpdateRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentBrowserFollowUpdate,
        request
      ) as Promise<AgentBrowserFollowModeSnapshot>,
    materializeImageAttachment: (request: AgentImageAttachmentMaterializeRequest) =>
      ipcRenderer.invoke(
        LYRA_CHANNELS.agentImageAttachmentMaterialize,
        request
      ) as Promise<AgentImageAttachmentMaterializeResponse>,
    onEvent: (listener: (event: AgentRuntimeEvent) => void) => {
      ensureAgentEventBridge();
      agentEventListeners.add(listener);
      return () => {
        agentEventListeners.delete(listener);
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
  softwareCapabilities: {
    registerHandler: (handler) => {
      ensureSoftwareCapabilitiesBridge();
      softwareCapabilitiesHandler = handler;
      return () => {
        if (softwareCapabilitiesHandler === handler) {
          softwareCapabilitiesHandler = null;
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
    uninstall: (request: UiuxUninstallRequest) =>
      ipcRenderer.invoke(LYRA_CHANNELS.uiuxUninstall, request) as Promise<UiuxUninstallResponse>,
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
