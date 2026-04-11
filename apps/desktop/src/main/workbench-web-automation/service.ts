import { randomUUID } from "node:crypto";

import type {
  WorkbenchWebAction,
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
  WorkbenchWebElementNode,
  WorkbenchWebGraphBuildRequest,
  WorkbenchWebGraphBuildResult,
  WorkbenchWebGraphQueryRequest,
  WorkbenchWebGraphQueryResult,
  WorkbenchWebTargetCandidate,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanRequest,
  WorkbenchWebTargetScanResult,
  WorkbenchWebWaitRequest,
  WorkbenchWebWaitResult
} from "../../shared/workbench-web-automation";
import { WorkbenchWebAutomationCache } from "./cache";
import { executeWebAction, waitForTarget } from "./action-executor";
import { WorkbenchAgentWebSessionRegistry } from "./agent-session/registry";
import { createWebAutomationError } from "./diagnostics";
import { buildWebGraphSnapshot } from "./graph-builder";
import { buildGraphHighlights, rankNodesForAction, toNodeHint } from "./result-highlights";
import { WorkbenchWebAutomationStore } from "./store";
import {
  clearAgentSelectorTarget,
  showAgentSelectorTarget,
  toBrowserAgentTargetInfo,
} from "./live-selector/agent-visualization";
import { rankLiveSelectorCandidates } from "./live-selector/candidate-ranker";
import { decodeLiveSelectorContinuationToken, encodeLiveSelectorContinuationToken } from "./live-selector/continuation-token";
import { nextLiveSelectorScope } from "./live-selector/expansion";
import { LiveSelectorScanRegistry } from "./live-selector/scan-session";
import { buildLiveSelectorScanScript, buildLiveSelectorScrollScript } from "./live-selector/scan-script";
import type {
  LiveSelectorFrameScanCandidate,
  LiveSelectorFrameScanResult,
  LiveSelectorScanCandidateRecord,
  LiveSelectorScanSession,
} from "./live-selector/types";
import type {
  WorkbenchWebAutomationCallContext,
  WorkbenchWebAutomationService,
  WorkbenchWebAutomationServiceDeps,
  WorkbenchWebGraphSnapshot
} from "./types";

const SAFE_ACTIONS = new Set(["focus", "hover", "scroll_into_view", "expand_probe"]);
const MUTATE_ACTIONS = new Set([
  "click",
  "type",
  "clear_and_type",
  "select_option",
  "set_checked",
  "submit_form",
  "press_key"
]);
const NAVIGATE_ACTIONS = new Set([
  "goto_url",
  "open_link_node",
  "history_back",
  "history_forward",
  "reload"
]);

const VISIBLE_SCAN_MAX = 64;
const NEARBY_SCAN_MAX = 160;
const EXPANDED_SCAN_MAX = 160;
const MAX_EXPANDED_SCROLL_STEPS = 3;

const buildResultFromSnapshot = (
  snapshot: WorkbenchWebGraphSnapshot & { readonly budget: WorkbenchWebGraphBuildResult["budget"] },
  detail: "summary" | "full"
): WorkbenchWebGraphBuildResult => ({
  tabId: snapshot.tabId,
  graphId: snapshot.graphId,
  ...(snapshot.address === undefined ? {} : { address: snapshot.address }),
  builtAt: snapshot.builtAt,
  budget: snapshot.budget,
  nodeCount: snapshot.nodeCount,
  edgeCount: snapshot.edgeCount,
  interactableCount: snapshot.interactableCount,
  truncated: snapshot.truncated,
  budgetExhausted: snapshot.budgetExhausted,
  detail,
  highlights: buildGraphHighlights(snapshot.nodes),
  ...(detail === "full"
    ? {
        nodes: snapshot.nodes,
        edges: snapshot.edges
      }
    : {})
});

const isFullGraphSnapshot = (snapshot: WorkbenchWebGraphSnapshot): boolean =>
  snapshot.nodeCount > 0 && snapshot.nodes.length === snapshot.nodeCount;

