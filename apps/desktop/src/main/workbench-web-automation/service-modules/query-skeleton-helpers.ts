import type {
  WorkbenchWebFocusAtlas,
  WorkbenchWebNodeRef,
  WorkbenchWebQueryRequest,
  WorkbenchWebSkeletonNode,
  WorkbenchWebSkeletonReadResult,
  WorkbenchWebSkeletonRegion,
  WorkbenchWebTargetScanResult,
} from "../../../shared/workbench-web-automation";
import {
  inferCandidateSemanticRole,
  matchesRequestedRoles,
  matchesSemanticWithinScope,
} from "../query-semantics";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

const QUERY_ATTRACTOR_TTL_MS = 45_000;

export type QueryAttractorState = {
  readonly candidateSignature: string;
  readonly queryFingerprint: string;
  readonly repeatCount: number;
  readonly updatedAt: number;
};

export const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const normalizeOptionalText = (value: string | undefined): string | undefined => {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : undefined;
};

const buildQueryFingerprint = (request: WorkbenchWebQueryRequest | undefined): string => {
  if (request === undefined) {
    return "";
  }
  const roles = Array.isArray(request.role)
    ? request.role.map((role) => normalizeText(role)).filter((value) => value.length > 0).sort().join("|")
    : normalizeText(typeof request.role === "string" ? request.role : undefined);
  const parts = [
    roles,
    normalizeText(request.name),
    normalizeText(request.text),
    normalizeText(request.within),
    normalizeText(request.near),
    normalizeText(request.before),
    normalizeText(request.after),
    normalizeText(request.currentSubgoal),
    normalizeText(request.regionId),
    normalizeText(request.groupId),
    request.inDialog === true ? "dialog" : "",
    request.underMenu === true ? "menu" : "",
    request.inTableRow === true ? "table-row" : ""
  ];
  return parts.filter((value) => value.length > 0).join("::");
};

const hasTextualQuerySignal = (request: WorkbenchWebQueryRequest | undefined): boolean =>
  request !== undefined
  && (
    normalizeText(request.name).length > 0
    || normalizeText(request.text).length > 0
    || normalizeText(request.within).length > 0
    || normalizeText(request.near).length > 0
    || normalizeText(request.before).length > 0
    || normalizeText(request.after).length > 0
    || normalizeText(request.currentSubgoal).length > 0
  );

const queryCandidateSignature = (
  candidate: LiveSelectorScanCandidateRecord
): string =>
  [
    normalizeText(candidate.stableSignature.testId),
    normalizeText(candidate.stableSignature.id),
    normalizeText(candidate.stableSignature.ariaLabel),
    normalizeText(candidate.selectorAddress.path),
    normalizeText(candidate.widgetKind)
  ]
    .filter((value) => value.length > 0)
    .join("|");

export const applyQueryAttractorGuard = ({
  tabId,
  request,
  ranked,
  attractorStateByTab,
  now = Date.now(),
}: {
  readonly tabId: string;
  readonly request: WorkbenchWebQueryRequest | undefined;
  readonly ranked: readonly {
    readonly candidate: LiveSelectorScanCandidateRecord;
    readonly score: number;
  }[];
  readonly attractorStateByTab: Map<string, QueryAttractorState>;
  readonly now?: number;
}): readonly {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly score: number;
}[] => {
  const state = attractorStateByTab.get(tabId);
  if (state !== undefined && now - state.updatedAt > QUERY_ATTRACTOR_TTL_MS) {
    attractorStateByTab.delete(tabId);
  }

  if (ranked.length === 0) {
    attractorStateByTab.delete(tabId);
    return ranked;
  }

  const queryFingerprint = buildQueryFingerprint(request);
  const top = ranked[0]!;
  const topSignature = queryCandidateSignature(top.candidate);
  const hasSignal = hasTextualQuerySignal(request);
  const queryChanged = state !== undefined && state.queryFingerprint !== queryFingerprint;
  const repeatedTopAcrossDistinctQueries =
    hasSignal
    && queryChanged
    && state !== undefined
    && state.candidateSignature === topSignature
    && state.repeatCount >= 2;

  const nextRanked =
    repeatedTopAcrossDistinctQueries
      ? (() => {
          const filtered = ranked.filter((entry) => queryCandidateSignature(entry.candidate) !== topSignature);
          return filtered.length > 0 ? filtered : ranked;
        })()
      : ranked;

  const nextTop = nextRanked[0];
  if (nextTop === undefined) {
    attractorStateByTab.delete(tabId);
    return nextRanked;
  }
  const nextSignature = queryCandidateSignature(nextTop.candidate);
  const nextRepeatCount =
    state !== undefined && state.candidateSignature === nextSignature && state.queryFingerprint !== queryFingerprint
      ? state.repeatCount + 1
      : 1;
  attractorStateByTab.set(tabId, {
    candidateSignature: nextSignature,
    queryFingerprint,
    repeatCount: nextRepeatCount,
    updatedAt: now
  });
  return nextRanked;
};

