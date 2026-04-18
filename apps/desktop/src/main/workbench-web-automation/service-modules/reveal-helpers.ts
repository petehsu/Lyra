import type {
  WorkbenchWebTargetCandidate,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanResult,
} from "../../../shared/workbench-web-automation";
import { rankLiveSelectorCandidates } from "../live-selector/candidate-ranker";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

const hoverRevealEligibleKinds = new Set([
  "navigation",
  "list",
  "list-item",
  "menu",
  "menu-trigger",
  "panel"
]);

export const shouldAttemptHoverReveal = (
  candidate: LiveSelectorScanCandidateRecord,
  pageMode: WorkbenchWebTargetScanResult["pageMode"]
): boolean => {
  if (candidate.visibilityState !== "visible" || candidate.interactable.clickable !== true) {
    return false;
  }
  if (candidate.bounds.width < 96 || candidate.bounds.height > 64) {
    return false;
  }
  if (candidate.widgetKind && hoverRevealEligibleKinds.has(candidate.widgetKind)) {
    return true;
  }
  if (candidate.affordanceAction === "open menu" || candidate.affordanceAction === "expand") {
    return true;
  }
  if (candidate.stateHint === "collapsed" || candidate.stateHint === "expandable") {
    return true;
  }
  if (pageMode === "chat" && candidate.bounds.x < 420) {
    return true;
  }
  return false;
};

const boundsOverlap = (
  left: WorkbenchWebTargetCandidate["bounds"],
  right: WorkbenchWebTargetCandidate["bounds"]
): boolean =>
  left.x < right.x + right.width
  && left.x + left.width > right.x
  && left.y < right.y + right.height
  && left.y + left.height > right.y;

export const isLocallyRelevantCandidate = ({
  candidate,
  seed,
  revealRegion
}: {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly seed: LiveSelectorScanCandidateRecord;
  readonly revealRegion: WorkbenchWebTargetCandidate["bounds"];
}): boolean => {
  if (candidate.selectorAddress.frameTreeNodeId !== seed.selectorAddress.frameTreeNodeId) {
    return false;
  }
  if (candidate.selectorAddress.path === seed.selectorAddress.path) {
    return false;
  }
  if (candidate.visibilityState === "hidden") {
    return false;
  }
  if (boundsOverlap(candidate.bounds, revealRegion)) {
    return true;
  }

  const seedWidgetIds = new Set(
    [seed.widgetId, seed.ownerWidgetId].filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  if (
    seedWidgetIds.size > 0
    && (
      (candidate.widgetId !== undefined && seedWidgetIds.has(candidate.widgetId))
      || (candidate.ownerWidgetId !== undefined && seedWidgetIds.has(candidate.ownerWidgetId))
    )
  ) {
    return true;
  }

  const panelLikeKinds = new Set<string>([
    "menu-panel",
    "menu",
    "dialog",
    "list",
    "list-item",
    "navigation",
    "sidebar"
  ]);
  if (!panelLikeKinds.has(candidate.widgetKind ?? "unknown")) {
    return false;
  }

  const seedCenterX = seed.bounds.x + seed.bounds.width / 2;
  const seedCenterY = seed.bounds.y + seed.bounds.height / 2;
  const candidateCenterX = candidate.bounds.x + candidate.bounds.width / 2;
  const candidateCenterY = candidate.bounds.y + candidate.bounds.height / 2;
  const distanceX = Math.abs(candidateCenterX - seedCenterX);
  const distanceY = Math.abs(candidateCenterY - seedCenterY);
  return distanceX <= 520 && distanceY <= 360;
};

export const mergeRevealedCandidates = ({
  baseline,
  revealed,
  intent
}: {
  readonly baseline: readonly LiveSelectorScanCandidateRecord[];
  readonly revealed: readonly LiveSelectorScanCandidateRecord[];
  readonly intent: WorkbenchWebTargetIntent;
}): readonly LiveSelectorScanCandidateRecord[] => {
  const candidateMap = new Map<string, LiveSelectorScanCandidateRecord>();
  for (const candidate of baseline) {
    candidateMap.set(
      `${candidate.selectorAddress.frameTreeNodeId}:${candidate.selectorAddress.path}`,
      candidate
    );
  }
  for (const candidate of revealed) {
    candidateMap.set(
      `${candidate.selectorAddress.frameTreeNodeId}:${candidate.selectorAddress.path}`,
      candidate
    );
  }
  return rankLiveSelectorCandidates([...candidateMap.values()], intent);
};