const ensureGraphLoaded = async ({
  tabId,
  graphId,
  forceBuild,
  deps,
  cache,
  store
}: {
  readonly tabId: string;
  readonly graphId?: string | undefined;
  readonly forceBuild?: boolean | undefined;
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly cache: WorkbenchWebAutomationCache;
  readonly store: WorkbenchWebAutomationStore;
}): Promise<WorkbenchWebGraphSnapshot> => {
  if (forceBuild !== true && typeof graphId === "string" && graphId.trim().length > 0) {
    const fromCache = cache.graphById.read(graphId.trim());
    if (fromCache !== null) {
      return fromCache;
    }
    const fromStore = await store.readByGraphId(graphId.trim());
    if (fromStore !== null) {
      cache.graphById.write(fromStore.graphId, fromStore);
      cache.graphByTab.write(fromStore.tabId, fromStore);
      return fromStore;
    }
  }

  if (forceBuild !== true) {
    const fromCache = cache.graphByTab.read(tabId);
    if (fromCache !== null && isFullGraphSnapshot(fromCache)) {
      return fromCache;
    }
    const fromStore = await store.readLatestByTab(tabId);
    if (fromStore !== null && isFullGraphSnapshot(fromStore)) {
      cache.graphById.write(fromStore.graphId, fromStore);
      cache.graphByTab.write(tabId, fromStore);
      return fromStore;
    }
  }

  const fresh = await buildWebGraphSnapshot({
    browserBridge: deps.browserBridge,
    request: {
      tabId,
      detail: "full"
    }
  });

  const snapshot: WorkbenchWebGraphSnapshot = {
    tabId: fresh.tabId,
    graphId: fresh.graphId,
    ...(fresh.address === undefined ? {} : { address: fresh.address }),
    builtAt: fresh.builtAt,
    nodeCount: fresh.nodeCount,
    edgeCount: fresh.edgeCount,
    interactableCount: fresh.interactableCount,
    truncated: fresh.truncated,
    budgetExhausted: fresh.budgetExhausted,
    nodes: fresh.nodes,
    edges: fresh.edges
  };

  cache.graphById.write(snapshot.graphId, snapshot);
  cache.graphByTab.write(snapshot.tabId, snapshot);
  await store.write(snapshot);

  return snapshot;
};

const resolveTabId = (
  deps: WorkbenchWebAutomationServiceDeps,
  requestedTabId?: string
): string => {
  if (typeof requestedTabId === "string" && requestedTabId.trim().length > 0) {
    return requestedTabId.trim();
  }
  const active = deps.browserBridge.readActiveTabId();
  if (active === null || active.length === 0) {
    throw createWebAutomationError(
      "tab_not_found",
      "active page tab not found",
      "precondition",
      true
    );
  }
  return active;
};

const assertActiveVisiblePage = (
  deps: WorkbenchWebAutomationServiceDeps,
  tabId: string
): void => {
  const activeTabId = deps.browserBridge.readActiveTabId();
  const state = deps.browserBridge.readPageState({ tabId });
  if (state === null || activeTabId !== tabId || state.isVisible !== true) {
    throw createWebAutomationError(
      "active_visible_page_required",
      "web automation requires the active visible page tab",
      "precondition",
      true,
      {
        details: {
          activeTabId,
          requestedTabId: tabId,
          isVisible: state?.isVisible ?? false
        }
      }
    );
  }
};

