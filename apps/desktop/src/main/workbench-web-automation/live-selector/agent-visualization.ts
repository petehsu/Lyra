import type { WorkbenchBrowserAgentTargetInfo } from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import type { LiveSelectorScanCandidateRecord } from "./types";

export const toBrowserAgentTargetInfo = ({
  tabId,
  toolCallId,
  owner,
  phase,
  candidate,
  widget,
  pageMode
}: {
  readonly tabId: string;
  readonly toolCallId: string;
  readonly owner: "agent_scan" | "agent_action" | "agent_wait";
  readonly phase: "scan" | "resolve" | "act" | "wait";
  readonly candidate: Pick<
    LiveSelectorScanCandidateRecord,
    | "frameTreeNodeId"
    | "tagName"
    | "role"
    | "inputType"
    | "selectorPreview"
    | "textSnippet"
    | "bounds"
    | "widgetId"
    | "ownerWidgetId"
    | "widgetKind"
    | "discoveryMode"
    | "affordanceLabel"
    | "affordanceAction"
    | "cursorStyle"
    | "tooltipText"
    | "stateHint"
  >;
  readonly widget?: {
    readonly widgetId: string;
    readonly kind: string;
    readonly label?: string;
    readonly bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  };
  readonly pageMode?: string;
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
  ...(candidate.textSnippet === undefined ? {} : { textSnippet: candidate.textSnippet }),
  ...(candidate.widgetId === undefined ? {} : { widgetId: candidate.widgetId }),
  ...(candidate.widgetKind === undefined ? {} : { widgetKind: candidate.widgetKind }),
  ...(candidate.discoveryMode === undefined ? {} : { discoveryMode: candidate.discoveryMode }),
  ...(candidate.affordanceLabel === undefined ? {} : { affordanceLabel: candidate.affordanceLabel }),
  ...(candidate.affordanceAction === undefined ? {} : { affordanceAction: candidate.affordanceAction }),
  ...(candidate.cursorStyle === undefined ? {} : { cursorStyle: candidate.cursorStyle }),
  ...(candidate.tooltipText === undefined ? {} : { tooltipText: candidate.tooltipText }),
  ...(candidate.stateHint === undefined ? {} : { stateHint: candidate.stateHint }),
  ...(widget?.label === undefined ? {} : { widgetLabel: widget.label }),
  ...(widget?.bounds === undefined ? {} : { widgetBounds: widget.bounds }),
  ...(pageMode === undefined ? {} : { pageMode })
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
