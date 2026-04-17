import type {
  WorkbenchWebTargetIntent,
} from "../../../shared/workbench-web-automation";
import type { LiveSelectorScanCandidateRecord } from "./types";

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const isResizeCursor = (value: string | undefined): boolean => {
  const normalized = normalizeText(value);
  return normalized.includes("resize");
};

const includesAny = (haystacks: readonly string[], needles: readonly string[]): boolean =>
  needles.some((needle) => {
    const normalizedNeedle = normalizeText(needle);
    return normalizedNeedle.length > 0
      && haystacks.some((haystack) => haystack.includes(normalizedNeedle));
  });

const isWrapperLike = (candidate: LiveSelectorScanCandidateRecord): boolean => {
  const tagName = normalizeText(candidate.tagName);
  if (tagName !== "div" && tagName !== "span" && tagName !== "svg") {
    return false;
  }
  const descriptors = [
    normalizeText(candidate.role),
    normalizeText(candidate.ariaLabel),
    normalizeText(candidate.textSnippet),
    normalizeText(candidate.placeholder),
    normalizeText(candidate.affordanceLabel)
  ].filter((value) => value.length > 0);
  return descriptors.length === 0;
};

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
  if (candidate.isHumanOperable === false) {
    score -= 32;
  }

  if (intent.operation === "type") {
    if (!candidate.interactable.typable) {
      score -= 56;
    }
    if (candidate.interactable.typable) score += 24;
    if (tagName === "textarea") score += 16;
    if (tagName === "input") score += 12;
    if (role === "textbox" || role === "searchbox" || role === "combobox") score += 10;
  }

  if (intent.operation === "click" || intent.operation === "submit") {
    if (!candidate.interactable.clickable) {
      score -= 36;
    }
    if (candidate.interactable.clickable) score += 18;
    if (tagName === "button" || tagName === "a") score += 10;
    if (role === "button" || role === "link" || role === "menuitem" || role === "tab") score += 8;
  }

  if (intent.operation === "hover") {
    if (!candidate.interactable.clickable && !candidate.interactable.focusable) {
      score -= 28;
    }
    if (candidate.interactable.clickable) score += 16;
    if (candidate.interactable.focusable) score += 10;
    if (tagName === "button" || tagName === "a" || tagName === "div") score += 8;
    if (role === "button" || role === "link" || role === "menuitem" || role === "tab") score += 8;
  }

  if (intent.operation === "focus") {
    if (!candidate.interactable.focusable && !candidate.interactable.typable) {
      score -= 32;
    }
    if (candidate.interactable.focusable) score += 18;
    if (candidate.interactable.typable) score += 8;
  }

  if (intent.operation === "select") {
    if (!candidate.interactable.selectable) {
      score -= 40;
    }
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
    normalizeText(candidate.affordanceLabel),
    normalizeText(candidate.affordanceAction),
    normalizeText(candidate.tooltipText),
    normalizeText(candidate.stateHint),
    normalizeText(candidate.selectorPreview),
    normalizeText(candidate.stableSignature.name),
    normalizeText(candidate.stableSignature.id),
    normalizeText(candidate.stableSignature.ariaLabel)
  ];
  const textMatched = includesAny(haystacks, intent.textHints ?? []);
  const placeholderMatched = includesAny(haystacks, intent.placeholderHints ?? []);
  if (textMatched) {
    score += 10;
  }
  if (placeholderMatched) {
    score += 10;
  }
  if ((intent.textHints?.length ?? 0) > 0 && !textMatched) {
    score -= 16;
  }
  if ((intent.placeholderHints?.length ?? 0) > 0 && !placeholderMatched) {
    score -= 8;
  }

  return score;
};