const toActionIntent = (
  action: WorkbenchWebAction,
  seed?: {
    readonly tagName?: string;
    readonly role?: string;
    readonly ariaLabel?: string;
    readonly placeholder?: string;
    readonly textSnippet?: string;
    readonly selectorPreview?: string;
  }
): WorkbenchWebTargetIntent => {
  const textHints = [
    seed?.ariaLabel,
    seed?.textSnippet,
    seed?.selectorPreview,
    seed?.role
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const placeholderHints = [seed?.placeholder].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  switch (action.kind) {
    case "type":
    case "clear_and_type":
      return {
        operation: "type",
        desiredTags: [seed?.tagName ?? "textarea", "input"],
        desiredRoles: [seed?.role ?? "textbox", "searchbox", "combobox"],
        textHints,
        placeholderHints,
        allowContentEditable: true
      };
    case "select_option":
      return {
        operation: "select",
        desiredTags: [seed?.tagName ?? "select"],
        desiredRoles: [seed?.role ?? "combobox", "listbox"],
        textHints,
        placeholderHints
      };
    case "focus":
    case "press_key":
      return {
        operation: "focus",
        desiredTags: [seed?.tagName ?? "textarea", "input", "button"],
        desiredRoles: [seed?.role ?? "textbox", "button"],
        textHints,
        placeholderHints,
        allowContentEditable: true
      };
    case "submit_form":
      return {
        operation: "submit",
        desiredTags: [seed?.tagName ?? "button", "form"],
        desiredRoles: [seed?.role ?? "button"],
        textHints,
        placeholderHints
      };
    default:
      return {
        operation: "click",
        desiredTags: [seed?.tagName ?? "button", "a"],
        desiredRoles: [seed?.role ?? "button", "link", "menuitem", "tab"],
        textHints,
        placeholderHints
      };
  }
};

const queryGraphSnapshot = ({
  snapshot,
  request
}: {
  readonly snapshot: WorkbenchWebGraphSnapshot;
  readonly request?: WorkbenchWebGraphQueryRequest | undefined;
}): WorkbenchWebGraphQueryResult => {
  const textNeedle = typeof request?.textContains === "string" ? request.textContains.trim().toLowerCase() : "";
  const tagNameNeedle = typeof request?.tagName === "string" ? request.tagName.trim().toLowerCase() : "";
  const roleNeedle = typeof request?.role === "string" ? request.role.trim().toLowerCase() : "";
  const onlyInteractable = request?.onlyInteractable === true;
  const actionNeedle = request?.action;
  const maxResults = Math.max(1, Math.min(1_000, Math.round(request?.maxResults ?? 200)));

  const matches = snapshot.nodes.filter((node) => {
    if (tagNameNeedle.length > 0 && node.tagName.toLowerCase() !== tagNameNeedle) {
      return false;
    }
    if (roleNeedle.length > 0 && (node.role ?? "").toLowerCase() !== roleNeedle) {
      return false;
    }
    if (textNeedle.length > 0) {
      const haystacks = [
        node.textSnippet ?? "",
        node.stableSignature.ariaLabel ?? "",
        node.stableSignature.name ?? "",
        node.stableSignature.id ?? ""
      ].map((value) => value.toLowerCase());
      if (haystacks.some((value) => value.includes(textNeedle)) === false) {
        return false;
      }
    }

    const interactable =
      node.interactable.clickable
      || node.interactable.typable
      || node.interactable.selectable
      || node.interactable.focusable
      || node.interactable.scrollable;

    if (onlyInteractable && !interactable) {
      return false;
    }

    if (actionNeedle === undefined) {
      return true;
    }

    if (actionNeedle === "click") {
      return node.interactable.clickable;
    }
    if (actionNeedle === "type") {
      return node.interactable.typable;
    }
    if (actionNeedle === "select") {
      return node.interactable.selectable;
    }
    if (actionNeedle === "focus") {
      return node.interactable.focusable;
    }
    if (actionNeedle === "scroll") {
      return node.interactable.scrollable;
    }
    if (actionNeedle === "submit") {
      return node.tagName === "form" || node.tagName === "button";
    }

    return true;
  });

  const sortedMatches = (() => {
    if (actionNeedle === "type") {
      return rankNodesForAction(matches, "type", textNeedle);
    }
    if (actionNeedle === "click") {
      return rankNodesForAction(matches, "click", textNeedle);
    }
    if (actionNeedle === "focus") {
      return rankNodesForAction(matches, "focus", textNeedle);
    }
    return matches;
  })().slice(0, maxResults);

  const nodeIds = new Set(sortedMatches.map((node) => node.nodeId));
  const edges = snapshot.edges.filter((edge) =>
    nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId)
  );

  return {
    tabId: snapshot.tabId,
    graphId: snapshot.graphId,
    totalMatched: matches.length,
    ...(sortedMatches[0] === undefined ? {} : { bestNode: toNodeHint(sortedMatches[0]) }),
    nodes: sortedMatches,
    edges
  };
};

const assertActionAllowed = (
  request: WorkbenchWebActionRequest,
  mode: "safe" | "mutate" | "navigate"
): void => {
  const kind = request.action.kind;
  if (mode === "safe" && SAFE_ACTIONS.has(kind)) {
    return;
  }
  if (mode === "mutate" && MUTATE_ACTIONS.has(kind)) {
    return;
  }
  if (mode === "navigate" && NAVIGATE_ACTIONS.has(kind)) {
    return;
  }
  throw createWebAutomationError(
    "action_blocked_by_policy",
    `action ${kind} is not allowed in ${mode} mode`,
    "precondition",
    false
  );
};

