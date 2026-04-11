import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";

export const clearAgentWebLifecycleForTab = async (
  browserBridge: WorkbenchBrowserIpcBridge,
  tabId: string
): Promise<void> => {
  await browserBridge.clearAgentElementPickerTarget(tabId, {
    preserveManualMode: true
  }).catch(() => undefined);
};
