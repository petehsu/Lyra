import { ipcMain } from "electron";

import {
  LYRA_CHANNELS,
  type SearchAggregateRequest,
  type SearchAggregateResponse,
  type SearchDeepExpandRequest,
  type SearchDeepExpandResponse,
  type SearchDeepStreamCancelRequest,
  type SearchDeepStreamCancelResponse,
  type SearchDeepStreamReadRequest,
  type SearchDeepStreamReadResponse,
  type SearchDeepStreamStartRequest,
  type SearchDeepStreamStartResponse,
  type SearchLocalRequest,
  type SearchLocalResponse,
  type SearchLocalStreamCancelRequest,
  type SearchLocalStreamCancelResponse,
  type SearchLocalStreamReadRequest,
  type SearchLocalStreamReadResponse,
  type SearchLocalStreamStartRequest,
  type SearchLocalStreamStartResponse
} from "../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../runtime-client";
import { createDeepSearchOrchestrator } from "./deep-orchestrator";
import { aggregateSearch } from "./service";

export type SearchIpcBridge = {
  readonly dispose: () => void;
};

export const createSearchIpcBridge = (options: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly storageRoot: string;
}): SearchIpcBridge => {
  const deepSearch = createDeepSearchOrchestrator(options);
  const requestRuntime = async <T>(method: string, payload: unknown): Promise<T> =>
    await options.runtimeClient.request<T>(method, payload);

  ipcMain.handle(
    LYRA_CHANNELS.aggregateSearch,
    async (_event, request: SearchAggregateRequest): Promise<SearchAggregateResponse> =>
      await aggregateSearch(request)
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
    LYRA_CHANNELS.searchDeepStreamStart,
    async (
      _event,
      request: SearchDeepStreamStartRequest
    ): Promise<SearchDeepStreamStartResponse> =>
      await deepSearch.start(request)
  );

  ipcMain.handle(
    LYRA_CHANNELS.searchDeepStreamRead,
    async (
      _event,
      request: SearchDeepStreamReadRequest
    ): Promise<SearchDeepStreamReadResponse> =>
      await deepSearch.read(request)
  );

  ipcMain.handle(
    LYRA_CHANNELS.searchDeepStreamCancel,
    async (
      _event,
      request: SearchDeepStreamCancelRequest
    ): Promise<SearchDeepStreamCancelResponse> =>
      await deepSearch.cancel(request)
  );

  ipcMain.handle(
    LYRA_CHANNELS.searchDeepExpand,
    async (
      _event,
      request: SearchDeepExpandRequest
    ): Promise<SearchDeepExpandResponse> =>
      await deepSearch.expand(request)
  );

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.aggregateSearch);
      ipcMain.removeHandler(LYRA_CHANNELS.localSearch);
      ipcMain.removeHandler(LYRA_CHANNELS.localSearchStreamStart);
      ipcMain.removeHandler(LYRA_CHANNELS.localSearchStreamRead);
      ipcMain.removeHandler(LYRA_CHANNELS.localSearchStreamCancel);
      ipcMain.removeHandler(LYRA_CHANNELS.searchDeepStreamStart);
      ipcMain.removeHandler(LYRA_CHANNELS.searchDeepStreamRead);
      ipcMain.removeHandler(LYRA_CHANNELS.searchDeepStreamCancel);
      ipcMain.removeHandler(LYRA_CHANNELS.searchDeepExpand);
      void deepSearch.dispose();
    }
  };
};
