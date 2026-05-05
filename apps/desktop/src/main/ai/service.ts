import { ipcMain } from "electron";

import {
  LYRA_CHANNELS,
  type AiDeleteProfileRequest,
  type AiDiscoverModelsRequest,
  type AiModelDiscoveryResult,
  type AiProviderProfile,
  type AiRuntimeConfigSnapshot,
  type AiUpsertProfileRequest
} from "../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../runtime-client";

type AiBridgeOptions = {
  readonly runtimeClient: LyraRuntimeClient;
};

export const createAiIpcBridge = ({
  runtimeClient
}: AiBridgeOptions): { readonly dispose: () => void } => {
  ipcMain.handle(
    LYRA_CHANNELS.aiReadConfig,
    async (): Promise<AiRuntimeConfigSnapshot> =>
      runtimeClient.request<AiRuntimeConfigSnapshot>("model.config.read", {})
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiUpsertProfile,
    async (_event, request: AiUpsertProfileRequest): Promise<AiProviderProfile> =>
      runtimeClient.request<AiProviderProfile>("model.profile.upsert", request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiDeleteProfile,
    async (_event, request: AiDeleteProfileRequest): Promise<void> => {
      await runtimeClient.request<void>("model.profile.delete", request);
    }
  );
  ipcMain.handle(
    LYRA_CHANNELS.aiDiscoverModels,
    async (_event, request: AiDiscoverModelsRequest): Promise<AiModelDiscoveryResult> =>
      runtimeClient.request<AiModelDiscoveryResult>("model.models.discover", request)
  );

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadConfig);
      ipcMain.removeHandler(LYRA_CHANNELS.aiUpsertProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDeleteProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDiscoverModels);
    }
  };
};
