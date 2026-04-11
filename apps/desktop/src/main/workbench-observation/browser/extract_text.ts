import type {
  WorkbenchTabExtractTextResult
} from "../../../shared/workbench-observation";
import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import type { BrowserTextExtractOptions } from "./types";

export const extractBrowserText = async (
  bridge: WorkbenchBrowserIpcBridge,
  tabId: string,
  options?: BrowserTextExtractOptions
): Promise<WorkbenchTabExtractTextResult> =>
  await bridge.extractPageText(tabId, options);