const inferSkeletonRegionKind = (
  region: WorkbenchWebFocusAtlas["regions"][number]
): WorkbenchWebSkeletonRegion["kind"] => {
  switch (region.kind) {
    case "navigation":
      return "sidebar";
    case "history":
      return "list";
    case "workflow":
      return "content";
    case "composer":
      return "composer";
    case "toolbar":
      return "toolbar";
    case "menu":
      return "menu";
    case "panel":
      return "content";
    default:
      return "unknown";
  }
};

const isCheckableCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean =>
  candidate.interactable.selectable === true
  || normalizeText(candidate.role) === "checkbox"
  || normalizeText(candidate.role) === "radio"
  || normalizeText(candidate.inputType) === "checkbox"
  || normalizeText(candidate.inputType) === "radio";

const isExpandableCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean => {
  const affordance = normalizeText(candidate.affordanceAction);
  const stateHint = normalizeText(candidate.stateHint);
  return affordance === "expand"
    || affordance === "open menu"
    || stateHint === "collapsed"
    || stateHint === "expanded"
    || candidate.widgetKind === "menu-trigger"
    || candidate.widgetKind === "sidebar";
};

const isUploadCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean =>
  normalizeText(candidate.inputType) === "file"
  || normalizeText(candidate.affordanceAction) === "upload"
  || normalizeText(candidate.textSnippet).includes("upload")
  || normalizeText(candidate.ariaLabel).includes("upload");

const isDownloadCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean =>
  normalizeText(candidate.affordanceAction) === "download"
  || normalizeText(candidate.textSnippet).includes("download")
  || normalizeText(candidate.ariaLabel).includes("download");

const inferExpandedState = (candidate: LiveSelectorScanCandidateRecord): boolean | undefined => {
  const stateHint = normalizeText(candidate.stateHint);
  if (stateHint === "expanded") {
    return true;
  }
  if (stateHint === "collapsed") {
    return false;
  }
  return undefined;
};

const inferSelectedState = (candidate: LiveSelectorScanCandidateRecord): boolean | undefined => {
  const stateHint = normalizeText(candidate.stateHint);
  if (stateHint === "selected" || stateHint === "active" || stateHint === "on") {
    return true;
  }
  if (stateHint === "unselected" || stateHint === "inactive" || stateHint === "off") {
    return false;
  }
  return undefined;
};

export const buildNodeRef = ({
  candidate,
  revision,
  scanSessionId
}: {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly revision: string;
  readonly scanSessionId: string;
}): WorkbenchWebNodeRef => ({
  nodeId: candidate.candidateId,
  revision,
  scanSessionId,
  stableFingerprint: candidate.stableSignature
});