const invalidateTabGraphCache = (
  cache: WorkbenchWebAutomationCache,
  tabId: string,
  graphId?: string
): void => {
  cache.graphByTab.remove(tabId);
  if (typeof graphId === "string") {
    cache.graphById.remove(graphId);
  }
};

const sameOriginFrames = (
  deps: WorkbenchWebAutomationServiceDeps,
  tabId: string
): readonly { readonly frameTreeNodeId: number; readonly url: string; readonly isMainFrame: boolean }[] => {
  const frames = deps.browserBridge.listFrames(tabId);
  const mainFrame = frames.find((frame) => frame.isMainFrame) ?? null;
  const mainOrigin = mainFrame?.origin ?? null;
  return frames
    .filter((frame) => frame.isMainFrame || (mainOrigin !== null && frame.origin === mainOrigin))
    .map((frame) => ({
      frameTreeNodeId: frame.frameTreeNodeId,
      url: frame.url,
      isMainFrame: frame.isMainFrame
    }));
};

const toCandidateRecord = (
  tabId: string,
  frameUrl: string,
  candidate: LiveSelectorFrameScanCandidate
): LiveSelectorScanCandidateRecord => ({
  candidateId: randomUUID(),
  frameTreeNodeId: candidate.selectorAddress.frameTreeNodeId,
  tagName: candidate.tagName,
  selectorPreview: candidate.selectorPreview,
  visibilityState: candidate.visibilityState,
  interactable: candidate.interactable,
  bounds: candidate.bounds,
  score: 0,
  selectorAddress: candidate.selectorAddress,
  stableSignature: candidate.stableSignature,
  ...(candidate.role === undefined ? {} : { role: candidate.role }),
  ...(candidate.inputType === undefined ? {} : { inputType: candidate.inputType }),
  ...(candidate.textSnippet === undefined ? {} : { textSnippet: candidate.textSnippet }),
  ...(candidate.ariaLabel === undefined ? {} : { ariaLabel: candidate.ariaLabel }),
  ...(candidate.placeholder === undefined ? {} : { placeholder: candidate.placeholder }),
  ...(candidate.disabled === undefined ? {} : { disabled: candidate.disabled }),
  ...(frameUrl.length === 0 ? {} : { frameUrl }),
});

const scanScopeOnce = async ({
  deps,
  tabId,
  intent,
  scope,
  maxCandidates,
  scrollStep
}: {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly intent: WorkbenchWebTargetIntent;
  readonly scope: "visible" | "nearby" | "expanded";
  readonly maxCandidates: number;
  readonly scrollStep?: number;
}): Promise<{
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly scannedFrames: number;
  readonly scannedCandidates: number;
  readonly scrolled: boolean;
}> => {
  const frames = sameOriginFrames(deps, tabId);
  if (scope === "expanded" && typeof scrollStep === "number" && scrollStep > 0) {
    const mainFrame = frames.find((frame) => frame.isMainFrame);
    if (mainFrame !== undefined) {
      await deps.browserBridge.executeFrameScript(tabId, {
        frameTreeNodeId: mainFrame.frameTreeNodeId,
        script: buildLiveSelectorScrollScript(),
        userGesture: false
      }).catch(() => undefined);
    }
  }

  const collected: LiveSelectorScanCandidateRecord[] = [];
  let scannedCandidates = 0;
  for (const frame of frames.slice(0, 24)) {
    const raw = await deps.browserBridge.executeFrameScript(tabId, {
      frameTreeNodeId: frame.frameTreeNodeId,
      script: buildLiveSelectorScanScript({
        frameTreeNodeId: frame.frameTreeNodeId,
        intent,
        scope,
        maxCandidates
      }),
      userGesture: false
    }).catch(() => null) as LiveSelectorFrameScanResult | null;
    if (raw === null || !Array.isArray(raw.candidates)) {
      continue;
    }
    scannedCandidates += raw.candidates.length;
    for (const candidate of raw.candidates) {
      collected.push(toCandidateRecord(tabId, frame.url, candidate));
    }
  }

  const ranked = rankLiveSelectorCandidates(collected, intent).slice(0, maxCandidates);
  return {
    candidates: ranked,
    scannedFrames: frames.length,
    scannedCandidates,
    scrolled: scope === "expanded" && typeof scrollStep === "number" && scrollStep > 0
  };
};

