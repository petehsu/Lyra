import { desktopCapturer, screen, type BrowserWindow } from "electron";

import type { LyraRuntimeClient } from "../runtime-client";
import type { TerminalIpcBridge } from "../terminal/types";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import type { WorkbenchObservationService } from "../workbench-observation/types";
import { createAgentIpcRouter } from "./agent-ipc-router";
import { createAxToolHost } from "./ax-tool-host";
import { createComputerToolHost } from "./computer-tool-host";
import { createFavoritesToolHost } from "./favorites-tool-host";
import { createLumenToolHost } from "./lumen-tool-host";
import { createRuntimeEventForwarder } from "./runtime-event-forwarder";
import { createSoftwareCapabilityHost } from "./software-capability-host";
import { createTerminalToolHost } from "./terminal-tool-host";
import { createHostPersonaContextHandlers } from "./host-persona-context";
import { createWorkbenchObservationAdapter } from "./workbench-observation-adapter";
import type { WorkbenchStateIpcBridge } from "../workbench-state/service";
import type { LyraSensitiveValueRef } from "../../shared/sensitive-value";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import { isRecord } from "./host-payload";

export type AgentIpcBridge = {
  readonly dispose: () => void;
};

export const createAgentIpcBridge = ({
  runtimeClient,
  storageRoot,
  terminalBridge,
  getWindow,
  getBrowserBridge,
  getWorkbenchObservationService,
  workbenchState,
  resolveSensitiveValueForFill
}: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly storageRoot: string;
  readonly terminalBridge: TerminalIpcBridge;
  readonly getWindow: () => BrowserWindow | null;
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly getWorkbenchObservationService: () => WorkbenchObservationService | null;
  readonly workbenchState: WorkbenchStateIpcBridge;
  readonly resolveSensitiveValueForFill?: (
    ref: LyraSensitiveValueRef
  ) => Promise<string>;
}): AgentIpcBridge => {
  const requestRuntime = async <T>(method: string, payload: object = {}): Promise<T> =>
    runtimeClient.request<T>(method, payload);

  let browserFollowModeEnabled = false;
  const browserFollowMode = {
    read: () => browserFollowModeEnabled,
    set: (enabled: boolean) => {
      browserFollowModeEnabled = enabled;
    }
  };

  const runtimeEventForwarder = createRuntimeEventForwarder({
    runtimeClient,
    requestRuntime,
    getWindow,
    getBrowserBridge
  });

  const workbenchObservationAdapter = createWorkbenchObservationAdapter({
    getWorkbenchObservationService,
    getBrowserBridge,
    getWindow
  });

  const terminalToolHost = createTerminalToolHost({
    terminalBridge,
    getWorkbenchObservationService,
    getBrowserFollowMode: browserFollowMode.read
  });

  const lumenToolHost = createLumenToolHost({
    getBrowserBridge,
    tabResolver: workbenchObservationAdapter,
    storageRoot,
    getBrowserFollowMode: browserFollowMode.read,
    ...(resolveSensitiveValueForFill === undefined
      ? {}
      : { resolveSensitiveValueForFill })
  });

  const axToolHost = createAxToolHost({
    getBrowserBridge,
    tabResolver: workbenchObservationAdapter,
    getBrowserFollowMode: browserFollowMode.read
  });

  const softwareCapabilityHost = createSoftwareCapabilityHost({ getWindow });
  const favoritesToolHost = createFavoritesToolHost({ storageRoot });

  const computerToolHost = createComputerToolHost({
    ...(resolveSensitiveValueForFill === undefined
      ? {}
      : { resolveSensitiveValueForFill }),
    internalSurfaces: {
      tabResolver: workbenchObservationAdapter,
      axHandlers: axToolHost.handlers,
      terminalHandlers: terminalToolHost.handlers,
      listWorkbenchTabs: async () => {
        const service = getWorkbenchObservationService();
        if (service === null) {
          throw new Error("Workbench observation capability is not available");
        }
        return service.listTabs({ scope: "all", includeUnsupported: true });
      },
      activateWorkbenchTab: async (tabId) => {
        const service = getWorkbenchObservationService();
        if (service === null) {
          throw new Error("Workbench observation capability is not available");
        }
        const result = await service.activateTab({ tabId });
        return {
          ok: true,
          platform: process.platform,
          mode: "shared",
          focused: true,
          lyraTabId: tabId,
          ...(isRecord(result) ? result : {}),
          message: `Lyra workbench tab ${tabId} was activated.`
        };
      }
    },
    visualFallback: {
      storageRoot,
      // Level-3 desktop capture via Electron desktopCapturer. Lives in the
      // platform-bridge layer so the host stays a pure marshaller.
      captureScreen: async (scope) => {
        const display = screen.getPrimaryDisplay();
        const { width, height } = display.size;
        const scale = display.scaleFactor || 1;
        const sources = await desktopCapturer.getSources({
          types: scope === "screen" ? ["screen"] : ["window", "screen"],
          thumbnailSize: {
            width: Math.round(width * scale),
            height: Math.round(height * scale)
          }
        });
        const source = sources[0];
        if (source === undefined || source.thumbnail.isEmpty()) {
          return null;
        }
        const image = source.thumbnail;
        const size = image.getSize();
        return {
          imageBase64: image.toPNG().toString("base64"),
          mimeType: "image/png",
          width: size.width,
          height: size.height
        };
      }
    }
  });

  const hostCapabilityHandlers: AgentHostCapabilityHandlers = {
    ...workbenchObservationAdapter.handlers,
    ...lumenToolHost.handlers,
    ...axToolHost.handlers,
    ...computerToolHost.handlers,
    ...terminalToolHost.handlers,
    ...softwareCapabilityHost.handlers,
    ...favoritesToolHost.handlers,
    ...createHostPersonaContextHandlers(workbenchState)
  };

  for (const [method, handler] of Object.entries(hostCapabilityHandlers)) {
    runtimeClient.registerRequestHandler(method, handler);
  }

  const ipcRouter = createAgentIpcRouter({
    requestRuntime,
    storageRoot,
    browserFollowMode,
    getBrowserBridge,
    closePrivateTerminalsForSession: terminalToolHost.closePrivateTerminalsForSession,
    listPrivateTerminalsForSession: terminalToolHost.listPrivateTerminalsForSession,
    closePrivateTerminalSession: terminalToolHost.closePrivateTerminalSession
  });

  return {
    dispose: () => {
      runtimeEventForwarder.dispose();
      softwareCapabilityHost.dispose();
      terminalToolHost.dispose();
      ipcRouter.dispose();
      for (const method of Object.keys(hostCapabilityHandlers)) {
        runtimeClient.unregisterRequestHandler(method);
      }
    }
  };
};
