import { ipcMain } from "electron";

import {
  LYRA_CHANNELS,
  type WorkbenchObservationQueryRequest,
  type WorkbenchObservationQueryResult
} from "../../shared/desktop-bridge";
import type {
  WorkbenchTabObservationResult,
  WorkbenchTabReadRequest,
  WorkbenchTabsListRequest,
  WorkbenchTabsListResult,
  WorkbenchWorkspaceReadRequest,
  WorkbenchWorkspaceSnapshot
} from "../../shared/workbench-observation";
import type {
  WorkbenchObservationRendererClient,
  WorkbenchObservationWindowGetter
} from "./types";

type PendingRequest = {
  readonly resolve: (value: any) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

const createRequestId = (): string =>
  `workbench-observation-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const toError = (message: string): Error => new Error(message);

export const createWorkbenchObservationRendererClient = ({
  getWindow,
  timeoutMs = 1_000
}: {
  readonly getWindow: WorkbenchObservationWindowGetter;
  readonly timeoutMs?: number;
}): WorkbenchObservationRendererClient => {
  const pending = new Map<string, PendingRequest>();

  ipcMain.handle(
    LYRA_CHANNELS.workbenchObservationQueryResult,
    (_event, result: WorkbenchObservationQueryResult) => {
      const pendingRequest = pending.get(result.requestId);
      if (pendingRequest === undefined) {
        return null;
      }
      pending.delete(result.requestId);
      clearTimeout(pendingRequest.timer);
      if (result.ok) {
        pendingRequest.resolve(result.result);
      } else {
        pendingRequest.reject(
          toError(result.error?.message ?? "workbench observation query failed")
        );
      }
      return null;
    }
  );

  const sendQuery = async <T>(
    method: WorkbenchObservationQueryRequest["method"],
    payload: object
  ): Promise<T> => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      throw toError("Renderer window is unavailable for workbench observation.");
    }

    const requestId = createRequestId();
    const query: WorkbenchObservationQueryRequest =
      method === "workbench.tabs.list_local"
        ? { requestId, method, payload: payload as WorkbenchTabsListRequest }
        : method === "workbench.workspace.read_local"
          ? { requestId, method, payload: payload as WorkbenchWorkspaceReadRequest }
          : { requestId, method, payload: payload as WorkbenchTabReadRequest };

    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(toError("Renderer workbench observation timed out."));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
    });

    window.webContents.send(LYRA_CHANNELS.workbenchObservationQuery, query);
    return await promise;
  };

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchObservationQueryResult);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(toError("Renderer workbench observation disposed."));
      }
      pending.clear();
    },
    listLocalTabs: async (request?: WorkbenchTabsListRequest) =>
      await sendQuery<WorkbenchTabsListResult>("workbench.tabs.list_local", request ?? {}),
    readLocalTab: async (request: WorkbenchTabReadRequest) =>
      await sendQuery<WorkbenchTabObservationResult>("workbench.tab.read_local", request),
    readLocalWorkspace: async (request?: WorkbenchWorkspaceReadRequest) =>
      await sendQuery<WorkbenchWorkspaceSnapshot>(
        "workbench.workspace.read_local",
        request ?? {}
      )
  };
};