const runLiveSelectorScan = async ({
  deps,
  tabId,
  request,
  registry,
  context,
  agentSessions
}: {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly request: WorkbenchWebTargetScanRequest;
  readonly registry: LiveSelectorScanRegistry;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
}): Promise<WorkbenchWebTargetScanResult> => {
  const requestedScope = request.scope ?? "visible";
  const perScopeMax =
    requestedScope === "visible"
      ? VISIBLE_SCAN_MAX
      : requestedScope === "nearby"
        ? NEARBY_SCAN_MAX
        : EXPANDED_SCAN_MAX;
  const requestedRawMax = Math.round(
    request.maxCandidates ?? (requestedScope === "visible" ? VISIBLE_SCAN_MAX : NEARBY_SCAN_MAX)
  );
  const intentMinCandidates =
    request.intent.operation === "type"
      ? 32
      : request.intent.operation === "click" || request.intent.operation === "submit"
        ? 24
        : 12;
  const requestedMaxCandidates = Math.max(
    1,
    Math.min(perScopeMax, Math.max(intentMinCandidates, requestedRawMax))
  );
  const continuation = decodeLiveSelectorContinuationToken(request.continuationToken);
  let scope = continuation?.scope ?? requestedScope;
  const startedAt = Date.now();
  let expanded = false;
  let scrolled = false;
  let scannedFrames = 0;
  let scannedCandidates = 0;
  let ranked: readonly LiveSelectorScanCandidateRecord[] = [];

  while (true) {
    if (scope === "expanded") {
      for (let step = 0; step <= MAX_EXPANDED_SCROLL_STEPS; step += 1) {
        const result = await scanScopeOnce({
          deps,
          tabId,
          intent: request.intent,
          scope,
          maxCandidates: EXPANDED_SCAN_MAX,
          scrollStep: step
        });
        ranked = result.candidates;
        scannedFrames = Math.max(scannedFrames, result.scannedFrames);
        scannedCandidates += result.scannedCandidates;
        scrolled = scrolled || result.scrolled;
        expanded = true;
        if (ranked.length > 0) {
          break;
        }
      }
    } else {
      const result = await scanScopeOnce({
        deps,
        tabId,
        intent: request.intent,
        scope,
        maxCandidates: requestedMaxCandidates
      });
      ranked = result.candidates;
      scannedFrames = Math.max(scannedFrames, result.scannedFrames);
      scannedCandidates += result.scannedCandidates;
    }

    if (ranked.length > 0 || request.scope !== undefined) {
      break;
    }
    const nextScope = nextLiveSelectorScope(scope);
    if (nextScope === null) {
      break;
    }
    scope = nextScope;
  }

  if (ranked.length === 0) {
    throw createWebAutomationError(
      "no_interactable_candidates",
      "no interactable candidates found in the visible page",
      "scan",
      true,
      {
        candidateCount: 0,
        details: {
          scope,
          scannedFrames,
          scannedCandidates
        }
      }
    );
  }

  const offset = continuation?.offset ?? 0;
  const visibleCandidates = ranked.slice(offset, offset + requestedMaxCandidates);
  const nextOffset = offset + visibleCandidates.length;
  const scanSession = registry.write({
    tabId,
    scope,
    intent: request.intent,
    candidates: ranked
  });

  if (context?.agentSessionId && context?.agentTurnId) {
    agentSessions.upsert({
      agentSessionId: context.agentSessionId,
      agentTurnId: context.agentTurnId,
      tabId,
      scanSessionId: scanSession.scanSessionId
    });
  }

  const bestCandidate = visibleCandidates[0];
  if (bestCandidate !== undefined && context?.toolCallId) {
    await showAgentSelectorTarget(
      deps.browserBridge,
      toBrowserAgentTargetInfo({
        tabId,
        toolCallId: context.toolCallId,
        owner: "agent_scan",
        phase: "scan",
        candidate: bestCandidate
      })
    ).catch(() => false);
  }

  return {
    tabId,
    scanSessionId: scanSession.scanSessionId,
    scope,
    ...(bestCandidate === undefined ? {} : { bestCandidate }),
    candidates: visibleCandidates,
    truncated: nextOffset < ranked.length,
    ...(nextOffset < ranked.length
      ? { continuationToken: encodeLiveSelectorContinuationToken({ scope, offset: nextOffset }) }
      : {}),
    diagnostics: {
      scannedFrames,
      scannedCandidates,
      expanded,
      scrolled,
      durationMs: Date.now() - startedAt
    }
  };
};

