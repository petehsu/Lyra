import { ipcMain, type BrowserWindow } from "electron";

import {
  LYRA_CHANNELS,
  type WorkbenchBrowserEvent,
  type WorkbenchBrowserLayoutSnapshot,
  type WorkbenchBrowserNavigateRequest,
  type WorkbenchBrowserNavigateResult,
  type WorkbenchBrowserPageRuntimeState,
  type WorkbenchBrowserReadPageStateRequest,
  type WorkbenchBrowserTopologySnapshot
} from "../../shared/desktop-bridge";
import { createWorkbenchBrowserViewManager } from "./view-manager";
import type { WorkbenchBrowserViewManager } from "./types";

const publishEvent = (
  getWindow: () => BrowserWindow | null,
  event: WorkbenchBrowserEvent
): void => {
  const window = getWindow();
  if (window === null || window.isDestroyed()) {
    return;
  }
  window.webContents.send(LYRA_CHANNELS.workbenchBrowserEvent, event);
};

export type WorkbenchBrowserIpcBridge = {
  readonly dispose: () => void;
  readonly syncTopology: (snapshot: WorkbenchBrowserTopologySnapshot) => void;
  readonly syncLayout: (snapshot: WorkbenchBrowserLayoutSnapshot) => void;
  readonly navigate: (
    request: WorkbenchBrowserNavigateRequest
  ) => Promise<WorkbenchBrowserNavigateResult>;
  readonly goBack: (tabId: string) => void;
  readonly goForward: (tabId: string) => void;
  readonly reload: (tabId: string, ignoreCache?: boolean) => void;
  readonly stop: (tabId: string) => void;
  readonly readPageState: (
    request?: WorkbenchBrowserReadPageStateRequest
  ) => WorkbenchBrowserPageRuntimeState | null;
  readonly reapplyLayout: () => void;
  readonly toggleDevToolsForActivePage: () => boolean;
};

export const createWorkbenchBrowserIpcBridge = ({
  getWindow
}: {
  readonly getWindow: () => BrowserWindow | null;
}): WorkbenchBrowserIpcBridge => {
  const manager: WorkbenchBrowserViewManager = createWorkbenchBrowserViewManager({
    getWindow,
    publishEvent: (event) => publishEvent(getWindow, event)
  });

  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserSyncTopology, (_event, snapshot: unknown) => {
    manager.syncTopology(snapshot as WorkbenchBrowserTopologySnapshot);
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserSyncLayout, (_event, snapshot: unknown) => {
    manager.syncLayout(snapshot as WorkbenchBrowserLayoutSnapshot);
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserNavigate, async (_event, request: unknown) => {
    return await manager.navigate(request as WorkbenchBrowserNavigateRequest);
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserGoBack, (_event, request: { readonly tabId?: unknown }) => {
    if (typeof request?.tabId === "string") {
      manager.goBack(request.tabId);
    }
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserGoForward, (_event, request: { readonly tabId?: unknown }) => {
    if (typeof request?.tabId === "string") {
      manager.goForward(request.tabId);
    }
  });
  ipcMain.handle(
    LYRA_CHANNELS.workbenchBrowserReload,
    (_event, request: { readonly tabId?: unknown; readonly ignoreCache?: unknown }) => {
      if (typeof request?.tabId === "string") {
        manager.reload(request.tabId, request.ignoreCache === true);
      }
    }
  );
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserStop, (_event, request: { readonly tabId?: unknown }) => {
    if (typeof request?.tabId === "string") {
      manager.stop(request.tabId);
    }
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserReadPageState, (_event, request?: unknown) => {
    return manager.readPageState(request as WorkbenchBrowserReadPageStateRequest | undefined);
  });

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserSyncTopology);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserSyncLayout);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserNavigate);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserGoBack);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserGoForward);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserReload);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserStop);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserReadPageState);
      manager.dispose();
    },
    syncTopology: manager.syncTopology,
    syncLayout: manager.syncLayout,
    navigate: manager.navigate,
    goBack: manager.goBack,
    goForward: manager.goForward,
    reload: manager.reload,
    stop: manager.stop,
    readPageState: manager.readPageState,
    reapplyLayout: manager.reapplyLayout,
    toggleDevToolsForActivePage: manager.toggleDevToolsForActivePage
  };
};
