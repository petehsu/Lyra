import type { WorkbenchObservationBrowserDomSummary } from "../types";
import type { BrowserDomSummaryReadOptions } from "./types";
import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";

export const readBrowserDomSummary = async (
  bridge: WorkbenchBrowserIpcBridge,
  tabId: string,
  options?: BrowserDomSummaryReadOptions
): Promise<WorkbenchObservationBrowserDomSummary> =>
  await bridge.readPageDomSummary(tabId, options);
