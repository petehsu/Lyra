import type {
  WorkbenchWebTargetIntent,
} from "../../../shared/workbench-web-automation";
import type { LiveSelectorScanCandidateRecord } from "./types";

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const includesAny = (haystacks: readonly string[], needles: readonly string[]): boolean =>
  needles.some((needle) => {
    const normalizedNeedle = normalizeText(needle);
    return normalizedNeedle.length > 0
      && haystacks.some((haystack) => haystack.includes(normalizedNeedle));
  });

const visibilityScore = (value: LiveSelectorScanCandidateRecord["visibilityState"]): number => {
  switch (value) {
    case "visible":
      return 20;
    case "nearby":
      return 10;
    case "offscreen":
      return 2;
    default:
      return -10;
  }
};

const operationScore = (
  candidate: LiveSelectorScanCandidateRecord,
  intent: WorkbenchWebTargetIntent
): number => {
  const tagName = normalizeText(candidate.tagName);
  const role = normalizeText(candidate.role);
  let score = visibilityScore(candidate.visibilityState);

  if (candidate.disabled === true) {
    score -= 20;
  }

  if (intent.operation === "type") {
    if (candidate.interactable.typable) score += 24;
    if (tagName === "textarea") score += 16;
    if (tagName === "input") score += 12;
    if (role === "textbox" || role === "searchbox" || role === "combobox") score += 10;
  }

  if (intent.operation === "click" || intent.operation === "submit") {
    if (candidate.interactable.clickable) score += 18;
    if (tagName === "button" || tagName === "a") score += 10;
    if (role === "button" || role === "link" || role === "menuitem" || role === "tab") score += 8;
  }

  if (intent.operation === "focus") {
    if (candidate.interactable.focusable) score += 18;
    if (candidate.interactable.typable) score += 8;
  }

  if (intent.operation === "select") {
    if (candidate.interactable.selectable) score += 18;
    if (tagName === "select" || role === "listbox" || role === "combobox") score += 10;
  }

  return score;
};

const semanticHintScore = (
  candidate: LiveSelectorScanCandidateRecord,
  intent: WorkbenchWebTargetIntent
): number => {
  const tagName = normalizeText(candidate.tagName);
  const role = normalizeText(candidate.role);
  let score = 0;

  if ((intent.desiredTags ?? []).map(normalizeText).includes(tagName)) {
    score += 12;
  }
  if ((intent.desiredRoles ?? []).map(normalizeText).includes(role)) {
    score += 12;
  }

  const haystacks = [
    normalizeText(candidate.textSnippet),
    normalizeText(candidate.ariaLabel),
    normalizeText(candidate.placeholder),
    normalizeText(candidate.selectorPreview),
    normalizeText(candidate.stableSignature.name),
    normalizeText(candidate.stableSignature.id),
    normalizeText(candidate.stableSignature.ariaLabel)
  ];
  if (includesAny(haystacks, intent.textHints ?? [])) {
    score += 10;
  }
  if (includesAny(haystacks, intent.placeholderHints ?? [])) {
    score += 10;
  }

  return score;
};

const viewportAffinityScore = (candidate: LiveSelectorScanCandidateRecord): number => {
  const centerX = candidate.bounds.x + candidate.bounds.width / 2;
  const centerY = candidate.bounds.y + candidate.bounds.height / 2;
  const distancePenalty = Math.min(18, Math.round((Math.abs(centerX - 640) + Math.abs(centerY - 360)) / 120));
  return 12 - distancePenalty;
};

const clickShapeScore = (
  candidate: LiveSelectorScanCandidateRecord,
  intent: WorkbenchWebTargetIntent
): number => {
  if (intent.operation !== "click" && intent.operation !== "submit") {
    return 0;
  }

  const width = candidate.bounds.width;
  const height = candidate.bounds.height;
  const text = normalizeText(candidate.textSnippet)
    || normalizeText(candidate.ariaLabel)
    || normalizeText(candidate.placeholder);

  let score = 0;
  if (width <= 56 && height <= 56) {
    score += 8;
  }
  if (width >= 72 && height <= 40 && text.length > 0) {
    score -= 12;
  }
  if (width >= 88 && height <= 40) {
    score -= 6;
  }
  return score;
};

const composerAffinityScore = (
  candidate: LiveSelectorScanCandidateRecord,
  intent: WorkbenchWebTargetIntent,
  allCandidates: readonly LiveSelectorScanCandidateRecord[]
): number => {
  if (intent.operation !== "click" && intent.operation !== "submit") {
    return 0;
  }
  if (!candidate.interactable.clickable) {
    return 0;
  }

  const anchors = allCandidates.filter((entry) => entry.interactable.typable);
  if (anchors.length === 0) {
    return 0;
  }

  let bestScore = Number.NEGATIVE_INFINITY;
  for (const anchor of anchors) {
    const candidateCenterY = candidate.bounds.y + candidate.bounds.height / 2;
    const anchorCenterY = anchor.bounds.y + anchor.bounds.height / 2;
    const verticalGap = Math.abs(candidateCenterY - anchorCenterY);
    const horizontalDistance = candidate.bounds.x - (anchor.bounds.x + anchor.bounds.width);
    const overlapWidth = Math.min(
      candidate.bounds.x + candidate.bounds.width,
      anchor.bounds.x + anchor.bounds.width
    ) - Math.max(candidate.bounds.x, anchor.bounds.x);

    let score = 0;
    if (verticalGap <= 42) {
      score += 12;
    } else if (verticalGap <= 72) {
      score += 5;
    } else {
      score -= 8;
    }

    if (horizontalDistance >= -24 && horizontalDistance <= 240) {
      score += 12 - Math.min(10, Math.abs(horizontalDistance) / 24);
    } else {
      score -= 6;
    }

    if (candidate.bounds.x >= anchor.bounds.x + anchor.bounds.width * 0.55) {
      score += 4;
    }
    if (overlapWidth > 0) {
      score -= 10;
    }

    bestScore = Math.max(bestScore, score);
  }

  return Number.isFinite(bestScore) ? bestScore : 0;
};

export const rankLiveSelectorCandidates = (
  candidates: readonly LiveSelectorScanCandidateRecord[],
  intent: WorkbenchWebTargetIntent
): readonly LiveSelectorScanCandidateRecord[] =>
  [...candidates]
    .map((candidate) => ({
      candidate,
      score:
        operationScore(candidate, intent)
        + semanticHintScore(candidate, intent)
        + viewportAffinityScore(candidate)
        + clickShapeScore(candidate, intent)
        + composerAffinityScore(candidate, intent, candidates)
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ candidate, score }) => ({
      ...candidate,
      score
    }));
