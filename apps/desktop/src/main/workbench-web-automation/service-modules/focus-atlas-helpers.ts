import type {
  WorkbenchWebFocusAtlas,
  WorkbenchWebTargetScanResult,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

export const applyFocusAtlasMetadata = ({
  candidates,
  widgets,
  atlas,
}: {
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  readonly atlas: WorkbenchWebFocusAtlas;
}): {
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
} => {
  const activeRegion = atlas.activeFocusRegionId === undefined
    ? undefined
    : atlas.regions.find((region) => region.regionId === atlas.activeFocusRegionId);
  const primaryControlId = activeRegion?.primaryControlId;
  const nodeByCandidateId = new Map(
    atlas.nodes
      .filter((node) => typeof node.candidateId === "string")
      .map((node) => [node.candidateId!, node] as const)
  );
  const regionByWidgetId = new Map<string, WorkbenchWebFocusAtlas["regions"][number]>();
  for (const region of atlas.regions) {
    for (const widgetId of region.widgetIds) {
      regionByWidgetId.set(widgetId, region);
    }
  }

  const nextCandidates = candidates.map((candidate) => {
    const node = nodeByCandidateId.get(candidate.candidateId);
    if (node === undefined) {
      return candidate;
    }
    const baseConfidence = node.confidence + (node.focusNodeId === primaryControlId ? 0.12 : 0);
    return {
      ...candidate,
      focusOrder: node.focusOrder,
      focusRegionId: node.focusRegionId,
      atlasConfidence: Math.min(1, Number(baseConfidence.toFixed(2))),
      ...(atlas.activeFocusRegionId === node.focusRegionId ? { inActiveFocusRegion: true } : {})
    };
  });

  const nextWidgets = widgets.map((widget) => {
    const region = regionByWidgetId.get(widget.widgetId);
    if (region === undefined) {
      return widget;
    }
    return {
      ...widget,
      focusRegionId: region.regionId,
      atlasConfidence: region.confidence
    };
  });

  return {
    candidates: nextCandidates,
    widgets: nextWidgets
  };
};

export const deriveFocusAtlasLocalDelta = ({
  previousSession,
  atlas,
}: {
  readonly previousSession?: WorkbenchAgentWebSession | null;
  readonly atlas: WorkbenchWebFocusAtlas;
}): WorkbenchAgentWebSession["lastLocalDelta"] => {
  if (previousSession === undefined || previousSession === null) {
    return undefined;
  }

  const activeRegion = atlas.activeFocusRegionId === undefined
    ? undefined
    : atlas.regions.find((region) => region.regionId === atlas.activeFocusRegionId);
  if (
    previousSession.activeFocusRegionId !== undefined
    && atlas.activeFocusRegionId !== undefined
    && previousSession.activeFocusRegionId !== atlas.activeFocusRegionId
  ) {
    return {
      kinds: ["focus_region_changed", "focus_group_changed"] as const,
      observedAt: Date.now(),
      ...(activeRegion === undefined ? {} : { workflowRegion: activeRegion.bounds })
    };
  }
  if (
    previousSession.focusAtlasVersion !== undefined
    && previousSession.focusAtlasVersion !== atlas.version
  ) {
    return {
      kinds: ["focus_group_changed"] as const,
      observedAt: Date.now(),
      ...(activeRegion === undefined ? {} : { workflowRegion: activeRegion.bounds })
    };
  }
  return undefined;
};
