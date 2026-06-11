import type { BrowserWindow } from "electron";

import type { LyraRuntimeClient } from "../runtime-client";
import type { TerminalIpcBridge } from "../terminal/types";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import type { WorkbenchObservationService } from "../workbench-observation/types";
import { createAgentIpcRouter } from "./agent-ipc-router";
import { createLumenToolHost } from "./lumen-tool-host";
import { createRuntimeEventForwarder } from "./runtime-event-forwarder";
import { createSoftwareCapabilityHost } from "./software-capability-host";
import { createTerminalToolHost } from "./terminal-tool-host";
import { createWorkbenchObservationAdapter } from "./workbench-observation-adapter";
import type { AgentHostCapabilityHandlers } from "./host-payload";

export type AgentIpcBridge = {
  readonly dispose: () => void;
};

export const createAgentIpcBridge = ({
  runtimeClient,
  storageRoot,
  terminalBridge,
  getWindow,
  getBrowserBridge,
  getWorkbenchObservationService
}: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly storageRoot: string;
  readonly terminalBridge: TerminalIpcBridge;
  readonly getWindow: () => BrowserWindow | null;
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly getWorkbenchObservationService: () => WorkbenchObservationService | null;
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
    getBrowserFollowMode: browserFollowMode.read
  });

  const softwareCapabilityHost = createSoftwareCapabilityHost({ getWindow });

  const hostCapabilityHandlers: AgentHostCapabilityHandlers = {
    ...workbenchObservationAdapter.handlers,
    ...lumenToolHost.handlers,
    ...terminalToolHost.handlers,
    ...softwareCapabilityHost.handlers
  };

  for (const [method, handler] of Object.entries(hostCapabilityHandlers)) {
    runtimeClient.registerRequestHandler(method, handler);
  }

  const ipcRouter = createAgentIpcRouter({
    requestRuntime,
    storageRoot,
    browserFollowMode,
    getBrowserBridge,
    closePrivateTerminalsForSession: terminalToolHost.closePrivateTerminalsForSession
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
