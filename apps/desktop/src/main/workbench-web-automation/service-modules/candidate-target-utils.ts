import type {
  WorkbenchWebAction,
  WorkbenchWebActionRequest,
  WorkbenchWebElementNode,
  WorkbenchWebTargetScanResult,
  WorkbenchWebWaitRequest,
} from "../../../shared/workbench-web-automation";
import { toBrowserAgentTargetInfo } from "../live-selector/agent-visualization";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";
import type { WorkbenchWebGraphSnapshot } from "../types";
import { buildNodeRef } from "./query-skeleton-helpers";

export const candidateToNode = (candidate: LiveSelectorScanCandidateRecord): WorkbenchWebElementNode => ({
  nodeId: candidate.candidateId,
  frameTreeNodeId: candidate.frameTreeNodeId,
  tagName: candidate.tagName,
  ...(candidate.role === undefined ? {} : { role: candidate.role }),
  ...(candidate.inputType === undefined ? {} : { inputType: candidate.inputType }),
  selectorAddress: candidate.selectorAddress,
  stableSignature: candidate.stableSignature,
  interactable: {
    ...candidate.interactable,
    scrollable: false
  },
  visibilityState: candidate.visibilityState === "nearby" ? "offscreen" : candidate.visibilityState,
  bounds: candidate.bounds,
  ...(candidate.textSnippet === undefined ? {} : { textSnippet: candidate.textSnippet }),
  ...(candidate.disabled === undefined ? {} : { disabled: candidate.disabled }),
  ...(candidate.frameUrl === undefined ? {} : { frameUrl: candidate.frameUrl }),
  ...(candidate.widgetId === undefined ? {} : { widgetId: candidate.widgetId }),
  ...(candidate.ownerWidgetId === undefined ? {} : { ownerWidgetId: candidate.ownerWidgetId }),
  ...(candidate.widgetKind === undefined ? {} : { widgetKind: candidate.widgetKind }),
  ...(candidate.itemIdentity?.label === undefined ? {} : { itemLabel: candidate.itemIdentity.label }),
});

export const toAgentTargetFromCandidate = ({
  tabId,
  toolCallId,
  owner,
  phase,
  candidate,
  pageMode,
  widgets,
}: {
  readonly tabId: string;
  readonly toolCallId: string;
  readonly owner: "agent_scan" | "agent_action" | "agent_wait";
  readonly phase: "scan" | "resolve" | "act" | "wait";
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly pageMode?: WorkbenchWebTargetScanResult["pageMode"];
  readonly widgets?: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
}) => {
  const widgetId = candidate.widgetId ?? candidate.ownerWidgetId;
  const widget = widgetId === undefined
    ? undefined
    : widgets?.find((entry) => entry.widgetId === widgetId);
  return toBrowserAgentTargetInfo({
    tabId,
    toolCallId,
    owner,
    phase,
    candidate,
    ...(widget === undefined
      ? {}
      : {
          widget: {
            widgetId: widget.widgetId,
            kind: widget.kind,
            bounds: widget.bounds,
            ...(widget.label === undefined ? {} : { label: widget.label })
          }
        }),
    ...(pageMode === undefined ? {} : { pageMode })
  });
};

export const syntheticGraphFromCandidate = (
  tabId: string,
  scanSessionId: string,
  candidate: LiveSelectorScanCandidateRecord
): WorkbenchWebGraphSnapshot => ({
  tabId,
  graphId: `scan:${scanSessionId}`,
  builtAt: Date.now(),
  nodeCount: 1,
  edgeCount: 0,
  interactableCount: 1,
  truncated: false,
  budgetExhausted: false,
  nodes: [candidateToNode(candidate)],
  edges: []
});

export const withResolvedCandidateTarget = (
  request: WorkbenchWebActionRequest,
  candidate: LiveSelectorScanCandidateRecord,
  scanSessionId: string
): WorkbenchWebActionRequest => {
  const action = request.action as WorkbenchWebAction & { readonly target?: Record<string, unknown> };
  if (action.target === undefined) {
    return request;
  }
  return {
    ...request,
    action: {
      ...action,
      target: {
        candidateId: candidate.candidateId,
        scanSessionId,
        nodeRef: buildNodeRef({
          candidate,
          revision: (() => {
            const currentNodeRef =
              action.target?.nodeRef !== null
              && typeof action.target?.nodeRef === "object"
              && !Array.isArray(action.target.nodeRef)
                ? action.target.nodeRef as { readonly revision?: unknown }
                : undefined;
            return typeof currentNodeRef?.revision === "string"
              ? currentNodeRef.revision
              : scanSessionId;
          })(),
          scanSessionId
        }),
        selectorAddress: candidate.selectorAddress,
        stableSignature: candidate.stableSignature,
      }
    } as WorkbenchWebAction
  };
};

export const withResolvedWaitTarget = (
  request: WorkbenchWebWaitRequest,
  candidate: LiveSelectorScanCandidateRecord,
  scanSessionId: string
): WorkbenchWebWaitRequest => ({
  ...request,
  target: {
    candidateId: candidate.candidateId,
    scanSessionId,
    nodeRef: buildNodeRef({
      candidate,
      revision: (
        (request.target as { readonly nodeRef?: { readonly revision?: string } }).nodeRef?.revision
        ?? scanSessionId
      ),
      scanSessionId
    }),
    selectorAddress: candidate.selectorAddress,
    stableSignature: candidate.stableSignature,
  }
});
