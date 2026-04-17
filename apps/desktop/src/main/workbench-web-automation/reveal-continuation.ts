import type { WorkbenchWebQueryRequest } from "../../shared/workbench-web-automation";
import type { LiveSelectorScanCandidateRecord } from "./live-selector/types";
import { matchesRequestedRoles } from "./query-semantics";
import type { WorkbenchWebAutomationCallContext } from "./types";

export const QUERY_INTENT_CUE_TTL_MS = 300_000;

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : "";

const hasMeaningfulSemanticToken = (value: string): boolean =>
  /[a-z0-9\u4e00-\u9fff]/i.test(value);

const normalizeValues = (values: readonly (string | undefined)[]): readonly string[] =>
  Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter((value) => value.length > 0 && hasMeaningfulSemanticToken(value))
    )
  );

const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const readString = (record: Record<string, unknown> | undefined, key: string): string | undefined =>
  typeof record?.[key] === "string" && (record[key] as string).trim().length > 0
    ? (record[key] as string).trim()
    : undefined;

const candidateTextProfile = (candidate: LiveSelectorScanCandidateRecord): readonly string[] =>
  normalizeValues([
    candidate.textSnippet,
    candidate.ariaLabel,
    candidate.placeholder,
    candidate.affordanceLabel,
    candidate.affordanceAction,
    candidate.tooltipText,
    candidate.stateHint,
    candidate.itemIdentity?.label,
    candidate.itemIdentity?.title,
    candidate.selectorPreview,
    candidate.stableSignature.id,
    candidate.stableSignature.name,
    candidate.stableSignature.testId,
    candidate.stableSignature.ariaLabel,
  ]);

const isMenuLikeCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean => {
  const widgetKind = normalizeText(candidate.widgetKind);
  if (
    widgetKind === "menu"
    || widgetKind === "menu-panel"
    || widgetKind === "menu-trigger"
    || widgetKind === "list-item"
    || widgetKind === "toggle-group"
    || widgetKind === "mode-switcher"
  ) {
    return true;
  }
  const role = normalizeText(candidate.role);
  return role === "menuitem" || role === "option" || role === "tab";
};

const isSelectedLikeState = (candidate: LiveSelectorScanCandidateRecord): boolean => {
  const state = normalizeText(candidate.stateHint);
  if (state.length === 0) {
    return false;
  }
  if (state.includes("unselected") || state.includes("inactive") || state.includes("off")) {
    return false;
  }
  return state.includes("selected")
    || state.includes("active")
    || state.includes("current")
    || /\bon\b/.test(state);
};

export type WorkbenchWebQueryIntentCue = {
  readonly capturedAt: number;
  readonly textHints: readonly string[];
  readonly roles: readonly string[];
  readonly within?: string;
  readonly near?: string;
  readonly agentSessionId?: string;
};

export const captureQueryIntentCue = ({
  request,
  context,
  now = Date.now(),
}: {
  readonly request?: WorkbenchWebQueryRequest;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly now?: number;
}): WorkbenchWebQueryIntentCue | null => {
  if (request === undefined) {
    return null;
  }
  const roles = normalizeValues([
    ...(Array.isArray(request.role) ? request.role : request.role === undefined ? [] : [request.role])
  ]);
  const textHints = normalizeValues([
    request.name,
    request.text,
    request.near,
    request.within,
    request.before,
    request.after,
    request.currentSubgoal,
  ]);
  if (roles.length === 0 && textHints.length === 0) {
    return null;
  }
  const within = normalizeText(request.within);
  const near = normalizeText(request.near);
  return {
    capturedAt: now,
    roles,
    textHints,
    ...(within.length === 0 ? {} : { within }),
    ...(near.length === 0 ? {} : { near }),
    ...(context?.agentSessionId === undefined ? {} : { agentSessionId: context.agentSessionId }),
  };
};

export const readFreshQueryIntentCue = ({
  cueByTab,
  tabId,
  context,
  now = Date.now(),
  ttlMs = QUERY_INTENT_CUE_TTL_MS,
}: {
  readonly cueByTab: Map<string, WorkbenchWebQueryIntentCue>;
  readonly tabId: string;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly now?: number;
  readonly ttlMs?: number;
}): WorkbenchWebQueryIntentCue | null => {
  const cue = cueByTab.get(tabId);
  if (cue === undefined) {
    return null;
  }
  if (now - cue.capturedAt > ttlMs) {
    cueByTab.delete(tabId);
    return null;
  }
  if (
    cue.agentSessionId !== undefined
    && context?.agentSessionId !== undefined
    && cue.agentSessionId !== context.agentSessionId
  ) {
    return null;
  }
  return cue;
};

