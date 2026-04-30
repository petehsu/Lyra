import { BrowserWindow } from "electron";

import type {
  BrowserUseRuntimeStatus,
  BrowserUseRuntimeUnavailableReason,
} from "../../../shared/browser-use";
import { createWorkbenchBrowserSharedDebuggerSession } from "../../workbench-browser/debugger";
import type { BrowserUseRuntimeCoordinator, BrowserUseRuntimeManager } from "../types";

type HostToolsBridge = {
  readonly sync: () => Promise<void>;
  readonly remove: () => Promise<void>;
};

const createStatus = (
  input: Partial<BrowserUseRuntimeStatus> & Pick<BrowserUseRuntimeStatus, "state">,
): BrowserUseRuntimeStatus => ({
  checkedAt: Date.now(),
  ...input,
});

export const createBrowserUseRuntimeCoordinator = ({
  runtime,
  hostTools,
  bridgeSmoke,
}: {
  readonly runtime: BrowserUseRuntimeManager;
  readonly hostTools: HostToolsBridge;
  readonly bridgeSmoke?: () => Promise<void>;
}): BrowserUseRuntimeCoordinator => {
  let status: BrowserUseRuntimeStatus = createStatus({ state: "checking" });
  let startPromise: Promise<void> | null = null;
  const listeners = new Set<(status: BrowserUseRuntimeStatus) => void>();

  const publish = (next: BrowserUseRuntimeStatus): void => {
    status = next;
    for (const listener of listeners) {
      listener(status);
    }
  };

  const applyExposure = async (): Promise<void> => {
    if (status.state === "healthy") {
      await hostTools.sync();
    } else {
      await hostTools.remove();
    }
  };

  const runBridgeSmoke = async (): Promise<void> => {
    const smokeWindow = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: {
        sandbox: true,
      },
    });
    try {
      await smokeWindow.loadURL("about:blank");
      const shared = createWorkbenchBrowserSharedDebuggerSession({
        tabId: "browser-use-preflight",
        webContents: smokeWindow.webContents,
        readPageAddress: () => smokeWindow.webContents.getURL(),
      });
      const session = await shared.acquire();
      try {
        await session.sendCommand("Page.enable", {});
        await session.sendCommand("Runtime.enable", {});
        await session.sendCommand("Runtime.evaluate", {
          expression: "document.readyState",
          returnByValue: true,
        });
      } finally {
        await session.close();
        await shared.dispose();
      }
    } finally {
      if (!smokeWindow.isDestroyed()) {
        smokeWindow.destroy();
      }
    }
  };

  const unavailable = (
    reason: BrowserUseRuntimeUnavailableReason,
    detail: string,
  ): BrowserUseRuntimeStatus =>
    createStatus({
      state: "unavailable",
      reason,
      detail,
    });

  const runPreflight = async (): Promise<void> => {
    publish(createStatus({ state: "checking" }));
    const result = await runtime.preflight();
    if (!result.ok) {
      publish(
        unavailable(result.code, result.detail),
      );
      await applyExposure();
      return;
    }

    try {
      await (bridgeSmoke ?? runBridgeSmoke)();
    } catch (error) {
      publish(
        unavailable(
          "bridge_unavailable",
          error instanceof Error ? error.message : String(error),
        ),
      );
      await applyExposure();
      return;
    }

    publish(
      createStatus({
        state: "healthy",
        bundleVersion: result.installState.bundleVersion,
      }),
    );
    await applyExposure();
  };

  return {
    dispose: async () => {
      listeners.clear();
      await hostTools.remove().catch(() => undefined);
    },
    start: () => {
      if (startPromise !== null) {
        return;
      }
      startPromise = Promise.resolve()
        .then(runPreflight)
        .catch((error) => {
          publish(
            unavailable(
              "daemon_launch_failed",
              error instanceof Error ? error.message : String(error),
            ),
          );
          return applyExposure();
        });
    },
    readStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(status);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
