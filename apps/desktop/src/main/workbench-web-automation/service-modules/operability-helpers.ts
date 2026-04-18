import type {
  WorkbenchWebFocusAtlas,
  WorkbenchWebFocusReadResult,
  WorkbenchWebTargetScanResult,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

const clampScore = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const normalizeCandidateDescriptor = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const isKeyboardReachableCandidate = (
  candidate: Pick<LiveSelectorScanCandidateRecord, "interactable" | "focusOrder">
): boolean =>
  candidate.interactable.typable
  || candidate.interactable.selectable
  || candidate.interactable.focusable
  || typeof candidate.focusOrder === "number";

const isWrapperLikeCandidate = (
  candidate: Pick<
    LiveSelectorScanCandidateRecord,
    "tagName" | "role" | "ariaLabel" | "textSnippet" | "placeholder" | "affordanceLabel"
  >
): boolean => {
  const tagName = normalizeCandidateDescriptor(candidate.tagName);
  if (tagName !== "div" && tagName !== "span" && tagName !== "svg") {
    return false;
  }
  const descriptors = [
    candidate.role,
    candidate.ariaLabel,
    candidate.textSnippet,
    candidate.placeholder,
    candidate.affordanceLabel
  ]
    .map(normalizeCandidateDescriptor)
    .filter((value) => value.length > 0);
  return descriptors.length === 0;
};

const isWithinCurrentWorkflowCandidate = (
  candidate: Pick<
    LiveSelectorScanCandidateRecord,
    "widgetId" | "ownerWidgetId" | "inActiveFocusRegion" | "discoveryMode"
  >,
  session?: WorkbenchAgentWebSession | null
): boolean => {
  if (candidate.inActiveFocusRegion === true || candidate.discoveryMode !== undefined) {
    return true;
  }
  if (session === null || session === undefined) {
    return false;
  }
  return candidate.widgetId === session.activeWidgetId
    || candidate.ownerWidgetId === session.activeWidgetId
    || candidate.widgetId === session.activeItemId
    || candidate.ownerWidgetId === session.activeItemId;
};

const humanOperableScoreForCandidate = (
  candidate: LiveSelectorScanCandidateRecord,
  session?: WorkbenchAgentWebSession | null
): number => {
  let score = 48;

  switch (candidate.visibilityState) {
    case "visible":
      score += 18;
      break;
    case "nearby":
      score += 8;
      break;
    case "offscreen":
      score -= 8;
      break;
    case "hidden":
      score -= 24;
      break;
  }

  if (candidate.isHumanOperable === false) {
    score -= 42;
  } else {
    score += 6;
  }

  if (candidate.interactable.typable || candidate.interactable.selectable) {
    score += 16;
  } else if (candidate.interactable.focusable) {
    score += 12;
  } else if (candidate.interactable.clickable) {
    score += 6;
  }

  if (isKeyboardReachableCandidate(candidate)) {
    score += 10;
  }

  if (isWithinCurrentWorkflowCandidate(candidate, session)) {
    score += 10;
  }

  if (candidate.discoveryMode === "hover_revealed" || candidate.discoveryMode === "action_revealed") {
    score += 8;
  }

  if (candidate.widgetKind === "protected") {
    score -= 64;
  }

  if (isWrapperLikeCandidate(candidate)) {
    score -= 18;
  }

  if (
    candidate.interactable.clickable
    && !isKeyboardReachableCandidate(candidate)
    && isWrapperLikeCandidate(candidate)
  ) {
    score -= 10;
  }

  return clampScore(Math.round(score), 0, 100);
};

export const annotateCandidateForOperability = (
  candidate: LiveSelectorScanCandidateRecord,
  session?: WorkbenchAgentWebSession | null
): LiveSelectorScanCandidateRecord => ({
  ...candidate,
  humanOperableScore: humanOperableScoreForCandidate(candidate, session),
  keyboardReachable: isKeyboardReachableCandidate(candidate),
  withinCurrentWorkflow: isWithinCurrentWorkflowCandidate(candidate, session)
});

export const annotateCandidatesForOperability = (
  candidates: readonly LiveSelectorScanCandidateRecord[],
  session?: WorkbenchAgentWebSession | null
): readonly LiveSelectorScanCandidateRecord[] =>
  candidates.map((candidate) => annotateCandidateForOperability(candidate, session));

export const focusAtlasDiagnosticsFromScan = ({
  durationMs,
  atlas,
  widgets,
}: {
  readonly durationMs: number;
  readonly atlas: WorkbenchWebFocusAtlas;
  readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
}): WorkbenchWebFocusReadResult["diagnostics"] => ({
  durationMs,
  candidateCount: atlas.nodes.length,
  widgetCount: widgets.length
});
