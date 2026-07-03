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
import { isLyraSensitiveValueRef, type LyraSensitiveValueRef } from "../../shared/sensitive-value";
import type {
  LyraSensitiveValueStoreRequest,
  LyraSensitiveValueStoreResponse
} from "../../shared/desktop-bridge";
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
  resolveSensitiveValueForFill,
  storeSensitiveValue,
  addAllowedPreviewRoot
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
  readonly storeSensitiveValue?: (
    request: LyraSensitiveValueStoreRequest
  ) => Promise<LyraSensitiveValueStoreResponse>;
  readonly addAllowedPreviewRoot?: (rootPath: string) => void;
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
    ...createHostPersonaContextHandlers(workbenchState),
    ...(storeSensitiveValue === undefined
      ? {}
      : {
          "sensitiveValues.storeForAgentUse": async (payload: unknown) => {
            if (!isRecord(payload) || typeof payload.value !== "string" || typeof payload.label !== "string") {
              throw new Error("sensitive value and label are required");
            }
            return storeSensitiveValue({
              label: payload.label,
              value: payload.value,
              capabilities: ["list_metadata", "use"],
              ...(payload.owner === "ai-provider" ? { owner: "ai-provider" as const } : {}),
              ...(payload.valueKind === "api_key" ? { valueKind: "api_key" as const } : {}),
              ...(typeof payload.description === "string" ? { description: payload.description } : {})
            });
          }
        }),
    ...(resolveSensitiveValueForFill === undefined
      ? {}
      : {
          "sensitiveValues.resolveForAgentUse": async (payload: unknown) => {
            if (!isRecord(payload) || !isLyraSensitiveValueRef(payload.ref)) {
              throw new Error("sensitive value ref is required");
            }
            return {
              value: await resolveSensitiveValueForFill(payload.ref)
            };
          }
        })
  };

  for (const [method, handler] of Object.entries(hostCapabilityHandlers)) {
    runtimeClient.registerRequestHandler(method, handler);
  }

  const ipcRouter = createAgentIpcRouter({
    requestRuntime,
    storageRoot,
    browserFollowMode,
    getBrowserBridge,
    ...(storeSensitiveValue === undefined ? {} : { storeSensitiveValue }),
    ...(addAllowedPreviewRoot === undefined ? {} : { addAllowedPreviewRoot }),
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
