import { ipcMain } from "electron";

import {
  LYRA_CHANNELS,
  type SearchResolveWebEngineRequest,
  type SearchResolveWebEngineResponse
} from "../../shared/desktop-bridge";
import { resolveWebSearchEngine } from "./web-engine-resolver";

export type SearchIpcBridge = {
  readonly dispose: () => void;
};

export const createSearchIpcBridge = (): SearchIpcBridge => {
  ipcMain.handle(
    LYRA_CHANNELS.resolveWebSearchEngine,
    async (
      _event,
      request: SearchResolveWebEngineRequest
    ): Promise<SearchResolveWebEngineResponse> =>
      await resolveWebSearchEngine(request)
  );

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.resolveWebSearchEngine);
    }
  };
};