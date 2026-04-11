import type { WorkbenchBrowserAgentTargetInfo } from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import type { LiveSelectorScanCandidateRecord } from "./types";

export const toBrowserAgentTargetInfo = ({
  tabId,
  toolCallId,
  owner,
  phase,
  candidate
}: {
  readonly tabId: string;
  readonly toolCallId: string;
  readonly owner: "agent_scan" | "agent_action" | "agent_wait";
  readonly phase: "scan" | "resolve" | "act" | "wait";
  readonly candidate: Pick<
    LiveSelectorScanCandidateRecord,
    "frameTreeNodeId" | "tagName" | "role" | "inputType" | "selectorPreview" | "textSnippet" | "bounds"
  >;
}): WorkbenchBrowserAgentTargetInfo => ({
  tabId,
  toolCallId,
  owner,
  phase,
  frameTreeNodeId: candidate.frameTreeNodeId,
  tagName: candidate.tagName,
  selectorPreview: candidate.selectorPreview,
  bounds: candidate.bounds,
  ...(candidate.role === undefined ? {} : { role: candidate.role }),
  ...(candidate.inputType === undefined ? {} : { inputType: candidate.inputType }),
  ...(candidate.textSnippet === undefined ? {} : { textSnippet: candidate.textSnippet })
});

export const showAgentSelectorTarget = async (
  browserBridge: WorkbenchBrowserIpcBridge,
  target: WorkbenchBrowserAgentTargetInfo
): Promise<boolean> => await browserBridge.showAgentElementPickerTarget(target);

export const clearAgentSelectorTarget = async (
  browserBridge: WorkbenchBrowserIpcBridge,
  tabId: string,
  options?: { readonly preserveManualMode?: boolean }
): Promise<void> => {
  await browserBridge.clearAgentElementPickerTarget(tabId, options);
};