const workflowAffinityScore = (
  candidate: LiveSelectorScanCandidateRecord,
  intent: WorkbenchWebTargetIntent,
  allCandidates: readonly LiveSelectorScanCandidateRecord[]
): number => {
  let score = 0;
  if (candidate.inActiveFocusRegion === true) {
    score += intent.operation === "click" || intent.operation === "hover" || intent.operation === "focus"
      ? 18
      : 10;
  }
  if (typeof candidate.focusOrder === "number") {
    if (candidate.focusOrder <= 2) {
      score += 8;
    } else if (candidate.focusOrder <= 5) {
      score += 4;
    }
  }
  if (typeof candidate.atlasConfidence === "number") {
    score += Math.round(candidate.atlasConfidence * 10);
  }
  if (
    (intent.operation === "click" || intent.operation === "hover" || intent.operation === "focus")
    && normalizeText(candidate.affordanceAction) === "expand"
  ) {
    score += 14;
  }
  if (
    (intent.operation === "click" || intent.operation === "hover" || intent.operation === "focus")
    && normalizeText(candidate.stateHint) === "collapsed"
  ) {
    score += 10;
  }
  if (
    candidate.inActiveFocusRegion === true
    && (intent.operation === "click" || intent.operation === "hover" || intent.operation === "focus")
    && normalizeText(candidate.affordanceAction) === "expand"
  ) {
    score += 24;
  }
  if (
    candidate.inActiveFocusRegion === true
    && (intent.operation === "click" || intent.operation === "hover" || intent.operation === "focus")
    && normalizeText(candidate.stateHint) === "collapsed"
  ) {
    score += 18;
  }
  if (candidate.discoveryMode === "hover_revealed") {
    score += 18;
  } else if (candidate.discoveryMode === "action_revealed") {
    score += 22;
  }
  if (candidate.ownerWidgetId !== undefined) {
    score += 8;
  }
  if (normalizeText(candidate.cursorStyle) === "pointer") {
    score += 4;
  }
  if (isResizeCursor(candidate.cursorStyle)) {
    score -= 18;
    if (normalizeText(candidate.affordanceAction) === "expand") {
      score -= 10;
    }
  }
  if (normalizeText(candidate.tooltipText).length > 0) {
    score += 3;
  }
  if (candidate.widgetKind === "menu-trigger" && (intent.operation === "click" || intent.operation === "hover")) {
    score += 18;
  }
  if (candidate.widgetKind === "menu-panel" && (intent.operation === "click" || intent.operation === "submit")) {
    score += 10;
  }
  if (candidate.widgetKind === "list-item" && intent.operation === "hover") {
    score += 8;
  }
  if ((candidate.widgetKind === "composer" || candidate.widgetKind === "chat-composer") && intent.operation === "type") {
    score += 12;
  }
  if ((candidate.widgetKind === "mode-switcher" || candidate.widgetKind === "toggle-group") && intent.operation === "click") {
    score += 10;
  }
  if (candidate.widgetKind === "sidebar" && (intent.operation === "click" || intent.operation === "hover")) {
    score += 12;
  }
  if (candidate.itemIdentity?.label !== undefined) {
    const siblingsInItem = allCandidates.filter((entry) => entry.ownerWidgetId === candidate.ownerWidgetId);
    if (siblingsInItem.length > 0) {
      score += 4;
    }
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
  if (intent.operation !== "click" && intent.operation !== "submit" && intent.operation !== "hover") {
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
  if (intent.operation !== "click" && intent.operation !== "submit" && intent.operation !== "hover") {
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

const keyboardReachabilityScore = (
  candidate: LiveSelectorScanCandidateRecord,
  intent: WorkbenchWebTargetIntent,
  allCandidates: readonly LiveSelectorScanCandidateRecord[]
): number => {
  const keyboardReachable =
    candidate.interactable.typable
    || candidate.interactable.selectable
    || candidate.interactable.focusable
    || typeof candidate.focusOrder === "number";

  let score = keyboardReachable ? 10 : -6;
  if (candidate.interactable.clickable && !keyboardReachable) {
    score -= 8;
  }
  if (isWrapperLike(candidate)) {
    score -= 18;
  }
  if (
    candidate.interactable.clickable
    && !keyboardReachable
    && allCandidates.some((entry) =>
      entry !== candidate
      && entry.interactable.clickable
      && (entry.interactable.typable || entry.interactable.selectable || entry.interactable.focusable)
      && normalizeText(entry.ariaLabel) === normalizeText(candidate.ariaLabel)
    )
  ) {
    score -= 12;
  }
  if (intent.operation === "type" && !keyboardReachable) {
    score -= 14;
  }
  return score;
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
        + keyboardReachabilityScore(candidate, intent, candidates)
        + workflowAffinityScore(candidate, intent, candidates)
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ candidate, score }) => ({
      ...candidate,
      score
    }));
