import { ipcMain } from "electron";

import {
  LYRA_CHANNELS,
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
  type SearchRebuildIndexResponse
} from "../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../runtime-client";
import { resolveWebSearchEngine } from "./web-engine-resolver";

export type SearchIpcBridge = {
  readonly dispose: () => void;
};

export const createSearchIpcBridge = (options: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly storageRoot: string;
}): SearchIpcBridge => {
  const requestRuntime = async <T>(method: string, payload: unknown): Promise<T> =>
    await options.runtimeClient.request<T>(method, payload);

  ipcMain.handle(
    LYRA_CHANNELS.resolveWebSearchEngine,
    async (
      _event,
      request: SearchResolveWebEngineRequest
    ): Promise<SearchResolveWebEngineResponse> =>
      await resolveWebSearchEngine(request)
  );

  ipcMain.handle(
    LYRA_CHANNELS.localSearch,
    async (_event, request: SearchLocalRequest): Promise<SearchLocalResponse> =>
      await requestRuntime<SearchLocalResponse>("search.local", {
        storageRoot: options.storageRoot,
        ...request
      })
  );

  ipcMain.handle(
    LYRA_CHANNELS.localSearchStreamStart,
    async (
      _event,
      request: SearchLocalStreamStartRequest
    ): Promise<SearchLocalStreamStartResponse> =>
      await requestRuntime<SearchLocalStreamStartResponse>("search.local.stream.start", {
        storageRoot: options.storageRoot,
        ...request
      })
  );

  ipcMain.handle(
    LYRA_CHANNELS.localSearchStreamRead,
    async (
      _event,
      request: SearchLocalStreamReadRequest
    ): Promise<SearchLocalStreamReadResponse> =>
      await requestRuntime<SearchLocalStreamReadResponse>("search.local.stream.read", {
        storageRoot: options.storageRoot,
        ...request
      })
  );

  ipcMain.handle(
    LYRA_CHANNELS.localSearchStreamCancel,
    async (
      _event,
      request: SearchLocalStreamCancelRequest
    ): Promise<SearchLocalStreamCancelResponse> =>
      await requestRuntime<SearchLocalStreamCancelResponse>("search.local.stream.cancel", {
        storageRoot: options.storageRoot,
        ...request
      })
  );

  ipcMain.handle(
    LYRA_CHANNELS.searchIndexStatus,
    async (
      _event,
      request?: SearchIndexStatusRequest
    ): Promise<SearchIndexStatusResponse> =>
      await requestRuntime<SearchIndexStatusResponse>("search.index.status", {
        storageRoot: options.storageRoot,
        ...(request ?? {})
      })
  );

  ipcMain.handle(
    LYRA_CHANNELS.searchIndexRebuild,
    async (
      _event,
      request?: SearchRebuildIndexRequest
    ): Promise<SearchRebuildIndexResponse> =>
      await requestRuntime<SearchRebuildIndexResponse>("search.index.rebuild", {
        storageRoot: options.storageRoot,
        ...(request ?? {})
      })
  );

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.resolveWebSearchEngine);
      ipcMain.removeHandler(LYRA_CHANNELS.localSearch);
      ipcMain.removeHandler(LYRA_CHANNELS.localSearchStreamStart);
      ipcMain.removeHandler(LYRA_CHANNELS.localSearchStreamRead);
      ipcMain.removeHandler(LYRA_CHANNELS.localSearchStreamCancel);
      ipcMain.removeHandler(LYRA_CHANNELS.searchIndexStatus);
      ipcMain.removeHandler(LYRA_CHANNELS.searchIndexRebuild);
    }
  };
};
