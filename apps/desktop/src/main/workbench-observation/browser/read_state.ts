import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import type { WorkbenchBrowserPageRuntimeState } from "../../../shared/desktop-bridge";

export const readBrowserRuntimeState = (
  bridge: WorkbenchBrowserIpcBridge,
  tabId: string
): WorkbenchBrowserPageRuntimeState | null => bridge.readPageState({ tabId });
