import { randomUUID } from "node:crypto";

import type {
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanScope,
  WorkbenchWebElementBounds,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchWebAutomationServiceDeps } from "../types";
import { buildLayoutIntelligenceExtractScript } from "./extract-script";
import { buildLayoutIntelligenceSnapshot } from "./widget-graph";
import type {
  LayoutFrameInteractiveNode,
  LayoutFrameScanResult,
  LayoutIntelligenceSnapshot,
  LayoutInteractiveRecord,
} from "./types";

const toInteractiveRecord = (
  frameUrl: string,
  frameTreeNodeId: number,
  candidate: LayoutFrameInteractiveNode
): LayoutInteractiveRecord => ({
  candidateId: randomUUID(),
  frameTreeNodeId,
  ...candidate,
  ...(frameUrl.length === 0 ? {} : { frameUrl }),
});

export const scanLayoutIntelligenceAcrossFrames = async ({
  deps,
  tabId,
  scope,
  intent,
  maxNodes,
  focusRegion,
}: {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly scope: WorkbenchWebTargetScanScope;
  readonly intent?: WorkbenchWebTargetIntent;
  readonly maxNodes: number;
  readonly focusRegion?: WorkbenchWebElementBounds;
}): Promise<{
  readonly snapshot: LayoutIntelligenceSnapshot;
  readonly scannedFrames: number;
  readonly scannedCandidates: number;
}> => {
  const frames = deps.browserBridge.listFrames(tabId);
  const collected: LayoutInteractiveRecord[] = [];
  let scannedCandidates = 0;

  for (const frame of frames.slice(0, 24)) {
    const raw = await deps.browserBridge.executeFrameScript(tabId, {
      frameTreeNodeId: frame.frameTreeNodeId,
      script: buildLayoutIntelligenceExtractScript({
        frameTreeNodeId: frame.frameTreeNodeId,
        scope,
        ...(intent === undefined ? {} : { intent }),
        maxNodes,
        ...(focusRegion === undefined ? {} : { focusRegion }),
      }),
      userGesture: false
    }).catch(() => null) as LayoutFrameScanResult | null;
    if (raw === null || !Array.isArray(raw.interactiveNodes)) {
      continue;
    }
    scannedCandidates += raw.interactiveNodes.length;
    for (const candidate of raw.interactiveNodes) {
      collected.push(toInteractiveRecord(frame.url, frame.frameTreeNodeId, candidate));
    }
  }

  return {
    snapshot: buildLayoutIntelligenceSnapshot({
      candidates: collected,
      scope,
      ...(intent === undefined ? {} : { intent })
    }),
    scannedFrames: frames.length,
    scannedCandidates
  };
};