export const toSkeletonNode = ({
  candidate,
  revision,
  scanSessionId
}: {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly revision: string;
  readonly scanSessionId: string;
}): WorkbenchWebSkeletonNode => {
  const semanticRole = inferCandidateSemanticRole(candidate);

  return ({
    nodeRef: buildNodeRef({ candidate, revision, scanSessionId }),
    nodeId: candidate.candidateId,
    ...(semanticRole === undefined ? {} : { role: semanticRole }),
    ...(normalizeOptionalText(candidate.ariaLabel ?? candidate.itemIdentity?.label ?? candidate.affordanceLabel) === undefined
      ? {}
      : { name: normalizeOptionalText(candidate.ariaLabel ?? candidate.itemIdentity?.label ?? candidate.affordanceLabel) }),
    ...(normalizeOptionalText(candidate.textSnippet) === undefined ? {} : { text: normalizeOptionalText(candidate.textSnippet) }),
    ...(normalizeOptionalText(candidate.itemIdentity?.label ?? candidate.affordanceLabel ?? candidate.ariaLabel) === undefined
      ? {}
      : { label: normalizeOptionalText(candidate.itemIdentity?.label ?? candidate.affordanceLabel ?? candidate.ariaLabel) }),
    ...(normalizeOptionalText(candidate.placeholder) === undefined ? {} : { placeholder: normalizeOptionalText(candidate.placeholder) }),
    tag: candidate.tagName,
    selectorPreview: candidate.selectorPreview,
    capabilities: {
      clickable: candidate.interactable.clickable,
      editable: candidate.interactable.typable,
      selectable: candidate.interactable.selectable,
      checkable: isCheckableCandidate(candidate),
      expandable: isExpandableCandidate(candidate),
      uploadable: isUploadCandidate(candidate),
      downloadable: isDownloadCandidate(candidate),
      keyboardReachable: candidate.keyboardReachable !== false
    },
    state: {
      visible: candidate.visibilityState === "visible" || candidate.visibilityState === "nearby",
      enabled: candidate.disabled !== true,
      readonly: candidate.interactable.typable !== true,
      ...(inferSelectedState(candidate) === undefined ? {} : { selected: inferSelectedState(candidate) }),
      ...(inferExpandedState(candidate) === undefined ? {} : { expanded: inferExpandedState(candidate) })
    },
    ...(candidate.ownerWidgetId === undefined ? {} : { parentId: candidate.ownerWidgetId }),
    ...(candidate.ownerWidgetId === undefined && candidate.widgetId !== undefined
      ? { parentId: candidate.widgetId }
      : {}),
    ...(candidate.ownerWidgetId === undefined && candidate.widgetId === undefined
      ? {}
      : { groupId: candidate.ownerWidgetId ?? candidate.widgetId }),
    ...(candidate.focusRegionId === undefined ? {} : { regionId: candidate.focusRegionId }),
    ...(candidate.widgetKind === "form" || candidate.widgetKind === "login-form"
      ? { formOwner: candidate.widgetId ?? candidate.ownerWidgetId }
      : {}),
    stableFingerprint: candidate.stableSignature,
    revision,
    rect: candidate.bounds,
    semanticallyActionable: candidate.isHumanOperable !== false,
    actuallyVisible: candidate.visibilityState === "visible",
    hitTestPassed: candidate.visibilityState === "visible" && candidate.disabled !== true,
    interactableNow:
      candidate.visibilityState === "visible"
      && candidate.disabled !== true
      && (candidate.interactable.clickable
        || candidate.interactable.typable
        || candidate.interactable.focusable
        || candidate.interactable.selectable),
    ...(candidate.widgetId === undefined ? {} : { widgetId: candidate.widgetId }),
    ...(candidate.widgetKind === undefined ? {} : { widgetKind: candidate.widgetKind }),
    ...(candidate.ownerWidgetId === undefined ? {} : { ownerWidgetId: candidate.ownerWidgetId }),
    ...(candidate.focusOrder === undefined ? {} : { focusOrder: candidate.focusOrder }),
    ...(candidate.humanOperableScore === undefined ? {} : { humanOperableScore: candidate.humanOperableScore }),
    ...(candidate.withinCurrentWorkflow === undefined ? {} : { withinCurrentWorkflow: candidate.withinCurrentWorkflow })
  });
};

export const buildSkeletonRegions = ({
  atlas,
  revision
}: {
  readonly atlas: WorkbenchWebFocusAtlas;
  readonly revision: string;
}): readonly WorkbenchWebSkeletonRegion[] =>
  atlas.regions.map((region) => ({
    regionId: region.regionId,
    kind: inferSkeletonRegionKind(region),
    label: region.label,
    bounds: region.bounds,
    nodeIds: region.nodeIds,
    ...(region.primaryControlId === undefined ? {} : { primaryNodeId: region.primaryControlId }),
    widgetIds: region.widgetIds,
    revision,
    ...(region.confidence === undefined ? {} : { confidence: region.confidence })
  }));

const buildSkeletonNodes = ({
  candidates,
  revision,
  scanSessionId
}: {
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly revision: string;
  readonly scanSessionId: string;
}): readonly WorkbenchWebSkeletonNode[] =>
  candidates.map((candidate) => toSkeletonNode({ candidate, revision, scanSessionId }));

