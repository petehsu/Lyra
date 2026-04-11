import { ipcMain, type BrowserWindow } from "electron";

import type {
  CapabilityCallRequest,
  CapabilityEvent,
  CapabilityRegistrySnapshot,
  CapabilityResolveApprovalRequest
} from "@lyra/capability-protocol";
import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type {
  CapabilityApprovalResolveRequest,
  CapabilityInvokeRequest,
  CapabilityListRequest,
  CapabilityReadRegistryResponse,
  CapabilityRuntimeEvent
} from "../../shared/capabilities";
import type { FilesNativeBindings } from "../files/types";
import type { McpIpcBridge } from "../mcp/types";
import type { TerminalIpcBridge } from "../terminal/types";
import type { WorkbenchObservationService } from "../workbench-observation/types";
import type { WorkbenchDocumentsService } from "../workbench-documents/types";
import type { WorkbenchWebAutomationService } from "../workbench-web-automation/types";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { registerBrowserCapabilities } from "./adapters/browser";
import { registerDocumentCapabilities } from "./adapters/documents";
import { registerFilesystemCapabilities } from "./adapters/files";
import { registerMcpCapabilities } from "./adapters/mcp";
import { registerTerminalCapabilities } from "./adapters/terminal";
import { registerWorkbenchCapabilities } from "./adapters/workbench";
import { AppRegistry, CapabilityRegistry } from "./registry";
import type { CapabilitiesIpcBridge } from "./types";

const publishToWindow = (
  getWindow: () => BrowserWindow | null,
  event: CapabilityRuntimeEvent
): void => {
  const window = getWindow();
  if (window === null || window.isDestroyed()) {
    return;
  }
  window.webContents.send(LYRA_CHANNELS.capabilityEvent, event);
};

export const createCapabilitiesIpcBridge = ({
  filesNativeBindings,
  filesStorageRoot,
  terminalBridge,
  mcpBridge,
  workbenchBrowserBridge,
  workbenchObservationService,
  workbenchDocumentsService,
  workbenchWebAutomationService,
  getWindow
}: {
  readonly filesNativeBindings: FilesNativeBindings;
  readonly filesStorageRoot: string;
  readonly terminalBridge: TerminalIpcBridge;
  readonly mcpBridge: McpIpcBridge;
  readonly workbenchBrowserBridge: WorkbenchBrowserIpcBridge;
  readonly workbenchObservationService: WorkbenchObservationService;
  readonly workbenchDocumentsService: WorkbenchDocumentsService;
  readonly workbenchWebAutomationService: WorkbenchWebAutomationService;
  readonly getWindow: () => BrowserWindow | null;
}): CapabilitiesIpcBridge => {
  const appRegistry = new AppRegistry();
  const capabilityEventListeners = new Set<(event: CapabilityEvent) => void>();
  const capabilityRegistry = new CapabilityRegistry((event: CapabilityEvent) => {
    for (const listener of capabilityEventListeners) {
      listener(event);
    }
    publishToWindow(getWindow, event);
  });

  appRegistry.register(
    registerFilesystemCapabilities(capabilityRegistry, filesNativeBindings, filesStorageRoot)
  );
  appRegistry.register(registerTerminalCapabilities(capabilityRegistry, terminalBridge));
  appRegistry.register(registerBrowserCapabilities(capabilityRegistry, workbenchBrowserBridge));
  appRegistry.register(registerMcpCapabilities(capabilityRegistry, mcpBridge));
  appRegistry.register(
    registerWorkbenchCapabilities(
      capabilityRegistry,
      workbenchObservationService,
      workbenchWebAutomationService
    )
  );
  appRegistry.register(registerDocumentCapabilities(capabilityRegistry, workbenchDocumentsService));

  const readRegistry = (): CapabilityRegistrySnapshot => capabilityRegistry.snapshot(appRegistry.list());

  ipcMain.handle(
    LYRA_CHANNELS.capabilityReadRegistry,
    (): CapabilityReadRegistryResponse => readRegistry()
  );
  ipcMain.handle(
    LYRA_CHANNELS.capabilityList,
    (_event, request?: CapabilityListRequest) => capabilityRegistry.list(request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.capabilityInvoke,
    async (_event, request: CapabilityInvokeRequest) =>
      await capabilityRegistry.invoke(request as CapabilityCallRequest)
  );
  ipcMain.handle(
    LYRA_CHANNELS.capabilityResolveApproval,
    async (_event, request: CapabilityApprovalResolveRequest) =>
      await capabilityRegistry.resolveApproval(request as CapabilityResolveApprovalRequest)
  );

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.capabilityReadRegistry);
      ipcMain.removeHandler(LYRA_CHANNELS.capabilityList);
      ipcMain.removeHandler(LYRA_CHANNELS.capabilityInvoke);
      ipcMain.removeHandler(LYRA_CHANNELS.capabilityResolveApproval);
      capabilityEventListeners.clear();
    },
    readRegistry,
    listCapabilities: (request?: CapabilityListRequest) => capabilityRegistry.list(request),
    invokeCapability: async (request: CapabilityCallRequest) => await capabilityRegistry.invoke(request),
    resolveApproval: async (request: CapabilityResolveApprovalRequest) =>
      await capabilityRegistry.resolveApproval(request),
    abortApprovalsForSession: async (sessionId: string, reason?: string) =>
      await capabilityRegistry.abortApprovalsForSession(sessionId, reason),
    subscribeEvents: (listener: (event: CapabilityEvent) => void) => {
      capabilityEventListeners.add(listener);
      return () => {
        capabilityEventListeners.delete(listener);
      };
    }
  };
};
