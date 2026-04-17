import type {
  WorkbenchWebElementBounds,
  WorkbenchWebTargetIntent
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import type { LiveSelectorScanCandidateRecord } from "./types";

const boundsOverlap = (
  left: WorkbenchWebElementBounds,
  right: WorkbenchWebElementBounds
): boolean =>
  left.x < right.x + right.width
  && left.x + left.width > right.x
  && left.y < right.y + right.height
  && left.y + left.height > right.y;

const pointDistanceToBounds = (
  point: { readonly x: number; readonly y: number },
  bounds: WorkbenchWebElementBounds
): number => {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const dx = centerX - point.x;
  const dy = centerY - point.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const isLowValueNoiseCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean => {
  const tagName = candidate.tagName.trim().toLowerCase();
  const role = (candidate.role ?? "").trim().toLowerCase();
  const labelText = [
    candidate.ariaLabel,
    candidate.placeholder,
    candidate.textSnippet,
    candidate.itemIdentity?.label
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ");

  if (tagName === "body" || tagName === "html") {
    return true;
  }
  if (candidate.visibilityState === "hidden") {
    return true;
  }
  if (candidate.isHumanOperable === false) {
    return true;
  }
  if (candidate.disabled === true && candidate.interactable.typable !== true) {
    return true;
  }
  if (
    (tagName === "div" || tagName === "span")
    && role.length === 0
    && labelText.length === 0
    && candidate.widgetKind === undefined
    && candidate.bounds.width >= 640
    && candidate.bounds.height >= 72
  ) {
    return true;
  }
  return false;
};

const isLocalToWorkflow = (
  candidate: LiveSelectorScanCandidateRecord,
  session: WorkbenchAgentWebSession
): boolean => {
  if (session.activeItemId !== undefined) {
    if (
      candidate.widgetId === session.activeItemId
      || candidate.ownerWidgetId === session.activeItemId
    ) {
      return true;
    }
  }
  if (session.activeWidgetId !== undefined) {
    if (
      candidate.widgetId === session.activeWidgetId
      || candidate.ownerWidgetId === session.activeWidgetId
    ) {
      return true;
    }
  }
  if (session.revealRegion !== undefined && boundsOverlap(candidate.bounds, session.revealRegion)) {
    return true;
  }
  if (session.workflowRegion !== undefined && boundsOverlap(candidate.bounds, session.workflowRegion)) {
    return true;
  }
  return false;
};

const isPointerAdjacent = (
  candidate: LiveSelectorScanCandidateRecord,
  session: WorkbenchAgentWebSession
): boolean => {
  if (session.pointer === undefined) {
    return false;
  }
  return pointDistanceToBounds(session.pointer, candidate.bounds) <= 260;
};

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const includesAny = (haystacks: readonly string[], needles: readonly string[]): boolean =>
  needles.some((needle) => {
    const normalizedNeedle = normalizeText(needle);
    return normalizedNeedle.length > 0
      && haystacks.some((haystack) => haystack.includes(normalizedNeedle));
  });

const semanticallyMatchesIntent = (
  candidate: LiveSelectorScanCandidateRecord,
  intent?: WorkbenchWebTargetIntent
): boolean => {
  if (intent === undefined) {
    return false;
  }
  const hints = [...(intent.textHints ?? []), ...(intent.placeholderHints ?? [])];
  if (hints.length === 0) {
    return false;
  }
  const haystacks = [
    normalizeText(candidate.textSnippet),
    normalizeText(candidate.ariaLabel),
    normalizeText(candidate.placeholder),
    normalizeText(candidate.affordanceLabel),
    normalizeText(candidate.affordanceAction),
    normalizeText(candidate.tooltipText),
    normalizeText(candidate.selectorPreview),
    normalizeText(candidate.itemIdentity?.label),
    normalizeText(candidate.itemIdentity?.title),
    normalizeText(candidate.stableSignature.name),
    normalizeText(candidate.stableSignature.ariaLabel)
  ];
  return includesAny(haystacks, hints);
};

export const prioritizeSurfaceCandidates = ({
  candidates,
  session,
  limit,
  intent,
}: {
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly session?: WorkbenchAgentWebSession | null;
  readonly limit: number;
  readonly intent?: WorkbenchWebTargetIntent;
}): readonly LiveSelectorScanCandidateRecord[] => {
  const filtered = candidates.filter((candidate) => !isLowValueNoiseCandidate(candidate));
  if (session === null || session === undefined) {
    return filtered.slice(0, limit);
  }

  const local = filtered.filter((candidate) => isLocalToWorkflow(candidate, session));
  const revealed = filtered.filter((candidate) => candidate.discoveryMode !== undefined);
  const activeFocusRegion = filtered.filter((candidate) => candidate.inActiveFocusRegion === true);
  const pointerAdjacent = filtered.filter((candidate) => isPointerAdjacent(candidate, session));
  const semanticMatches = filtered.filter((candidate) => semanticallyMatchesIntent(candidate, intent));

  if (
    local.length === 0
    && revealed.length === 0
    && activeFocusRegion.length === 0
    && pointerAdjacent.length === 0
    && semanticMatches.length === 0
  ) {
    return filtered.slice(0, limit);
  }

  const ordered: LiveSelectorScanCandidateRecord[] = [];
  const seen = new Set<string>();
  const push = (candidate: LiveSelectorScanCandidateRecord) => {
    const key = `${candidate.selectorAddress.frameTreeNodeId}:${candidate.selectorAddress.path}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    ordered.push(candidate);
  };

  for (const candidate of [...revealed, ...semanticMatches, ...activeFocusRegion, ...local, ...pointerAdjacent, ...filtered]) {
    push(candidate);
  }

  return ordered.slice(0, limit);
};