const candidateToNode = (candidate: LiveSelectorScanCandidateRecord): WorkbenchWebElementNode => ({
  nodeId: candidate.candidateId,
  frameTreeNodeId: candidate.frameTreeNodeId,
  tagName: candidate.tagName,
  ...(candidate.role === undefined ? {} : { role: candidate.role }),
  ...(candidate.inputType === undefined ? {} : { inputType: candidate.inputType }),
  selectorAddress: candidate.selectorAddress,
  stableSignature: candidate.stableSignature,
  interactable: {
    ...candidate.interactable,
    scrollable: false
  },
  visibilityState: candidate.visibilityState === "nearby" ? "offscreen" : candidate.visibilityState,
  bounds: candidate.bounds,
  ...(candidate.textSnippet === undefined ? {} : { textSnippet: candidate.textSnippet }),
  ...(candidate.disabled === undefined ? {} : { disabled: candidate.disabled }),
  ...(candidate.frameUrl === undefined ? {} : { frameUrl: candidate.frameUrl }),
});

const syntheticGraphFromCandidate = (
  tabId: string,
  scanSessionId: string,
  candidate: LiveSelectorScanCandidateRecord
): WorkbenchWebGraphSnapshot => ({
  tabId,
  graphId: `scan:${scanSessionId}`,
  builtAt: Date.now(),
  nodeCount: 1,
  edgeCount: 0,
  interactableCount: 1,
  truncated: false,
  budgetExhausted: false,
  nodes: [candidateToNode(candidate)],
  edges: []
});

const resolveCandidateReference = async ({
  target,
  intent,
  scanRegistry,
  deps,
  tabId,
  context,
  agentSessions
}: {
  readonly target: Record<string, unknown> | undefined;
  readonly intent: WorkbenchWebTargetIntent;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
}): Promise<{
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
}> => {
  const scanSessionId = typeof target?.scanSessionId === "string" ? target.scanSessionId : null;
  const candidateId = typeof target?.candidateId === "string" ? target.candidateId : null;
  if (candidateId === null) {
    throw createWebAutomationError(
      "candidate_not_found",
      "candidate-based target is missing candidateId",
      "resolve_node",
      true
    );
  }

  if (scanSessionId !== null) {
    const candidate = scanRegistry.readCandidate(scanSessionId, candidateId);
    if (candidate !== null) {
      return { scanSessionId, candidate };
    }
  }

  if (context?.agentSessionId && context.agentTurnId) {
    const agentSession = agentSessions.read(context.agentSessionId, context.agentTurnId, tabId);
    if (agentSession?.scanSessionId) {
      const candidate = scanRegistry.readCandidate(agentSession.scanSessionId, candidateId);
      if (candidate !== null) {
        return {
          scanSessionId: agentSession.scanSessionId,
          candidate
        };
      }
    }
  }

  const recentCandidate = scanRegistry.readRecentCandidate(candidateId, {
    tabId,
    ...(scanSessionId === null ? {} : { preferredScanSessionId: scanSessionId })
  });
  if (recentCandidate !== null) {
    return recentCandidate;
  }

  const rescanned = await runLiveSelectorScan({
    deps,
    tabId,
    request: {
      tabId,
      intent,
      scope: "nearby",
      maxCandidates: NEARBY_SCAN_MAX
    },
    registry: scanRegistry,
    ...(context === undefined ? {} : { context }),
    agentSessions
  });
  if (rescanned.bestCandidate === undefined) {
    throw createWebAutomationError(
      "candidate_not_found",
      "candidate target could not be relocated",
      "resolve_node",
      true
    );
  }
  const relocated = scanRegistry.readCandidate(rescanned.scanSessionId, rescanned.bestCandidate.candidateId);
  if (relocated === null) {
    throw createWebAutomationError(
      "candidate_stale",
      "candidate target became stale during relocation",
      "resolve_node",
      true
    );
  }
  return {
    scanSessionId: rescanned.scanSessionId,
    candidate: relocated
  };
};

