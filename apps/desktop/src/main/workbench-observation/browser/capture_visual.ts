import type { WorkbenchVisualCaptureResult } from "../../../shared/workbench-observation";
import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";

export const captureBrowserVisual = async (
  bridge: WorkbenchBrowserIpcBridge,
  tabId: string
): Promise<WorkbenchVisualCaptureResult> => await bridge.capturePage(tabId);