export const buildSkeletonReadResult = ({
  tabId,
  scanResult,
  atlas,
}: {
  readonly tabId: string;
  readonly scanResult: WorkbenchWebTargetScanResult;
  readonly atlas: WorkbenchWebFocusAtlas;
}): WorkbenchWebSkeletonReadResult => {
  const revision = atlas.version;
  const nodes = buildSkeletonNodes({
    candidates: scanResult.candidates as readonly LiveSelectorScanCandidateRecord[],
    revision,
    scanSessionId: scanResult.scanSessionId
  });
  const bestNode = scanResult.bestCandidate === undefined
    ? undefined
    : toSkeletonNode({
        candidate: scanResult.bestCandidate as LiveSelectorScanCandidateRecord,
        revision,
        scanSessionId: scanResult.scanSessionId
      });

  return {
    tabId,
    scanSessionId: scanResult.scanSessionId,
    pageMode: scanResult.pageMode,
    skeletonVersion: revision,
    ...(atlas.activeFocusRegionId === undefined ? {} : { activeRegionId: atlas.activeFocusRegionId }),
    regions: buildSkeletonRegions({ atlas, revision }),
    nodes,
    ...(bestNode === undefined ? {} : { bestNode }),
    intervention: {
      mode: "none",
      label: "Lyra analyzed the page without taking control",
      detail: "read-only skeleton analysis"
    },
    diagnostics: {
      durationMs: scanResult.diagnostics.durationMs,
      candidateCount: nodes.length,
      regionCount: atlas.regions.length,
      scannedFrames: scanResult.diagnostics.scannedFrames,
      scannedCandidates: scanResult.diagnostics.scannedCandidates,
      expanded: scanResult.diagnostics.expanded,
      scrolled: scanResult.diagnostics.scrolled
    }
  };
};

const matchesStateFilter = (
  candidate: LiveSelectorScanCandidateRecord,
  state: NonNullable<WorkbenchWebQueryRequest["state"]>
): boolean => {
  const expanded = inferExpandedState(candidate);
  const selected = inferSelectedState(candidate);
  const actual = {
    checked: undefined,
    selected,
    expanded,
    disabled: candidate.disabled === true,
    invalid: normalizeText(candidate.stateHint).includes("invalid"),
    required: normalizeText(candidate.stateHint).includes("required"),
    readonly: candidate.interactable.typable !== true,
    visible: candidate.visibilityState === "visible" || candidate.visibilityState === "nearby"
  };
  return Object.entries(state).every(([key, expected]) => {
    if (typeof expected !== "boolean") {
      return true;
    }
    return (actual as Record<string, boolean | undefined>)[key] === expected;
  });
};

export const queryTextHaystack = (candidate: LiveSelectorScanCandidateRecord): readonly string[] =>
  [
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
    candidate.stableSignature.name,
    candidate.stableSignature.id,
    candidate.stableSignature.ariaLabel
  ]
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);

const queryMatchesText = (
  candidate: LiveSelectorScanCandidateRecord,
  needle: string | undefined
): boolean => {
  const normalizedNeedle = normalizeText(needle);
  if (normalizedNeedle.length === 0) {
    return true;
  }
  return queryTextHaystack(candidate).some((entry) => entry.includes(normalizedNeedle));
};

export const buildRegionKindById = (
  atlas: WorkbenchWebFocusAtlas
): ReadonlyMap<string, WorkbenchWebSkeletonRegion["kind"]> =>
  new Map(atlas.regions.map((region) => [region.regionId, inferSkeletonRegionKind(region)]));

const matchesQueryWithin = ({
  candidate,
  within,
  regionKindById
}: {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly within: string | undefined;
  readonly regionKindById: ReadonlyMap<string, WorkbenchWebSkeletonRegion["kind"]> | undefined;
}): boolean => {
  const semanticMatch = matchesSemanticWithinScope(
    regionKindById === undefined
      ? {
          candidate,
          within
        }
      : {
          candidate,
          within,
          regionKindById
        }
  );
  if (semanticMatch !== null) {
    return semanticMatch;
  }
  return queryMatchesText(candidate, within);
};

