import { ipcMain, type BrowserWindow } from "electron";

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
  type AiValidateProfileRequest
} from "../../shared/desktop-bridge";
import { loadAiNativeBindings } from "./native-loader";
import type {
  AiIpcBridge,
  AiNativeBindings,
  NativeAiCancelChatTurnRequest,
  NativeAiChatTurnRequest,
  NativeAiDeleteProfileRequest,
  NativeAiDiscoverModelsRequest,
  NativeAiReadPresetCatalogRequest,
  NativeAiReadProfilesRequest,
  NativeAiReadProviderCatalogRequest,
  NativeAiReadSessionHistoryRequest,
  NativeAiReadSessionRequest,
  NativeAiSetDefaultProfileRequest,
  NativeAiUpsertProfileRequest,
  NativeAiValidateProfileRequest
} from "./types";

const parseJson = <T>(payload: string): T => JSON.parse(payload) as T;

export const createAiIpcBridge = (
  storageRoot: string,
  getWindow: () => BrowserWindow | null
): AiIpcBridge => {
  const loadResult = loadAiNativeBindings();
  if (loadResult.ok === false) {
    throw new Error(
      `ai native unavailable: ${loadResult.errorMessage}\ntried paths:\n${loadResult.triedPaths.join("\n")}`
    );
  }

  const bindings: AiNativeBindings = loadResult.bindings;

  bindings.registerAiEventCallback((eventJson) => {
    const event = parseJson<AiRuntimeEvent>(eventJson);
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.aiEvent, event);
  });

  ipcMain.handle(LYRA_CHANNELS.aiReadProfiles, () => {
    const request: NativeAiReadProfilesRequest = { storageRoot };
    return parseJson<readonly AiProviderProfile[]>(
      bindings.readAiProfilesJson(JSON.stringify(request))
    );
  });

  ipcMain.handle(LYRA_CHANNELS.aiReadProviderCatalog, () => {
    const request: NativeAiReadProviderCatalogRequest = { storageRoot };
    return parseJson<readonly AiProviderCatalogItem[]>(
      bindings.readAiProviderCatalogJson(JSON.stringify(request))
    );
  });

  ipcMain.handle(LYRA_CHANNELS.aiReadPresetCatalog, () => {
    const request: NativeAiReadPresetCatalogRequest = { storageRoot };
    return parseJson<readonly AiProviderPreset[]>(
      bindings.readAiPresetCatalogJson(JSON.stringify(request))
    );
  });

  ipcMain.handle(LYRA_CHANNELS.aiUpsertProfile, (_event, request: AiUpsertProfileRequest) => {
    const payload: NativeAiUpsertProfileRequest = { ...request, storageRoot };
    return parseJson<AiProviderProfile>(
      bindings.upsertAiProfileJson(JSON.stringify(payload))
    );
  });

  ipcMain.handle(LYRA_CHANNELS.aiDeleteProfile, (_event, request: AiDeleteProfileRequest) => {
    const payload: NativeAiDeleteProfileRequest = { ...request, storageRoot };
    bindings.deleteAiProfileJson(JSON.stringify(payload));
  });

  ipcMain.handle(LYRA_CHANNELS.aiSetDefaultProfile, (_event, request: AiSetDefaultProfileRequest) => {
    const payload: NativeAiSetDefaultProfileRequest = { ...request, storageRoot };
    return parseJson<AiProviderProfile>(
      bindings.setDefaultAiProfileJson(JSON.stringify(payload))
    );
  });

  ipcMain.handle(LYRA_CHANNELS.aiValidateProfile, (_event, request: AiValidateProfileRequest) => {
    const payload: NativeAiValidateProfileRequest = { ...request, storageRoot };
    return parseJson<AiProfileValidationResult>(
      bindings.validateAiProfileJson(JSON.stringify(payload))
    );
  });

  ipcMain.handle(LYRA_CHANNELS.aiDiscoverModels, (_event, request: AiDiscoverModelsRequest) => {
    const payload: NativeAiDiscoverModelsRequest = { ...request, storageRoot };
    return parseJson<AiModelDiscoveryResult>(
      bindings.discoverAiModelsJson(JSON.stringify(payload))
    );
  });

  ipcMain.handle(LYRA_CHANNELS.aiRefreshDiscoveredModels, (_event, request: AiDiscoverModelsRequest) => {
    const payload: NativeAiDiscoverModelsRequest = { ...request, storageRoot };
    return parseJson<AiModelDiscoveryResult>(
      bindings.refreshAiModelsJson(JSON.stringify(payload))
    );
  });

  ipcMain.handle(LYRA_CHANNELS.aiReadSession, (_event, request: AiReadSessionRequest) => {
    const payload: NativeAiReadSessionRequest = { ...request, storageRoot };
    return parseJson<AiChatSession>(
      bindings.readAiSessionJson(JSON.stringify(payload))
    );
  });

  ipcMain.handle(
    LYRA_CHANNELS.aiReadSessionHistory,
    (_event, request?: AiReadSessionHistoryRequest) => {
      const payload: NativeAiReadSessionHistoryRequest = {
        ...(request ?? {}),
        storageRoot
      };
      return parseJson<readonly AiChatSessionSummary[]>(
        bindings.readAiSessionHistoryJson(JSON.stringify(payload))
      );
    }
  );

  ipcMain.handle(LYRA_CHANNELS.aiSendChatTurn, (_event, request: AiChatTurnRequest) => {
    const payload: NativeAiChatTurnRequest = { ...request, storageRoot };
    return parseJson<AiChatTurnResponse>(
      bindings.sendAiChatTurnJson(JSON.stringify(payload))
    );
  });

  ipcMain.handle(LYRA_CHANNELS.aiCancelChatTurn, (_event, request: AiCancelChatTurnRequest) => {
    const payload: NativeAiCancelChatTurnRequest = { ...request, storageRoot };
    return parseJson<AiChatSession>(
      bindings.cancelAiChatTurnJson(JSON.stringify(payload))
    );
  });

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadProfiles);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadProviderCatalog);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadPresetCatalog);
      ipcMain.removeHandler(LYRA_CHANNELS.aiUpsertProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDeleteProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiSetDefaultProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiValidateProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDiscoverModels);
      ipcMain.removeHandler(LYRA_CHANNELS.aiRefreshDiscoveredModels);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadSession);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadSessionHistory);
      ipcMain.removeHandler(LYRA_CHANNELS.aiSendChatTurn);
      ipcMain.removeHandler(LYRA_CHANNELS.aiCancelChatTurn);
      bindings.shutdownAiRuntime();
    }
  };
};
