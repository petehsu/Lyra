import type { WorkbenchWebActionResult } from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import type {
  LiveSelectorScanCandidateRecord,
  LiveSelectorScanSession,
} from "../live-selector/types";

export type WorkbenchWorkflowSessionPatchRuntime = {
  readonly resolveActiveItemId: (
    candidate: Pick<LiveSelectorScanCandidateRecord, "widgetId" | "ownerWidgetId" | "widgetKind">
  ) => string | undefined;
  readonly resolveWorkflowRegionForCandidate: (args: {
    readonly candidate: LiveSelectorScanCandidateRecord;
    readonly widgets?: readonly NonNullable<LiveSelectorScanSession["widgets"]>[number][];
    readonly containerNodes?: readonly NonNullable<LiveSelectorScanSession["containerNodes"]>[number][];
  }) => any;
  readonly resolveHoverRevealRegion: (args: {
    readonly seed: LiveSelectorScanCandidateRecord;
    readonly widgets: readonly NonNullable<LiveSelectorScanSession["widgets"]>[number][];
    readonly containerNodes: readonly NonNullable<LiveSelectorScanSession["containerNodes"]>[number][];
  }) => any;
  readonly deriveLocalDeltaFromVerification: (args: {
    readonly result: WorkbenchWebActionResult;
    readonly workflowRegion?: any;
    readonly revealRegion?: any;
  }) => WorkbenchAgentWebSession["lastLocalDelta"] | undefined;
};

export const createWorkbenchWorkflowSessionPatchBuilder = (
  runtime: WorkbenchWorkflowSessionPatchRuntime
): {
  readonly buildPointerUpdate: (
    result: WorkbenchWebActionResult,
    candidate: LiveSelectorScanCandidateRecord
  ) => Record<string, unknown>;
  readonly buildWorkflowSessionPatch: (args: {
    readonly candidate: LiveSelectorScanCandidateRecord;
    readonly scanSession: LiveSelectorScanSession | null;
    readonly subgoal: string;
    readonly result?: WorkbenchWebActionResult;
  }) => Partial<WorkbenchAgentWebSession>;
} => {
  const {
    resolveActiveItemId,
    resolveWorkflowRegionForCandidate,
    resolveHoverRevealRegion,
    deriveLocalDeltaFromVerification,
  } = runtime;

  const buildPointerUpdate = (result: WorkbenchWebActionResult, candidate: LiveSelectorScanCandidateRecord) => {
    const execution = result.execution;
    if (execution === undefined) {
      return {};
    }
    const hoveredWidgetId = candidate.widgetId ?? candidate.ownerWidgetId;
    const hoveredItemId = resolveActiveItemId(candidate);
    return {
      pointer: {
        x: Math.round(candidate.bounds.x + candidate.bounds.width / 2),
        y: Math.round(candidate.bounds.y + candidate.bounds.height / 2),
        frameTreeNodeId: candidate.frameTreeNodeId,
        updatedAt: Date.now()
      },
      hoveredCandidateId: candidate.candidateId,
      ...(hoveredWidgetId === undefined ? {} : { hoveredWidgetId }),
      ...(hoveredItemId === undefined ? {} : { hoveredItemId })
    };
  };

  const buildWorkflowSessionPatch = ({
    candidate,
    scanSession,
    subgoal,
    result,
  }: {
    readonly candidate: LiveSelectorScanCandidateRecord;
    readonly scanSession: LiveSelectorScanSession | null;
    readonly subgoal: string;
    readonly result?: WorkbenchWebActionResult;
  }) => {
    const activeItemId = resolveActiveItemId(candidate);
    const workflowRegion = resolveWorkflowRegionForCandidate({
      candidate,
      ...(scanSession?.widgets === undefined ? {} : { widgets: scanSession.widgets }),
      ...(scanSession?.containerNodes === undefined ? {} : { containerNodes: scanSession.containerNodes })
    });
    const revealRegion = resolveHoverRevealRegion({
      seed: candidate,
      widgets: scanSession?.widgets ?? [],
      containerNodes: scanSession?.containerNodes ?? []
    });
    const verificationDelta = result === undefined
      ? undefined
      : deriveLocalDeltaFromVerification({
          result,
          workflowRegion,
          revealRegion
        });
    return {
      ...(candidate.widgetId === undefined ? {} : { activeWidgetId: candidate.widgetId }),
      ...(activeItemId === undefined ? {} : { activeItemId }),
      currentSubgoal: subgoal,
      ...(workflowRegion === undefined ? {} : { workflowRegion }),
      ...(revealRegion === undefined ? {} : { revealRegion }),
      ...(result === undefined ? {} : buildPointerUpdate(result, candidate)),
      ...(result?.verification?.stateTransition === undefined
        ? {}
        : { lastVerifiedTransition: result.verification.stateTransition }),
      ...(verificationDelta === undefined ? {} : { lastLocalDelta: verificationDelta }),
      ...(verificationDelta?.cursorStyle === undefined ? {} : { currentCursorStyle: verificationDelta.cursorStyle })
    };
  };

  return {
    buildPointerUpdate,
    buildWorkflowSessionPatch,
  };
};