const resolveCandidateFromAction = async ({
  request,
  scanRegistry,
  deps,
  tabId,
  context,
  agentSessions
}: {
  readonly request: WorkbenchWebActionRequest;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
}): Promise<{
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
}> =>
  resolveCandidateReference({
    target: (request.action as { readonly target?: Record<string, unknown> }).target,
    intent: toActionIntent(request.action),
    scanRegistry,
    deps,
    tabId,
    ...(context === undefined ? {} : { context }),
    agentSessions
  });

export const createWorkbenchWebAutomationService = (
  deps: WorkbenchWebAutomationServiceDeps
): WorkbenchWebAutomationService => {
  const cache = new WorkbenchWebAutomationCache();
  const store = new WorkbenchWebAutomationStore(deps.storageRoot);
  const scanRegistry = new LiveSelectorScanRegistry();
  const agentSessions = new WorkbenchAgentWebSessionRegistry();

  void store.compact().catch(() => undefined);

  return {
    dispose: () => {
      cache.clear();
    },

    buildGraph: async (request?: WorkbenchWebGraphBuildRequest) => {
      const detail = request?.detail === "full" ? "full" : "summary";
      const snapshot = await buildWebGraphSnapshot({
        browserBridge: deps.browserBridge,
        request
      });

      const normalizedSnapshot: WorkbenchWebGraphSnapshot = {
        tabId: snapshot.tabId,
        graphId: snapshot.graphId,
        ...(snapshot.address === undefined ? {} : { address: snapshot.address }),
        builtAt: snapshot.builtAt,
        nodeCount: snapshot.nodeCount,
        edgeCount: snapshot.edgeCount,
        interactableCount: snapshot.interactableCount,
        truncated: snapshot.truncated,
        budgetExhausted: snapshot.budgetExhausted,
        nodes: snapshot.nodes,
        edges: snapshot.edges
      };

      cache.graphByTab.write(snapshot.tabId, normalizedSnapshot);
      cache.graphById.write(snapshot.graphId, normalizedSnapshot);
      await store.write(normalizedSnapshot);

      return buildResultFromSnapshot(snapshot, detail);
    },

    queryGraph: async (request?: WorkbenchWebGraphQueryRequest) => {
      const tabId = resolveTabId(deps, request?.tabId);
      const snapshot = await ensureGraphLoaded({
        tabId,
        graphId: request?.graphId,
        forceBuild: false,
        deps,
        cache,
        store
      });

      return queryGraphSnapshot({ snapshot, request });
    },

    scanTargets: async (request: WorkbenchWebTargetScanRequest, context?: WorkbenchWebAutomationCallContext) => {
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);
      return await runLiveSelectorScan({
        deps,
        tabId,
        request,
        registry: scanRegistry,
        ...(context === undefined ? {} : { context }),
        agentSessions
      });
    },

    runSafeAction: async (request: WorkbenchWebActionRequest, context?: WorkbenchWebAutomationCallContext): Promise<WorkbenchWebActionResult> => {
      assertActionAllowed(request, "safe");
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);

      const target = (request.action as { readonly target?: Record<string, unknown> }).target;
      const hasCandidate = typeof target?.candidateId === "string";
      let overlayShown = false;
      try {
        if (hasCandidate) {
          const { scanSessionId, candidate } = await resolveCandidateFromAction({
            request,
            scanRegistry,
            deps,
            tabId,
            ...(context === undefined ? {} : { context }),
            agentSessions
          });
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toBrowserAgentTargetInfo({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_action",
                phase: "resolve",
                candidate
              })
            ).catch(() => false);
          }
          const result = await executeWebAction({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, scanSessionId, candidate),
            request
          });
          return {
            ...result,
            scanSessionId,
            overlayShown
          };
        }

        const graph = await ensureGraphLoaded({
          tabId,
          graphId: request.graphId,
          forceBuild: false,
          deps,
          cache,
          store
        });
        const result = await executeWebAction({
          browserBridge: deps.browserBridge,
          graph,
          request
        });
        return {
          ...result,
          overlayShown
        };
      } finally {
        if (context?.toolCallId) {
          await clearAgentSelectorTarget(deps.browserBridge, tabId, {
            preserveManualMode: true
          }).catch(() => undefined);
        }
      }
    },

    runMutateAction: async (request: WorkbenchWebActionRequest, context?: WorkbenchWebAutomationCallContext): Promise<WorkbenchWebActionResult> => {
      assertActionAllowed(request, "mutate");
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);

      const target = (request.action as { readonly target?: Record<string, unknown> }).target;
      const hasCandidate = typeof target?.candidateId === "string";
      let overlayShown = false;
      try {
        if (hasCandidate) {
          const { scanSessionId, candidate } = await resolveCandidateFromAction({
            request,
            scanRegistry,
            deps,
            tabId,
            ...(context === undefined ? {} : { context }),
            agentSessions
          });
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toBrowserAgentTargetInfo({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_action",
                phase: "act",
                candidate
              })
            ).catch(() => false);
          }
          const result = await executeWebAction({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, scanSessionId, candidate),
            request
          });
          invalidateTabGraphCache(cache, tabId, undefined);
          return {
            ...result,
            scanSessionId,
            overlayShown
          };
        }

        const graph = await ensureGraphLoaded({
          tabId,
          graphId: request.graphId,
          forceBuild: false,
          deps,
          cache,
          store
        });
        const result = await executeWebAction({
          browserBridge: deps.browserBridge,
          graph,
          request
        });
        invalidateTabGraphCache(cache, tabId, graph.graphId);
        return {
          ...result,
          overlayShown
        };
      } finally {
        if (context?.toolCallId) {
          await clearAgentSelectorTarget(deps.browserBridge, tabId, {
            preserveManualMode: true
          }).catch(() => undefined);
        }
      }
    },

    runNavigateAction: async (request: WorkbenchWebActionRequest, context?: WorkbenchWebAutomationCallContext): Promise<WorkbenchWebActionResult> => {
      assertActionAllowed(request, "navigate");
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);

      let graph: WorkbenchWebGraphSnapshot;
      if (request.action.kind === "goto_url" || request.action.kind === "history_back" || request.action.kind === "history_forward" || request.action.kind === "reload") {
        graph = {
          tabId,
          graphId: "navigation",
          builtAt: Date.now(),
          nodeCount: 0,
          edgeCount: 0,
          interactableCount: 0,
          truncated: false,
          budgetExhausted: false,
          nodes: [],
          edges: []
        };
      } else {
        graph = await ensureGraphLoaded({
          tabId,
          graphId: request.graphId,
          forceBuild: false,
          deps,
          cache,
          store
        });
      }

      try {
        const result = await executeWebAction({
          browserBridge: deps.browserBridge,
          graph,
          request
        });
        invalidateTabGraphCache(cache, tabId, graph.graphId);
        return result;
      } finally {
        if (context?.toolCallId) {
          await clearAgentSelectorTarget(deps.browserBridge, tabId, {
            preserveManualMode: true
          }).catch(() => undefined);
        }
      }
    },

    waitForTarget: async (request: WorkbenchWebWaitRequest, context?: WorkbenchWebAutomationCallContext): Promise<WorkbenchWebWaitResult> => {
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);
      const target = request.target as { readonly candidateId?: unknown; readonly scanSessionId?: unknown };
      const hasCandidate = typeof target.candidateId === "string";
      let overlayShown = false;
      try {
        if (hasCandidate) {
          const { scanSessionId, candidate } = await resolveCandidateReference({
            target: request.target as Record<string, unknown>,
            intent: {
              operation: "focus",
              desiredTags: ["textarea", "input", "button", "select"],
              desiredRoles: ["textbox", "searchbox", "combobox", "button"],
              allowContentEditable: true
            },
            scanRegistry,
            deps,
            tabId,
            ...(context === undefined ? {} : { context }),
            agentSessions
          });
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toBrowserAgentTargetInfo({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_wait",
                phase: "wait",
                candidate
              })
            ).catch(() => false);
          }
          const result = await waitForTarget({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, scanSessionId, candidate),
            request
          });
          return {
            ...result,
            scanSessionId,
            overlayShown
          };
        }

        const graph = await ensureGraphLoaded({
          tabId,
          graphId: request.graphId,
          forceBuild: false,
          deps,
          cache,
          store
        });

        const result = await waitForTarget({
          browserBridge: deps.browserBridge,
          graph,
          request
        });
        return {
          ...result,
          overlayShown
        };
      } finally {
        if (context?.toolCallId) {
          await clearAgentSelectorTarget(deps.browserBridge, tabId, {
            preserveManualMode: true
          }).catch(() => undefined);
        }
      }
    }
  };
};
