import type { WebContents } from "electron";

import type {
  WorkbenchBrowserDebuggerEvent,
  WorkbenchBrowserDebuggerSession,
} from "./types";

type WorkbenchBrowserSharedDebuggerSession = {
  readonly acquire: () => Promise<WorkbenchBrowserDebuggerSession>;
  readonly dispose: () => Promise<void>;
  readonly hasActiveClients: () => boolean;
};

const DEBUGGER_PROTOCOL_VERSION = "1.3";

export const createWorkbenchBrowserSharedDebuggerSession = ({
  tabId,
  webContents,
  readPageAddress,
}: {
  readonly tabId: string;
  readonly webContents: WebContents;
  readonly readPageAddress: () => string | undefined;
}): WorkbenchBrowserSharedDebuggerSession => {
  let refCount = 0;
  let listenersInstalled = false;
  const subscribers = new Set<(event: WorkbenchBrowserDebuggerEvent) => void>();

  const emit = (event: WorkbenchBrowserDebuggerEvent): void => {
    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch {
        // ignore individual subscriber failures
      }
    }
  };

  const handleMessage = (
    _event: Electron.Event,
    method: string,
    params: unknown,
    sessionId: string,
  ) => {
    emit({
      kind: "message",
      method,
      params,
      ...(typeof sessionId === "string" && sessionId.length > 0 ? { sessionId } : {}),
    });
  };

  const handleDetach = (_event: Electron.Event, reason: string) => {
    emit({
      kind: "detached",
      reason,
    });
  };

  const installListeners = () => {
    if (listenersInstalled) {
      return;
    }
    webContents.debugger.on("message", handleMessage);
    webContents.debugger.on("detach", handleDetach);
    listenersInstalled = true;
  };

  const uninstallListeners = () => {
    if (!listenersInstalled) {
      return;
    }
    webContents.debugger.off("message", handleMessage);
    webContents.debugger.off("detach", handleDetach);
    listenersInstalled = false;
  };

  const ensureAttached = async (): Promise<void> => {
    if (webContents.isDestroyed()) {
      throw new Error(`browser debugger session lost because tab ${tabId} was destroyed`);
    }
    installListeners();
    if (webContents.debugger.isAttached()) {
      return;
    }
    webContents.debugger.attach(DEBUGGER_PROTOCOL_VERSION);
  };

  const release = async (): Promise<void> => {
    if (refCount > 0) {
      refCount -= 1;
    }
    if (refCount > 0) {
      return;
    }
    subscribers.clear();
    uninstallListeners();
    if (webContents.isDestroyed() || !webContents.debugger.isAttached()) {
      return;
    }
    try {
      webContents.debugger.detach();
    } catch {
      // ignore detach failures during cleanup
    }
  };

  return {
    acquire: async () => {
      await ensureAttached();
      refCount += 1;
      let closed = false;
      const pageAddress = readPageAddress();
      return {
        tabId,
        ...(pageAddress === undefined ? {} : { pageAddress }),
        sendCommand: async (method, commandParams, sessionId) => {
          await ensureAttached();
          const response = await webContents.debugger.sendCommand(method, commandParams, sessionId);
          if (response !== null && typeof response === "object" && !Array.isArray(response)) {
            return response as Record<string, unknown>;
          }
          return {};
        },
        subscribe: (listener) => {
          subscribers.add(listener);
          return () => {
            subscribers.delete(listener);
          };
        },
        focus: () => {
          if (webContents.isDestroyed()) {
            return;
          }
          webContents.focus();
        },
        close: async () => {
          if (closed) {
            return;
          }
          closed = true;
          await release();
        },
      };
    },
    dispose: async () => {
      refCount = 0;
      subscribers.clear();
      uninstallListeners();
      if (webContents.isDestroyed() || !webContents.debugger.isAttached()) {
        return;
      }
      try {
        webContents.debugger.detach();
      } catch {
        // ignore cleanup failures
      }
    },
    hasActiveClients: () => refCount > 0
  };
};