export const queryScoreCandidate = ({
  candidate,
  request,
  regionKindById
}: {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly request: WorkbenchWebQueryRequest;
  readonly regionKindById: ReadonlyMap<string, WorkbenchWebSkeletonRegion["kind"]> | undefined;
}): number => {
  let score = candidate.humanOperableScore ?? candidate.score ?? 0;
  const roles = Array.isArray(request.role) ? request.role : request.role === undefined ? [] : [request.role];
  if (roles.length > 0) {
    const roleMatched = matchesRequestedRoles(candidate, roles);
    score += roleMatched ? 24 : -28;
  }
  if (request.regionId !== undefined) {
    score += candidate.focusRegionId === request.regionId ? 30 : -24;
  }
  if (request.groupId !== undefined) {
    score += (candidate.ownerWidgetId === request.groupId || candidate.widgetId === request.groupId) ? 20 : -18;
  }
  if (request.state !== undefined && !matchesStateFilter(candidate, request.state)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (!queryMatchesText(candidate, request.name)) {
    score -= 18;
  } else if (normalizeText(request.name).length > 0) {
    score += 18;
  }
  if (!queryMatchesText(candidate, request.text)) {
    score -= 18;
  } else if (normalizeText(request.text).length > 0) {
    score += 18;
  }
  if (!matchesQueryWithin({
    candidate,
    within: request.within,
    regionKindById
  })) {
    score -= normalizeText(request.within).length > 0 ? 8 : 0;
  } else if (normalizeText(request.within).length > 0) {
    score += 10;
  }
  if (!queryMatchesText(candidate, request.near)) {
    score -= normalizeText(request.near).length > 0 ? 6 : 0;
  } else if (normalizeText(request.near).length > 0) {
    score += 8;
  }
  if (request.underMenu === true) {
    score += candidate.widgetKind === "menu" || candidate.widgetKind === "menu-panel" || candidate.widgetKind === "menu-trigger"
      ? 12
      : -10;
  }
  if (request.inDialog === true) {
    score += candidate.widgetKind === "dialog" ? 12 : -10;
  }
  if (request.inTableRow === true) {
    score += candidate.widgetKind === "list-item" ? 8 : -6;
  }
  return score;
};

export const candidateSatisfiesQuery = ({
  candidate,
  request,
  regionKindById
}: {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly request: WorkbenchWebQueryRequest;
  readonly regionKindById: ReadonlyMap<string, WorkbenchWebSkeletonRegion["kind"]> | undefined;
}): boolean => {
  const roles = Array.isArray(request.role) ? request.role : request.role === undefined ? [] : [request.role];
  if (roles.length > 0) {
    const roleMatched = matchesRequestedRoles(candidate, roles);
    if (!roleMatched) {
      return false;
    }
  }
  if (request.regionId !== undefined && candidate.focusRegionId !== request.regionId) {
    return false;
  }
  if (
    request.groupId !== undefined
    && candidate.ownerWidgetId !== request.groupId
    && candidate.widgetId !== request.groupId
  ) {
    return false;
  }
  if (request.state !== undefined && !matchesStateFilter(candidate, request.state)) {
    return false;
  }
  if (!queryMatchesText(candidate, request.name)) {
    return false;
  }
  if (!queryMatchesText(candidate, request.text)) {
    return false;
  }
  if (!matchesQueryWithin({
    candidate,
    within: request.within,
    regionKindById
  })) {
    return false;
  }
  if (request.underMenu === true) {
    const underMenu =
      candidate.widgetKind === "menu" || candidate.widgetKind === "menu-panel" || candidate.widgetKind === "menu-trigger";
    if (!underMenu) {
      return false;
    }
  }
  if (request.inDialog === true && candidate.widgetKind !== "dialog") {
    return false;
  }
  if (request.inTableRow === true && candidate.widgetKind !== "list-item") {
    return false;
  }
  return true;
};

export const matchesStableSignature = (
  candidate: LiveSelectorScanCandidateRecord,
  signature: Record<string, unknown>
): boolean => {
  const pairs: readonly (readonly [keyof typeof candidate.stableSignature, unknown])[] = [
    ["tagName", signature.tagName],
    ["role", signature.role],
    ["inputType", signature.inputType],
    ["id", signature.id],
    ["name", signature.name],
    ["testId", signature.testId],
    ["ariaLabel", signature.ariaLabel],
    ["textHash", signature.textHash],
    ["structureHash", signature.structureHash]
  ];
  return pairs.every(([key, value]) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return true;
    }
    return candidate.stableSignature[key] === value;
  });
};