export const extractActionTargetTextHints = (
  target: Record<string, unknown> | undefined
): readonly string[] => {
  const stableSignature = readRecord(target?.stableSignature);
  return normalizeValues([
    readString(target, "text"),
    readString(target, "textContains"),
    readString(target, "textSnippet"),
    readString(target, "ariaLabel"),
    readString(target, "label"),
    readString(target, "name"),
    readString(target, "placeholder"),
    readString(target, "id"),
    readString(target, "testId"),
    readString(stableSignature, "ariaLabel"),
    readString(stableSignature, "name"),
    readString(stableSignature, "id"),
    readString(stableSignature, "testId"),
  ]);
};

const scoreRevealContinuationCandidate = ({
  candidate,
  sourceCandidate,
  queryCue,
  targetTextHints,
}: {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly sourceCandidate: LiveSelectorScanCandidateRecord;
  readonly queryCue: WorkbenchWebQueryIntentCue | null;
  readonly targetTextHints: readonly string[];
}): number => {
  if (candidate.candidateId === sourceCandidate.candidateId) {
    return Number.NEGATIVE_INFINITY;
  }
  if (candidate.disabled === true || candidate.visibilityState === "hidden") {
    return Number.NEGATIVE_INFINITY;
  }
  if (!candidate.interactable.clickable && !candidate.interactable.focusable && !candidate.interactable.selectable) {
    return Number.NEGATIVE_INFINITY;
  }
  const sourceIsModeToggle =
    sourceCandidate.widgetKind === "mode-switcher"
    || sourceCandidate.widgetKind === "toggle-group";
  const sourceIsTrigger = isTriggerLikeCandidate(sourceCandidate);
  if (
    sourceIsTrigger
    && isRedundantTriggerCandidate({
      sourceCandidate,
      candidate
    })
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = candidate.humanOperableScore ?? candidate.score ?? 0;
  score += candidate.visibilityState === "visible" ? 8 : 2;
  score += candidate.interactable.clickable ? 10 : 0;
  score += candidate.interactable.selectable ? 7 : 0;
  score += isMenuLikeCandidate(candidate) ? 9 : 0;
  score += isTriggerLikeCandidate(candidate) ? -16 : 0;

  const sourceWidgetId = sourceCandidate.widgetId ?? sourceCandidate.ownerWidgetId;
  if (
    sourceWidgetId !== undefined
    && (candidate.widgetId === sourceWidgetId || candidate.ownerWidgetId === sourceWidgetId)
  ) {
    score += 12;
  }

  const cueTextHints = normalizeValues([
    ...(queryCue?.textHints ?? []),
    ...targetTextHints
  ]);

  const profile = candidateTextProfile(candidate);
  for (const hint of cueTextHints) {
    if (profile.includes(hint)) {
      score += 24;
      continue;
    }
    if (profile.some((value) => value.includes(hint) || hint.includes(value))) {
      score += 14;
      continue;
    }
    score -= 2;
  }

  if ((queryCue?.roles.length ?? 0) > 0) {
    score += matchesRequestedRoles(candidate, queryCue!.roles) ? 14 : -9;
  }

  if (sourceIsModeToggle) {
    score += isModeSelectionCandidate(candidate) ? 14 : -22;
    score += isSelectedLikeState(candidate) ? -18 : 10;
    score += isTriggerLikeCandidate(candidate) ? -24 : 0;
    score += (
      candidate.widgetKind === "menu-panel"
      || candidate.widgetKind === "list-item"
    ) ? 10 : 0;
    const candidateRole = normalizeText(candidate.role ?? inferRoleFromTag(candidate.tagName));
    if (candidateRole === "option" || candidateRole === "menuitem" || candidateRole === "tab") {
      score += 8;
    }
  }

  return score;
};

const inferRoleFromTag = (tagName: string | undefined): string | undefined => {
  const tag = normalizeText(tagName);
  if (tag === "option") {
    return "option";
  }
  if (tag === "button") {
    return "button";
  }
  if (tag === "a") {
    return "link";
  }
  return undefined;
};

const isTriggerLikeWidgetKind = (value: string | undefined): boolean =>
  value === "menu-trigger" || value === "mode-switcher" || value === "toggle-group";

const isTriggerLikeCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean =>
  isTriggerLikeWidgetKind(candidate.widgetKind)
  || normalizeText(candidate.affordanceAction) === "open menu"
  || normalizeText(candidate.affordanceAction) === "expand";

const hasSameStableIdentity = (
  sourceCandidate: LiveSelectorScanCandidateRecord,
  candidate: LiveSelectorScanCandidateRecord
): boolean => {
  const keys: readonly (keyof LiveSelectorScanCandidateRecord["stableSignature"])[] = ["id", "name", "testId"];
  return keys.some((key) => {
    const source = normalizeText(sourceCandidate.stableSignature[key]);
    const next = normalizeText(candidate.stableSignature[key]);
    return source.length > 0 && source === next;
  });
};

const sharedProfileTokenCount = (
  sourceCandidate: LiveSelectorScanCandidateRecord,
  candidate: LiveSelectorScanCandidateRecord
): number => {
  const sourceSet = new Set(buildProfile(sourceCandidate));
  let count = 0;
  for (const value of buildProfile(candidate)) {
    if (sourceSet.has(value)) {
      count += 1;
    }
  }
  return count;
};

const isRedundantTriggerCandidate = ({
  sourceCandidate,
  candidate
}: {
  readonly sourceCandidate: LiveSelectorScanCandidateRecord;
  readonly candidate: LiveSelectorScanCandidateRecord;
}): boolean => {
  if (!isTriggerLikeCandidate(sourceCandidate) || !isTriggerLikeCandidate(candidate)) {
    return false;
  }
  if (hasSameStableIdentity(sourceCandidate, candidate)) {
    return true;
  }
  if (sharedProfileTokenCount(sourceCandidate, candidate) >= 2) {
    return true;
  }
  const sourceCenterX = sourceCandidate.bounds.x + sourceCandidate.bounds.width / 2;
  const sourceCenterY = sourceCandidate.bounds.y + sourceCandidate.bounds.height / 2;
  const candidateCenterX = candidate.bounds.x + candidate.bounds.width / 2;
  const candidateCenterY = candidate.bounds.y + candidate.bounds.height / 2;
  return Math.abs(sourceCenterX - candidateCenterX) <= 28
    && Math.abs(sourceCenterY - candidateCenterY) <= 28;
};

const isModeSelectionCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean => {
  const role = normalizeText(candidate.role ?? inferRoleFromTag(candidate.tagName));
  if (role === "option" || role === "menuitem" || role === "tab") {
    return true;
  }
  return candidate.widgetKind === "list-item" || candidate.widgetKind === "menu-panel";
};

const isClickableContinuationCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean =>
  candidate.disabled !== true
  && candidate.visibilityState !== "hidden"
  && (candidate.interactable.clickable || candidate.interactable.focusable || candidate.interactable.selectable);

const buildProfile = (candidate: LiveSelectorScanCandidateRecord): readonly string[] =>
  normalizeValues([
    candidate.textSnippet,
    candidate.ariaLabel,
    candidate.placeholder,
    candidate.affordanceLabel,
    candidate.affordanceAction,
    candidate.tooltipText,
    candidate.stateHint,
    candidate.itemIdentity?.label,
    candidate.itemIdentity?.title,
    candidate.selectorPreview,
    candidate.stableSignature.id,
    candidate.stableSignature.name,
    candidate.stableSignature.testId,
    candidate.stableSignature.ariaLabel,
  ]);

const scoreHintMatch = (
  candidate: LiveSelectorScanCandidateRecord,
  hints: readonly string[]
): number => {
  if (hints.length === 0) {
    return 0;
  }
  const profile = buildProfile(candidate);
  let score = 0;
  for (const hint of hints) {
    if (profile.includes(hint)) {
      score += 20;
      continue;
    }
    if (profile.some((value) => value.includes(hint) || hint.includes(value))) {
      score += 10;
      continue;
    }
    score -= 2;
  }
  return score;
};

const rankFallbackCandidate = ({
  candidate,
  sourceCandidate,
  hints,
}: {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly sourceCandidate: LiveSelectorScanCandidateRecord;
  readonly hints: readonly string[];
}): number => {
  const sourceIsModeToggle =
    sourceCandidate.widgetKind === "mode-switcher"
    || sourceCandidate.widgetKind === "toggle-group";
  const sourceIsTrigger = isTriggerLikeCandidate(sourceCandidate);
  if (
    sourceIsTrigger
    && isRedundantTriggerCandidate({
      sourceCandidate,
      candidate
    })
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = candidate.humanOperableScore ?? candidate.score ?? 0;
  score += candidate.visibilityState === "visible" ? 7 : 2;
  score += candidate.interactable.clickable ? 8 : 0;
  score += candidate.interactable.selectable ? 5 : 0;
  score += isMenuLikeCandidate(candidate) ? 8 : 0;
  score += isTriggerLikeCandidate(candidate) ? -14 : 0;
  score += scoreHintMatch(candidate, hints);

  const sourceWidgetId = sourceCandidate.widgetId ?? sourceCandidate.ownerWidgetId;
  if (
    sourceWidgetId !== undefined
    && (candidate.widgetId === sourceWidgetId || candidate.ownerWidgetId === sourceWidgetId)
  ) {
    score += 10;
  }

  if (sourceIsModeToggle) {
    score += isModeSelectionCandidate(candidate) ? 14 : -20;
    score += isSelectedLikeState(candidate) ? -20 : 12;
    score += isTriggerLikeCandidate(candidate) ? -20 : 0;
    const role = normalizeText(candidate.role ?? inferRoleFromTag(candidate.tagName));
    if (role === "option" || role === "menuitem" || role === "tab") {
      score += 8;
    }
  }

  return score;
};

const isToggleContinuationCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean => {
  const role = normalizeText(candidate.role ?? inferRoleFromTag(candidate.tagName));
  if (role === "option" || role === "menuitem" || role === "tab") {
    return true;
  }
  return candidate.widgetKind === "menu-panel" || candidate.widgetKind === "list-item";
};

const compareByInteractionOrder = (
  left: LiveSelectorScanCandidateRecord,
  right: LiveSelectorScanCandidateRecord
): number => {
  if (left.focusOrder !== undefined && right.focusOrder !== undefined && left.focusOrder !== right.focusOrder) {
    return left.focusOrder - right.focusOrder;
  }
  if (left.bounds.y !== right.bounds.y) {
    return left.bounds.y - right.bounds.y;
  }
  if (left.bounds.x !== right.bounds.x) {
    return left.bounds.x - right.bounds.x;
  }
  return left.candidateId.localeCompare(right.candidateId);
};

const pickDeterministicToggleContinuationCandidate = ({
  sourceCandidate,
  revealedCandidates,
}: {
  readonly sourceCandidate: LiveSelectorScanCandidateRecord;
  readonly revealedCandidates: readonly LiveSelectorScanCandidateRecord[];
}): LiveSelectorScanCandidateRecord | undefined => {
  const toggleCandidates = revealedCandidates.filter((candidate) =>
    isToggleContinuationCandidate(candidate)
    && candidate.interactable.clickable
    && candidate.visibilityState !== "hidden"
    && candidate.disabled !== true
    && candidate.candidateId !== sourceCandidate.candidateId
  );
  if (toggleCandidates.length === 0) {
    return undefined;
  }

  const sourceWidgetIds = new Set(
    [sourceCandidate.widgetId, sourceCandidate.ownerWidgetId].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    )
  );
  const sameWidgetOrdered = sourceWidgetIds.size === 0
    ? []
    : [...toggleCandidates]
      .filter((candidate) =>
        (candidate.widgetId !== undefined && sourceWidgetIds.has(candidate.widgetId))
        || (candidate.ownerWidgetId !== undefined && sourceWidgetIds.has(candidate.ownerWidgetId))
        || (
          sourceCandidate.focusRegionId !== undefined
          && candidate.focusRegionId !== undefined
          && candidate.focusRegionId === sourceCandidate.focusRegionId
        )
      )
      .sort(compareByInteractionOrder);
  const ordered = (sameWidgetOrdered.length > 0 ? sameWidgetOrdered : [...toggleCandidates]).sort(compareByInteractionOrder);
  const unselected = ordered.filter((candidate) => !isSelectedLikeState(candidate));
  if (unselected.length === 0) {
    return undefined;
  }

  const selectedIds = new Set(
    ordered.filter((candidate) => isSelectedLikeState(candidate)).map((candidate) => candidate.candidateId)
  );
  if (selectedIds.size === 0) {
    return unselected[0];
  }

  const selectedIndex = ordered.findIndex((candidate) => selectedIds.has(candidate.candidateId));
  if (selectedIndex < 0) {
    return unselected[0];
  }
  for (let offset = 1; offset < ordered.length; offset += 1) {
    const forward = ordered[selectedIndex + offset];
    if (
      forward !== undefined
      && !selectedIds.has(forward.candidateId)
      && !isSelectedLikeState(forward)
    ) {
      return forward;
    }
    const backward = ordered[selectedIndex - offset];
    if (
      backward !== undefined
      && !selectedIds.has(backward.candidateId)
      && !isSelectedLikeState(backward)
    ) {
      return backward;
    }
  }
  return unselected[0];
};

export const pickRevealContinuationCandidate = ({
  sourceCandidate,
  revealedCandidates,
  queryCue,
  targetTextHints = [],
}: {
  readonly sourceCandidate: LiveSelectorScanCandidateRecord;
  readonly revealedCandidates: readonly LiveSelectorScanCandidateRecord[];
  readonly queryCue: WorkbenchWebQueryIntentCue | null;
  readonly targetTextHints?: readonly string[];
}): LiveSelectorScanCandidateRecord | undefined => {
  if (revealedCandidates.length === 0) {
    return undefined;
  }
  const sourceIsModeToggle =
    sourceCandidate.widgetKind === "mode-switcher"
    || sourceCandidate.widgetKind === "toggle-group";
  const hasCueSignals = (queryCue?.textHints.length ?? 0) > 0 || (queryCue?.roles.length ?? 0) > 0;
  if (!sourceIsModeToggle && !hasCueSignals) {
    return undefined;
  }
  if (sourceIsModeToggle && !hasCueSignals) {
    const fallback = pickDeterministicToggleContinuationCandidate({
      sourceCandidate,
      revealedCandidates
    });
    if (fallback !== undefined) {
      return fallback;
    }
  }

  const scored = revealedCandidates
    .map((candidate) => ({
      candidate,
      score: scoreRevealContinuationCandidate({
        candidate,
        sourceCandidate,
        queryCue,
        targetTextHints
      }),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  if (best === undefined) {
    return undefined;
  }
  const second = scored[1];
  const threshold = hasCueSignals ? 24 : sourceIsModeToggle ? 28 : 32;
  const margin = second === undefined ? best.score : best.score - second.score;
  if (best.score < threshold || margin < 6) {
    if (sourceIsModeToggle) {
      return pickDeterministicToggleContinuationCandidate({
        sourceCandidate,
        revealedCandidates
      });
    }
    return undefined;
  }
  return best.candidate;
};

export const rankRevealContinuationCandidates = ({
  sourceCandidate,
  revealedCandidates,
  queryCue,
  targetTextHints = [],
  maxCandidates = 4,
}: {
  readonly sourceCandidate: LiveSelectorScanCandidateRecord;
  readonly revealedCandidates: readonly LiveSelectorScanCandidateRecord[];
  readonly queryCue: WorkbenchWebQueryIntentCue | null;
  readonly targetTextHints?: readonly string[];
  readonly maxCandidates?: number;
}): readonly LiveSelectorScanCandidateRecord[] => {
  if (revealedCandidates.length === 0) {
    return [];
  }

  const sourceIsModeToggle =
    sourceCandidate.widgetKind === "mode-switcher"
    || sourceCandidate.widgetKind === "toggle-group";
  const sourceIsTrigger = isTriggerLikeCandidate(sourceCandidate);
  const hints = normalizeValues([
    ...(queryCue?.textHints ?? []),
    ...targetTextHints
  ]);

  const dedup = new Set<string>();
  const queue: LiveSelectorScanCandidateRecord[] = [];
  const pushUnique = (candidate: LiveSelectorScanCandidateRecord | undefined): void => {
    if (candidate === undefined) {
      return;
    }
    if (!isClickableContinuationCandidate(candidate)) {
      return;
    }
    if (candidate.candidateId === sourceCandidate.candidateId) {
      return;
    }
    if (sourceIsModeToggle && isSelectedLikeState(candidate)) {
      return;
    }
    if (
      sourceIsTrigger
      && isRedundantTriggerCandidate({
        sourceCandidate,
        candidate
      })
    ) {
      return;
    }
    if (dedup.has(candidate.candidateId)) {
      return;
    }
    dedup.add(candidate.candidateId);
    queue.push(candidate);
  };

  pushUnique(
    pickRevealContinuationCandidate({
      sourceCandidate,
      revealedCandidates,
      queryCue,
      targetTextHints
    })
  );

  const fallbackRanked = revealedCandidates
    .filter((candidate) => candidate.candidateId !== sourceCandidate.candidateId)
    .map((candidate) => ({
      candidate,
      score: rankFallbackCandidate({
        candidate,
        sourceCandidate,
        hints
      })
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.candidate);

  for (const candidate of fallbackRanked) {
    pushUnique(candidate);
    if (queue.length >= Math.max(1, Math.min(8, Math.round(maxCandidates)))) {
      break;
    }
  }

  if (queue.length === 0 && sourceIsModeToggle) {
    pushUnique(
      pickDeterministicToggleContinuationCandidate({
        sourceCandidate,
        revealedCandidates
      })
    );
  }

  return queue.slice(0, Math.max(1, Math.min(8, Math.round(maxCandidates))));
};
