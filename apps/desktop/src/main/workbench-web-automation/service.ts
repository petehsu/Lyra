import type {
  WorkbenchWebAction,
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
  WorkbenchWebContextReadRequest,
  WorkbenchWebContextReadResult,
  WorkbenchWebElementNode,
  WorkbenchWebFocusAtlas,
  WorkbenchWebFocusProbeRequest,
  WorkbenchWebFocusProbeResult,
  WorkbenchWebFocusReadRequest,
  WorkbenchWebFocusReadResult,
  WorkbenchWebGraphBuildRequest,
  WorkbenchWebGraphBuildResult,
  WorkbenchWebGraphQueryRequest,
  WorkbenchWebGraphQueryResult,
  WorkbenchWebInterventionState,
  WorkbenchWebNodeRef,
  WorkbenchWebOperabilityReadRequest,
  WorkbenchWebOperabilityReadResult,
  WorkbenchWebQueryRequest,
  WorkbenchWebQueryResult,
  WorkbenchWebScanAndActRequest,
  WorkbenchWebScanAndActResult,
  WorkbenchWebSkeletonNode,
  WorkbenchWebSkeletonReadRequest,
  WorkbenchWebSkeletonReadResult,
  WorkbenchWebSkeletonRegion,
  WorkbenchWebVerificationStateTransition,
  WorkbenchWebWidgetScanRequest,
  WorkbenchWebWidgetScanResult,
  WorkbenchWebTargetCandidate,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanScope,
  WorkbenchWebTargetScanRequest,
  WorkbenchWebTargetScanResult,
  WorkbenchWebWaitRequest,
  WorkbenchWebWaitResult
} from "../../shared/workbench-web-automation";
import { WorkbenchWebAutomationCache } from "./cache";
import { executeWebAction, waitForTarget } from "./action-executor";
import { WorkbenchAgentWebSessionRegistry } from "./agent-session/registry";
import type { WorkbenchAgentWebSession } from "./agent-session/types";
import { createWebAutomationError } from "./diagnostics";
import { buildFocusAtlas } from "./focus-atlas/build";
import { FocusAtlasRegistry } from "./focus-atlas/registry";
import { buildWebGraphSnapshot } from "./graph-builder";
import {
  inferCandidateSemanticRole,
  matchesRequestedRoles,
  matchesSemanticWithinScope,
} from "./query-semantics";
import { buildGraphHighlights, rankNodesForAction, toNodeHint } from "./result-highlights";
import {
  captureQueryIntentCue,
  extractActionTargetTextHints,
  pickRevealContinuationCandidate,
  rankRevealContinuationCandidates,
  QUERY_INTENT_CUE_TTL_MS,
  readFreshQueryIntentCue,
  type WorkbenchWebQueryIntentCue,
} from "./reveal-continuation";
import { WorkbenchWebAutomationStore } from "./store";
import {
  clearAgentSelectorTarget,
  showAgentSelectorTarget,
  toBrowserAgentTargetInfo,
} from "./live-selector/agent-visualization";
import { rankLiveSelectorCandidates } from "./live-selector/candidate-ranker";
import { decodeLiveSelectorContinuationToken, encodeLiveSelectorContinuationToken } from "./live-selector/continuation-token";
import { nextLiveSelectorScope } from "./live-selector/expansion";
import { deriveLocalDeltaFromReveal, deriveLocalDeltaFromVerification } from "./live-selector/local-delta";
import { LiveSelectorScanRegistry } from "./live-selector/scan-session";
import { buildSurfaceModel } from "./live-selector/surface-model";
import { prioritizeSurfaceCandidates } from "./live-selector/surface-filter";
import { buildLiveSelectorScrollScript } from "./live-selector/scan-script";
import type {
  LiveSelectorScanCandidateRecord,
  LiveSelectorScanSession,
} from "./live-selector/types";
import { scanLayoutIntelligenceAcrossFrames } from "./layout-intelligence/service";
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
const SHARED_FOCUS_SCAN_MAX_AGE_MS = 1_500;
const QUERY_ATTRACTOR_TTL_MS = 45_000;
const ACTION_TIMEOUT_HOVER_MS = 3_500;
const ACTION_TIMEOUT_SAFE_MS = 4_500;
const ACTION_TIMEOUT_MUTATE_MS = 6_500;
const ACTION_TIMEOUT_NAVIGATE_MS = 8_000;
const SCAN_AND_ACT_CACHE_TTL_MS = 1_200;
const SCAN_AND_ACT_DEFAULT_MAX_LATENCY_MS = 350;
const SCAN_AND_ACT_MIN_MAX_LATENCY_MS = 120;
const SCAN_AND_ACT_MAX_MAX_LATENCY_MS = 2_000;
const SCAN_AND_ACT_DEFAULT_MAX_CANDIDATES = 24;
const SCAN_AND_ACT_DEFAULT_SCOPE: WorkbenchWebTargetScanScope = "visible";

type QueryAttractorState = {
  readonly candidateSignature: string;
  readonly queryFingerprint: string;
  readonly repeatCount: number;
  readonly updatedAt: number;
};

type ScanAndActProbeCacheEntry = {
  readonly tabId: string;
  readonly scope: WorkbenchWebTargetScanScope;
  readonly maxCandidates: number;
  readonly fingerprint: string;
  readonly cachedAt: number;
  readonly scanResult: WorkbenchWebTargetScanResult;
};

const readMicroExecutorStepBudget = (
  deps: WorkbenchWebAutomationServiceDeps
): 2 | 5 | 8 => {
  switch (deps.readLyraDirectMicroExecutorBudget?.()) {
    case "1-2":
      return 2;
    case "6-8":
      return 8;
    default:
      return 5;
  }
};

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
    const normalized = requestedTabId.trim();
    if (
      normalized !== "active-tab"
      && normalized !== "current-tab"
      && normalized !== "active"
      && normalized !== "current"
    ) {
      return normalized;
    }
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
    case "hover":
      return {
        operation: "hover",
        desiredTags: [seed?.tagName ?? "button", "a", "div"],
        desiredRoles: [seed?.role ?? "button", "link", "menuitem", "tab"],
        textHints,
        placeholderHints
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

const isWeakCssSelector = (value: string): boolean => {
  const selector = value.trim().toLowerCase();
  return selector.length === 0
    || selector === "*"
    || selector === "body"
    || selector === "html"
    || selector === "document"
    || selector.includes(":has-text(")
    || selector.includes(":contains(")
    || selector.includes(">>")
    || selector.includes("text=");
};

const clampTimeoutMs = (value: unknown): number | undefined => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return undefined;
  }
  return Math.max(250, Math.min(45_000, Math.round(value)));
};

const resolveActionExecutionTimeoutMs = (request: WorkbenchWebActionRequest): number => {
  const action = request.action;
  const requested = clampTimeoutMs(request.timeoutMs);
  switch (action.kind) {
    case "hover":
      return requested ?? ACTION_TIMEOUT_HOVER_MS;
    case "focus":
    case "scroll_into_view":
    case "expand_probe":
      return requested ?? ACTION_TIMEOUT_SAFE_MS;
    case "goto_url":
    case "history_back":
    case "history_forward":
    case "reload":
    case "open_link_node": {
      const navigationWaitMs = clampTimeoutMs(request.waitForNavigationMs);
      const timeout = requested ?? ACTION_TIMEOUT_NAVIGATE_MS;
      if (navigationWaitMs === undefined) {
        return timeout;
      }
      return Math.max(timeout, Math.min(45_000, navigationWaitMs + 1_200));
    }
    case "click":
    case "type":
    case "clear_and_type":
    case "select_option":
    case "set_checked":
    case "submit_form":
    case "press_key":
      return requested ?? ACTION_TIMEOUT_MUTATE_MS;
    default:
      return requested ?? ACTION_TIMEOUT_SAFE_MS;
  }
};

const executeWebActionWithDeadline = async (
  params: Parameters<typeof executeWebAction>[0]
): Promise<WorkbenchWebActionResult> => {
  const timeoutMs = resolveActionExecutionTimeoutMs(params.request);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(createWebAutomationError(
        "script_execution_failed",
        `action ${params.request.action.kind} timed out after ${timeoutMs}ms`,
        "execute",
        true,
        {
          details: {
            timeoutMs,
            actionKind: params.request.action.kind
          }
        }
      ));
    }, timeoutMs);
  });
  try {
    return await Promise.race([executeWebAction(params), timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
};

const isWeakStableSignatureTarget = (value: unknown): boolean => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const signature = value as Record<string, unknown>;
  const tagName = typeof signature.tagName === "string" ? signature.tagName.trim() : "";
  if (tagName.length === 0) {
    return false;
  }
  const strongKeys = ["id", "name", "testId", "structureHash"];
  if (strongKeys.some((key) => typeof signature[key] === "string" && (signature[key] as string).trim().length > 0)) {
    return false;
  }
  const weakKeys = ["textHash", "ariaLabel", "role", "inputType"];
  return weakKeys.some((key) => typeof signature[key] === "string" && (signature[key] as string).trim().length > 0);
};

const hoverRevealEligibleKinds = new Set([
  "navigation",
  "list",
  "list-item",
  "menu",
  "menu-trigger",
  "panel"
]);

const shouldAttemptHoverReveal = (
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
  return pageMode === "chat" || pageMode === "navigation" || pageMode === "feed";
};

const inferSubgoalFromIntent = (intent: WorkbenchWebTargetIntent): string => {
  switch (intent.operation) {
    case "hover":
      return "reveal item actions";
    case "submit":
      return "submit";
    case "type":
      return "locate composer";
    case "click":
      return "locate item";
    case "select":
      return "toggle mode";
    case "focus":
    default:
      return "locate target";
  }
};

const resolveActiveItemId = (candidate: Pick<LiveSelectorScanCandidateRecord, "widgetId" | "ownerWidgetId" | "widgetKind">): string | undefined => {
  if (candidate.widgetKind === "list-item") {
    return candidate.widgetId;
  }
  return candidate.ownerWidgetId;
};

const inferSubgoalFromAction = (action: WorkbenchWebAction): string => {
  switch (action.kind) {
    case "hover":
      return "reveal item actions";
    case "click":
      return "execute menu action";
    case "type":
    case "clear_and_type":
      return "type";
    case "press_key":
    case "submit_form":
      return "submit";
    case "select_option":
    case "set_checked":
      return "toggle mode";
    case "focus":
      return "locate composer";
    case "goto_url":
    case "open_link_node":
    case "history_back":
    case "history_forward":
    case "reload":
      return "navigate";
    default:
      return "act";
  }
};

const expandBounds = (
  bounds: WorkbenchWebTargetCandidate["bounds"],
  paddingX: number,
  paddingY: number
): WorkbenchWebTargetCandidate["bounds"] => ({
  x: bounds.x - paddingX,
  y: bounds.y - paddingY,
  width: bounds.width + paddingX * 2,
  height: bounds.height + paddingY * 2
});

const boundsOverlap = (
  left: WorkbenchWebTargetCandidate["bounds"],
  right: WorkbenchWebTargetCandidate["bounds"]
): boolean =>
  left.x < right.x + right.width
  && left.x + left.width > right.x
  && left.y < right.y + right.height
  && left.y + left.height > right.y;

const resolveHoverRevealRegion = ({
  seed,
  widgets,
  containerNodes
}: {
  readonly seed: LiveSelectorScanCandidateRecord;
  readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  readonly containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
}): WorkbenchWebTargetCandidate["bounds"] => {
  const widget = seed.widgetId === undefined
    ? undefined
    : widgets.find((entry) => entry.widgetId === seed.widgetId);
  const ownerWidget = seed.ownerWidgetId === undefined
    ? undefined
    : widgets.find((entry) => entry.widgetId === seed.ownerWidgetId);
  const container = widget?.containerId === undefined
    ? undefined
    : containerNodes.find((entry) => entry.containerId === widget.containerId);
  const baseBounds = widget?.bounds ?? ownerWidget?.bounds ?? container?.bounds ?? seed.bounds;
  return expandBounds(baseBounds, 180, 96);
};

const resolveWorkflowRegionForCandidate = ({
  candidate,
  widgets,
  containerNodes
}: {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly widgets?: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  readonly containerNodes?: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
}): WorkbenchWebTargetCandidate["bounds"] => {
  const widget = candidate.widgetId === undefined
    ? undefined
    : widgets?.find((entry) => entry.widgetId === candidate.widgetId);
  const ownerWidget = candidate.ownerWidgetId === undefined
    ? undefined
    : widgets?.find((entry) => entry.widgetId === candidate.ownerWidgetId);
  const container = widget?.containerId === undefined
    ? undefined
    : containerNodes?.find((entry) => entry.containerId === widget.containerId);
  return widget?.bounds ?? ownerWidget?.bounds ?? container?.bounds ?? candidate.bounds;
};

const readAgentSession = (
  agentSessions: WorkbenchAgentWebSessionRegistry,
  context: WorkbenchWebAutomationCallContext | undefined,
  tabId: string
): WorkbenchAgentWebSession | null => {
  if (!context?.agentSessionId || !context.agentTurnId) {
    return null;
  }
  return agentSessions.read(context.agentSessionId, context.agentTurnId, tabId);
};

const resolveSessionFocusRegion = (
  session: WorkbenchAgentWebSession | null | undefined,
  intent: WorkbenchWebTargetIntent
): WorkbenchWebTargetCandidate["bounds"] | undefined => {
  if (session === null || session === undefined) {
    return undefined;
  }

  const subgoal = session.currentSubgoal?.trim().toLowerCase();
  const useWorkflowRegion = (): WorkbenchWebTargetCandidate["bounds"] | undefined =>
    session.revealRegion ?? session.workflowRegion;

  switch (intent.operation) {
    case "type":
      return subgoal === "locate composer" || subgoal === "type" || subgoal === "submit"
        ? useWorkflowRegion()
        : undefined;
    case "focus":
      return subgoal === "locate composer"
        || subgoal === "type"
        || subgoal === "submit"
        || subgoal === "locate target"
        ? useWorkflowRegion()
        : undefined;
    case "select":
      return subgoal === "toggle mode" ? useWorkflowRegion() : undefined;
    case "click":
    case "hover":
    case "submit":
    default:
      return useWorkflowRegion();
  }
};

const isActionRevealTriggerCandidate = (
  candidate: Pick<
    LiveSelectorScanCandidateRecord,
    "widgetKind" | "affordanceAction" | "ariaLabel" | "affordanceLabel" | "tooltipText" | "stateHint"
  >
): boolean => {
  if (
    candidate.widgetKind === "menu-trigger"
    || candidate.widgetKind === "mode-switcher"
    || candidate.widgetKind === "toggle-group"
  ) {
    return true;
  }

  const action = candidate.affordanceAction?.trim().toLowerCase();
  if (action === "open menu" || action === "expand") {
    return true;
  }
  return candidate.stateHint === "collapsed" || candidate.stateHint === "expanded";
};

const shouldResetWorkflowContext = (
  result: Pick<WorkbenchWebActionResult, "verification" | "actionKind">
): boolean => {
  if (
    result.actionKind === "goto_url"
    || result.actionKind === "history_back"
    || result.actionKind === "history_forward"
    || result.actionKind === "reload"
    || result.actionKind === "open_link_node"
  ) {
    return true;
  }
  if (result.verification?.stateTransition !== "navigation_changed") {
    return false;
  }
  if (result.actionKind !== "click") {
    return true;
  }
  const widgetKind = result.verification?.widgetKind;
  if (
    widgetKind === "menu-trigger"
    || widgetKind === "toggle-group"
    || widgetKind === "mode-switcher"
    || widgetKind === "list-item"
    || widgetKind === "history-item"
    || widgetKind === "history-list"
    || widgetKind === "sidebar"
    || widgetKind === "navigation"
  ) {
    return false;
  }
  return true;
};

const isRevealStateTransition = (
  transition: NonNullable<WorkbenchWebActionResult["verification"]>["stateTransition"] | undefined
): boolean =>
  transition === "menu_opened"
  || transition === "region_expanded"
  || transition === "state_changed";

const pointerStateForContext = (
  agentSessions: WorkbenchAgentWebSessionRegistry,
  context: WorkbenchWebAutomationCallContext | undefined,
  tabId: string
): {} | {
  readonly pointerState: NonNullable<WorkbenchAgentWebSession["pointer"]>;
} => {
  const pointer = readAgentSession(agentSessions, context, tabId)?.pointer;
  return pointer === undefined ? {} : { pointerState: pointer };
};

const isLocallyRelevantCandidate = ({
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

const mergeRevealedCandidates = ({
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

const FOCUS_ATLAS_INTENT: WorkbenchWebTargetIntent = {
  operation: "focus",
  desiredTags: ["textarea", "input", "select", "button", "a"],
  desiredRoles: ["textbox", "searchbox", "combobox", "button", "link"],
  allowContentEditable: true
};

const applyFocusAtlasMetadata = ({
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

const deriveFocusAtlasLocalDelta = ({
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

const annotateCandidateForOperability = (
  candidate: LiveSelectorScanCandidateRecord,
  session?: WorkbenchAgentWebSession | null
): LiveSelectorScanCandidateRecord => ({
  ...candidate,
  humanOperableScore: humanOperableScoreForCandidate(candidate, session),
  keyboardReachable: isKeyboardReachableCandidate(candidate),
  withinCurrentWorkflow: isWithinCurrentWorkflowCandidate(candidate, session)
});

const annotateCandidatesForOperability = (
  candidates: readonly LiveSelectorScanCandidateRecord[],
  session?: WorkbenchAgentWebSession | null
): readonly LiveSelectorScanCandidateRecord[] =>
  candidates.map((candidate) => annotateCandidateForOperability(candidate, session));

const focusAtlasDiagnosticsFromScan = ({
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

const normalizeText = (value: string | undefined): string =>
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

const applyQueryAttractorGuard = ({
  tabId,
  request,
  ranked,
  attractorStateByTab
}: {
  readonly tabId: string;
  readonly request: WorkbenchWebQueryRequest | undefined;
  readonly ranked: readonly {
    readonly candidate: LiveSelectorScanCandidateRecord;
    readonly score: number;
  }[];
  readonly attractorStateByTab: Map<string, QueryAttractorState>;
}): readonly {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly score: number;
}[] => {
  const now = Date.now();
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

const buildNodeRef = ({
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

const toSkeletonNode = ({
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

const buildSkeletonRegions = ({
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

const buildSkeletonReadResult = ({
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

const queryTextHaystack = (candidate: LiveSelectorScanCandidateRecord): readonly string[] =>
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

const buildRegionKindById = (
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

const queryScoreCandidate = ({
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

const candidateSatisfiesQuery = ({
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

const roleToIntentTags = (role: string): readonly string[] => {
  switch (normalizeText(role)) {
    case "textbox":
    case "searchbox":
    case "combobox":
      return ["input", "textarea", "select"];
    case "button":
      return ["button", "div"];
    case "link":
      return ["a", "button"];
    case "menuitem":
    case "tab":
      return ["button", "a", "li", "div"];
    case "option":
      return ["option", "li", "div"];
    case "listitem":
    case "row":
    case "gridcell":
      return ["li", "tr", "td", "div", "a", "button"];
    case "checkbox":
    case "radio":
      return ["input", "button", "div"];
    default:
      return [];
  }
};

const buildQueryIntentFromRequest = (
  request?: WorkbenchWebQueryRequest
): WorkbenchWebTargetIntent => {
  if (request === undefined) {
    return FOCUS_ATLAS_INTENT;
  }

  const requestedRoles = normalizeActionTargetValues([
    ...(Array.isArray(request.role) ? request.role : request.role === undefined ? [] : [request.role])
  ]);
  const textHints = normalizeActionTargetValues([
    request.text,
    request.name,
    request.near,
    request.within,
    request.before,
    request.after,
    request.currentSubgoal
  ]);

  const stateHintsRequested =
    request.state !== undefined
    && (
      typeof request.state.selected === "boolean"
      || typeof request.state.checked === "boolean"
      || typeof request.state.expanded === "boolean"
    );
  const contextualHintsRequested =
    request.underMenu === true
    || request.inDialog === true
    || request.inTableRow === true
    || stateHintsRequested;
  if (requestedRoles.length === 0 && textHints.length === 0 && !contextualHintsRequested) {
    return FOCUS_ATLAS_INTENT;
  }

  const wantsTypeTargets = requestedRoles.some((role) =>
    role === "textbox" || role === "searchbox" || role === "combobox"
  );
  const wantsSelectTargets = requestedRoles.some((role) =>
    role === "option" || role === "listbox" || role === "menuitemradio" || role === "menuitemcheckbox"
  );
  const operation: WorkbenchWebTargetIntent["operation"] =
    wantsTypeTargets
      ? "type"
      : wantsSelectTargets
        ? "select"
        : "click";

  const defaultRoles = operation === "type"
    ? ["textbox", "searchbox", "combobox"]
    : operation === "select"
      ? ["option", "listbox", "combobox", "menuitem"]
      : ["button", "link", "menuitem", "tab", "option", "listitem"];
  const contextualRoles = [
    ...(request.underMenu === true ? ["menuitem", "option"] : []),
    ...(request.inDialog === true ? ["button", "textbox", "link"] : []),
    ...(request.inTableRow === true ? ["row", "gridcell", "listitem"] : [])
  ];
  const desiredRoles = normalizeActionTargetValues([
    ...requestedRoles,
    ...defaultRoles,
    ...contextualRoles
  ]);
  const desiredTags = normalizeActionTargetValues([
    ...requestedRoles.flatMap((role) => roleToIntentTags(role)),
    "button",
    "a",
    "input",
    "textarea",
    "select",
    "option",
    "li",
    "label",
    "summary",
    "div"
  ]);
  const placeholderHints = normalizeActionTargetValues([
    request.name,
    request.text
  ]);

  return {
    operation,
    desiredTags,
    desiredRoles,
    textHints,
    placeholderHints,
    ...(operation === "type" ? { allowContentEditable: true } : {})
  };
};

const filterCandidatesByRegion = ({
  candidates,
  regionId
}: {
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly regionId?: string;
}): readonly LiveSelectorScanCandidateRecord[] => {
  if (typeof regionId !== "string" || regionId.trim().length === 0) {
    return candidates;
  }
  return candidates.filter((candidate) => candidate.focusRegionId === regionId.trim());
};

const scanScopeOnce = async ({
  deps,
  tabId,
  intent,
  scope,
  maxCandidates,
  widgetId,
  regionId,
  scrollStep,
  surfaceSession
}: {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly intent: WorkbenchWebTargetIntent;
  readonly scope: "visible" | "nearby" | "expanded";
  readonly maxCandidates: number;
  readonly widgetId?: string;
  readonly regionId?: string;
  readonly scrollStep?: number;
  readonly surfaceSession?: WorkbenchAgentWebSession | null;
}): Promise<{
  readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
  readonly focusAtlas: WorkbenchWebFocusAtlas;
  readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  readonly layoutNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["layoutNodes"]>[number][];
  readonly containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly scannedFrames: number;
  readonly scannedCandidates: number;
  readonly scrolled: boolean;
}> => {
  const focusRegion = resolveSessionFocusRegion(surfaceSession, intent);
  if (scope === "expanded" && typeof scrollStep === "number" && scrollStep > 0) {
    const mainFrame = deps.browserBridge.listFrames(tabId).find((frame) => frame.isMainFrame);
    if (mainFrame !== undefined) {
      await deps.browserBridge.executeFrameScript(tabId, {
        frameTreeNodeId: mainFrame.frameTreeNodeId,
        script: buildLiveSelectorScrollScript(),
        userGesture: false
      }).catch(() => undefined);
    }
  }

  const { snapshot, scannedFrames, scannedCandidates } = await scanLayoutIntelligenceAcrossFrames({
    deps,
    tabId,
    scope,
    intent,
    maxNodes: scope === "visible" ? 256 : scope === "nearby" ? 384 : 512,
    ...(focusRegion === undefined ? {} : { focusRegion })
  });
  const focusAtlas = buildFocusAtlas({
    tabId,
    snapshot,
    ...(surfaceSession === undefined ? {} : { session: surfaceSession })
  }).atlas;
  const atlasApplied = applyFocusAtlasMetadata({
    candidates: snapshot.candidates.map((candidate) => ({
      ...candidate,
      score: 0
    })),
    widgets: snapshot.widgets,
    atlas: focusAtlas
  });
  const scopedByWidget = widgetId === undefined
    ? atlasApplied.candidates
    : atlasApplied.candidates.filter((candidate) =>
        candidate.widgetId === widgetId || candidate.ownerWidgetId === widgetId
      );
  const sourceCandidates = filterCandidatesByRegion({
    candidates: scopedByWidget,
    ...(regionId === undefined ? {} : { regionId })
  });
  const ranked = rankLiveSelectorCandidates(
    sourceCandidates,
    intent
  );
  const surfaced = prioritizeSurfaceCandidates({
    candidates: ranked,
    intent,
    ...(surfaceSession === undefined ? {} : { session: surfaceSession }),
    limit: maxCandidates
  });
  return {
    pageMode: snapshot.pageMode,
    focusAtlas,
    widgets: atlasApplied.widgets,
    layoutNodes: snapshot.layoutNodes,
    containerNodes: snapshot.containerNodes,
    candidates: surfaced,
    scannedFrames,
    scannedCandidates,
    scrolled: scope === "expanded" && typeof scrollStep === "number" && scrollStep > 0
  };
};

const runHoverRevealPass = async ({
  deps,
  tabId,
  request,
  scope,
  ranked,
  pageMode,
  focusAtlas,
  widgets,
  containerNodes,
  surfaceSession,
  maxMicroSteps
}: {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly request: WorkbenchWebTargetScanRequest;
  readonly scope: WorkbenchWebTargetScanScope;
  readonly ranked: readonly LiveSelectorScanCandidateRecord[];
  readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
  readonly focusAtlas: WorkbenchWebFocusAtlas;
  readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  readonly containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
  readonly surfaceSession?: WorkbenchAgentWebSession | null;
  readonly maxMicroSteps: number;
}): Promise<{
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly focusAtlas: WorkbenchWebFocusAtlas;
  readonly scannedFrames: number;
  readonly scannedCandidates: number;
  readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  readonly containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
  readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
} | null> => {
  if (
    request.intent.operation !== "click"
    && request.intent.operation !== "hover"
    && request.intent.operation !== "submit"
  ) {
    return null;
  }

  const revealSeeds = ranked
    .filter((candidate) => shouldAttemptHoverReveal(candidate, pageMode))
    .slice(0, Math.max(1, Math.min(3, Math.ceil(maxMicroSteps / 2))));
  if (revealSeeds.length === 0) {
    return null;
  }

  const initialFingerprint = ranked
    .map((candidate) => `${candidate.selectorAddress.frameTreeNodeId}:${candidate.selectorAddress.path}`)
    .join("|");
  let mergedCandidates: readonly LiveSelectorScanCandidateRecord[] = ranked;
  let mergedWidgets = widgets;
  let mergedContainerNodes = containerNodes;
  let mergedPageMode = pageMode;
  let mergedFocusAtlas: WorkbenchWebFocusAtlas = focusAtlas;
  let scannedFrames = 0;
  let scannedCandidates = 0;

  for (const seed of revealSeeds) {
    const revealRegion = resolveHoverRevealRegion({
      seed,
      widgets: mergedWidgets,
      containerNodes: mergedContainerNodes
    });
    await executeWebActionWithDeadline({
      browserBridge: deps.browserBridge,
      graph: syntheticGraphFromCandidate(tabId, `hover-reveal:${seed.candidateId}`, seed),
      request: {
        tabId,
        action: {
          kind: "hover",
          target: {
            selectorAddress: seed.selectorAddress
          }
        }
      },
      ...(surfaceSession?.pointer === undefined ? {} : { pointerState: surfaceSession.pointer })
    }).catch(() => undefined);

    const rescanned = await scanScopeOnce({
      deps,
      tabId,
      intent: request.intent,
      scope,
      maxCandidates: Math.max(request.maxCandidates ?? VISIBLE_SCAN_MAX, 24),
      ...(request.widgetId === undefined ? {} : { widgetId: request.widgetId }),
      ...(request.regionId === undefined ? {} : { regionId: request.regionId }),
      surfaceSession: null
    }).catch(() => null);
    if (rescanned === null) {
      continue;
    }

    scannedFrames += rescanned.scannedFrames;
    scannedCandidates += rescanned.scannedCandidates;
    mergedPageMode = rescanned.pageMode;
    mergedWidgets = rescanned.widgets;
    mergedContainerNodes = rescanned.containerNodes;
    mergedFocusAtlas = rescanned.focusAtlas;

    const revealedCandidates = rescanned.candidates.filter((entry) =>
      isLocallyRelevantCandidate({
        candidate: entry,
        seed,
        revealRegion
      })
    ).map((candidate) => ({
      ...candidate,
      discoveryMode: "hover_revealed" as const,
      ...(seed.widgetId === undefined ? {} : { ownerWidgetId: seed.widgetId }),
      ...(seed.itemIdentity === undefined ? {} : { itemIdentity: seed.itemIdentity })
    }));
    mergedCandidates = mergeRevealedCandidates({
      baseline: mergedCandidates,
      revealed: revealedCandidates,
      intent: request.intent
    });
  }

  const finalFingerprint = mergedCandidates
    .map((candidate) => `${candidate.selectorAddress.frameTreeNodeId}:${candidate.selectorAddress.path}`)
    .join("|");
  if (finalFingerprint === initialFingerprint) {
    return null;
  }

  return {
    candidates: mergedCandidates,
    focusAtlas: mergedFocusAtlas,
    scannedFrames,
    scannedCandidates,
    widgets: mergedWidgets,
    containerNodes: mergedContainerNodes,
    pageMode: mergedPageMode
  };
};

const runActionRevealPass = async ({
  deps,
  tabId,
  candidate,
  scanSession,
  surfaceSession,
  maxMicroSteps
}: {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly scanSession: LiveSelectorScanSession;
  readonly surfaceSession?: WorkbenchAgentWebSession | null;
  readonly maxMicroSteps?: number;
}): Promise<{
  readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
  readonly focusAtlas: WorkbenchWebFocusAtlas;
  readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  readonly containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly scannedFrames: number;
  readonly scannedCandidates: number;
} | null> => {
  const revealRegion = resolveHoverRevealRegion({
    seed: candidate,
    widgets: scanSession.widgets,
    containerNodes: scanSession.containerNodes
  });
  const rescanned = await scanScopeOnce({
    deps,
    tabId,
    intent: {
      operation: "click",
      desiredTags: ["button", "a"],
      desiredRoles: ["button", "menuitem", "option"],
      textHints: [candidate.ariaLabel, candidate.textSnippet, candidate.itemIdentity?.label].filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    },
    scope: "visible",
    maxCandidates: Math.max(24, Math.min(48, (maxMicroSteps ?? 5) * 6)),
    ...(surfaceSession === undefined ? {} : { surfaceSession })
  }).catch(() => null);
  if (rescanned === null) {
    return null;
  }

  const revealedCandidates = rescanned.candidates.filter((entry) =>
    isLocallyRelevantCandidate({
      candidate: entry,
      seed: candidate,
      revealRegion
    })
  ).map((entry) => ({
    ...entry,
    discoveryMode: "action_revealed" as const,
    ...(candidate.ownerWidgetId !== undefined
      ? { ownerWidgetId: candidate.ownerWidgetId }
      : candidate.widgetId !== undefined
        ? { ownerWidgetId: candidate.widgetId }
        : {}),
    ...(candidate.itemIdentity === undefined ? {} : { itemIdentity: candidate.itemIdentity })
  }));

  if (revealedCandidates.length === 0) {
    return null;
  }

  return {
    pageMode: rescanned.pageMode,
    focusAtlas: rescanned.focusAtlas,
    widgets: rescanned.widgets,
    containerNodes: rescanned.containerNodes,
    candidates: mergeRevealedCandidates({
      baseline: scanSession.candidates,
      revealed: revealedCandidates,
      intent: scanSession.intent
    }),
    scannedFrames: rescanned.scannedFrames,
    scannedCandidates: rescanned.scannedCandidates
  };
};

const runLiveSelectorScan = async ({
  deps,
  tabId,
  request,
  registry,
  context,
  agentSessions,
  focusAtlasRegistry
}: {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly request: WorkbenchWebTargetScanRequest;
  readonly registry: LiveSelectorScanRegistry;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  readonly focusAtlasRegistry: FocusAtlasRegistry;
}): Promise<WorkbenchWebTargetScanResult> => {
  const existingSurfaceSession = readAgentSession(agentSessions, context, tabId);
  const readOnlyFocusAtlasScan = request.readOnly === true || request.intent === FOCUS_ATLAS_INTENT;
  const surfaceSession = readOnlyFocusAtlasScan ? null : existingSurfaceSession;
  const maxMicroSteps = readMicroExecutorStepBudget(deps);
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
        : request.intent.operation === "hover"
          ? 20
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
  let pageMode: WorkbenchWebTargetScanResult["pageMode"] = "unknown";
  let focusAtlas: WorkbenchWebFocusAtlas | null = null;
  let widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][] = [];
  let containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][] = [];

  while (true) {
    if (scope === "expanded") {
      for (let step = 0; step <= MAX_EXPANDED_SCROLL_STEPS; step += 1) {
        const result = await scanScopeOnce({
          deps,
          tabId,
          intent: request.intent,
          scope,
          maxCandidates: EXPANDED_SCAN_MAX,
          ...(request.widgetId === undefined ? {} : { widgetId: request.widgetId }),
          ...(request.regionId === undefined ? {} : { regionId: request.regionId }),
          scrollStep: step,
          surfaceSession
        });
        ranked = result.candidates;
        pageMode = result.pageMode;
        focusAtlas = result.focusAtlas;
        widgets = result.widgets;
        containerNodes = result.containerNodes;
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
        maxCandidates: requestedMaxCandidates,
        ...(request.widgetId === undefined ? {} : { widgetId: request.widgetId }),
        ...(request.regionId === undefined ? {} : { regionId: request.regionId }),
        surfaceSession
      });
      ranked = result.candidates;
      pageMode = result.pageMode;
      focusAtlas = result.focusAtlas;
      widgets = result.widgets;
      containerNodes = result.containerNodes;
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

  if (ranked.length > 0 && scope !== "expanded" && request.readOnly !== true) {
    const revealed = await runHoverRevealPass({
      deps,
      tabId,
      request,
      scope,
      ranked,
      pageMode,
      focusAtlas: focusAtlas as WorkbenchWebFocusAtlas,
      widgets,
      containerNodes,
      surfaceSession,
      maxMicroSteps
    });
    if (revealed !== null) {
      ranked = revealed.candidates;
      pageMode = revealed.pageMode;
      focusAtlas = revealed.focusAtlas;
      widgets = revealed.widgets;
      containerNodes = revealed.containerNodes;
      scannedFrames += revealed.scannedFrames;
      scannedCandidates += revealed.scannedCandidates;
    }
  }

  if (ranked.length === 0) {
    const requestedWidgetId = typeof request.widgetId === "string" && request.widgetId.trim().length > 0
      ? request.widgetId.trim()
      : undefined;
    if (requestedWidgetId !== undefined) {
      if (widgets.some((widget) => widget.widgetId === requestedWidgetId) === false) {
        throw createWebAutomationError(
          "widget_not_found",
          "requested widget could not be found in the visible page",
          "scan",
          true,
          {
            candidateCount: 0,
            details: {
              widgetId: requestedWidgetId,
              pageMode
            }
          }
        );
      }
    }
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
  const atlasDiagnostics = focusAtlasDiagnosticsFromScan({
    durationMs: Date.now() - startedAt,
    atlas: focusAtlas as WorkbenchWebFocusAtlas,
    widgets
  });
  const annotatedRanked = annotateCandidatesForOperability(ranked, surfaceSession);
  const visibleCandidates = annotatedRanked.slice(offset, offset + requestedMaxCandidates);
  const surface = buildSurfaceModel({
    candidates: visibleCandidates.length > 0 ? visibleCandidates : annotatedRanked,
    ...(focusAtlas === null ? {} : { focusAtlas }),
    ...(surfaceSession === undefined ? {} : { session: surfaceSession })
  });
  const nextOffset = offset + visibleCandidates.length;
  const scanSession = registry.write({
    tabId,
    scope,
    intent: request.intent,
    pageMode,
    widgets,
    containerNodes,
    candidates: annotatedRanked
  });
  focusAtlasRegistry.write(tabId, {
    atlas: focusAtlas as WorkbenchWebFocusAtlas,
    diagnostics: atlasDiagnostics,
    ...(readOnlyFocusAtlasScan ? { preferredScanSessionId: scanSession.scanSessionId } : {})
  });
  const bestCandidate = visibleCandidates[0];

  if (context?.agentSessionId && context?.agentTurnId) {
    const activeItemId = bestCandidate === undefined ? undefined : resolveActiveItemId(bestCandidate);
    const hoveredWidgetId = bestCandidate === undefined
      ? undefined
      : bestCandidate.widgetId ?? bestCandidate.ownerWidgetId;
    const workflowRegion = bestCandidate === undefined
      ? undefined
      : resolveWorkflowRegionForCandidate({
          candidate: bestCandidate,
          widgets,
          containerNodes
        });
    const revealRegion = bestCandidate === undefined
      ? undefined
      : resolveHoverRevealRegion({
          seed: bestCandidate,
          widgets,
          containerNodes
        });
    const revealDelta = deriveLocalDeltaFromReveal({
      baseline: ranked.filter((candidate) => candidate.discoveryMode !== "hover_revealed"),
      revealed: ranked.filter((candidate) => candidate.discoveryMode === "hover_revealed"),
      ...(workflowRegion === undefined ? {} : { workflowRegion }),
      ...(revealRegion === undefined ? {} : { revealRegion })
    });
    const focusDelta = focusAtlas === null
      ? undefined
      : deriveFocusAtlasLocalDelta({
          previousSession: surfaceSession,
          atlas: focusAtlas
        });
    const nextLocalDelta = revealDelta ?? focusDelta;
    const preservedSession = existingSurfaceSession ?? undefined;
    agentSessions.upsert({
      agentSessionId: context.agentSessionId,
      agentTurnId: context.agentTurnId,
      tabId,
      scanSessionId: scanSession.scanSessionId,
      ...(
        readOnlyFocusAtlasScan
          ? {
              ...(preservedSession?.currentTarget === undefined ? {} : { currentTarget: preservedSession.currentTarget }),
              ...(preservedSession?.activeWidgetId === undefined ? {} : { activeWidgetId: preservedSession.activeWidgetId }),
              ...(preservedSession?.activeItemId === undefined ? {} : { activeItemId: preservedSession.activeItemId }),
              ...(preservedSession?.currentSubgoal === undefined ? {} : { currentSubgoal: preservedSession.currentSubgoal }),
              ...(preservedSession?.pointer === undefined ? {} : { pointer: preservedSession.pointer }),
              ...(preservedSession?.hoveredCandidateId === undefined ? {} : { hoveredCandidateId: preservedSession.hoveredCandidateId }),
              ...(preservedSession?.hoveredWidgetId === undefined ? {} : { hoveredWidgetId: preservedSession.hoveredWidgetId }),
              ...(preservedSession?.hoveredItemId === undefined ? {} : { hoveredItemId: preservedSession.hoveredItemId }),
              ...(preservedSession?.workflowRegion === undefined ? {} : { workflowRegion: preservedSession.workflowRegion }),
              ...(preservedSession?.revealRegion === undefined ? {} : { revealRegion: preservedSession.revealRegion }),
              ...(preservedSession?.lastLocalDelta === undefined ? {} : { lastLocalDelta: preservedSession.lastLocalDelta }),
              ...(preservedSession?.currentCursorStyle === undefined ? {} : { currentCursorStyle: preservedSession.currentCursorStyle }),
              ...(preservedSession?.lastRevealObserved === undefined ? {} : { lastRevealObserved: preservedSession.lastRevealObserved }),
            }
          : {
              ...(bestCandidate?.widgetId === undefined ? {} : { activeWidgetId: bestCandidate.widgetId }),
              ...(activeItemId === undefined ? {} : { activeItemId }),
              currentSubgoal: inferSubgoalFromIntent(request.intent),
              ...(workflowRegion === undefined ? {} : { workflowRegion }),
              ...(revealRegion === undefined ? {} : { revealRegion }),
              ...(bestCandidate === undefined ? {} : { hoveredCandidateId: bestCandidate.candidateId }),
              ...(hoveredWidgetId === undefined ? {} : { hoveredWidgetId }),
              ...(activeItemId === undefined ? {} : { hoveredItemId: activeItemId }),
              ...(nextLocalDelta ? { lastLocalDelta: nextLocalDelta } : {}),
              ...(revealDelta?.cursorStyle === undefined
                ? {}
                : { currentCursorStyle: revealDelta.cursorStyle }),
              ...(request.currentSubgoal === undefined ? {} : { currentSubgoal: request.currentSubgoal }),
              lastRevealObserved: ranked.some((candidate) => candidate.discoveryMode === "hover_revealed")
            }
      ),
      ...(focusAtlas === null
        ? {}
        : {
            focusAtlasVersion: focusAtlas.version,
            ...(focusAtlas.activeFocusRegionId === undefined
              ? {}
              : { activeFocusRegionId: focusAtlas.activeFocusRegionId }),
            lastFocusDeltaObserved: focusDelta !== undefined
          })
    });
  }

  if (bestCandidate !== undefined && context?.toolCallId) {
    await showAgentSelectorTarget(
      deps.browserBridge,
      toAgentTargetFromCandidate({
        tabId,
        toolCallId: context.toolCallId,
        owner: "agent_scan",
        phase: "scan",
        candidate: bestCandidate,
        pageMode,
        widgets
      })
    ).catch(() => false);
  }

  return {
    tabId,
    scanSessionId: scanSession.scanSessionId,
    scope,
    pageMode,
    ...(focusAtlas === null
      ? {}
      : {
          focusAtlasReady: true,
          focusAtlasVersion: focusAtlas.version,
          activeFocusRegionId: focusAtlas.activeFocusRegionId
        }),
    surface,
    ...(widgets.length === 0 ? {} : { widgets }),
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

const adaptiveScanScopes = (
  preferredScope: WorkbenchWebTargetScanScope
): readonly WorkbenchWebTargetScanScope[] => {
  if (preferredScope === "expanded") {
    return ["expanded"];
  }
  if (preferredScope === "nearby") {
    return ["nearby", "expanded"];
  }
  return ["visible", "nearby", "expanded"];
};

const runAdaptiveLiveSelectorScan = async ({
  deps,
  tabId,
  request,
  registry,
  context,
  agentSessions,
  focusAtlasRegistry
}: {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly request: WorkbenchWebTargetScanRequest;
  readonly registry: LiveSelectorScanRegistry;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  readonly focusAtlasRegistry: FocusAtlasRegistry;
}): Promise<WorkbenchWebTargetScanResult> => {
  const scopes = adaptiveScanScopes(request.scope ?? "visible");
  let lastError: unknown;
  for (const scope of scopes) {
    try {
      return await runLiveSelectorScan({
        deps,
        tabId,
        request: {
          ...request,
          scope
        },
        registry,
        ...(context === undefined ? {} : { context }),
        agentSessions,
        focusAtlasRegistry
      });
    } catch (error) {
      if (!isNoInteractableCandidatesError(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  if (lastError !== undefined) {
    throw lastError;
  }
  throw createWebAutomationError(
    "no_interactable_candidates",
    "no interactable candidates found in adaptive scan",
    "scan",
    true
  );
};

const normalizeScanAndActRoleHint = (
  value: string | readonly string[] | undefined
): string | undefined =>
  Array.isArray(value)
    ? value.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)?.trim()
    : typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;

const isWildcardLikeHint = (value: string): boolean => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return true;
  }
  if (normalized === "*" || normalized === ".*" || normalized === ".+") {
    return true;
  }
  if (/^[.*+?^${}()[\]|\\/\s]+$/.test(normalized)) {
    return true;
  }
  return false;
};

const splitHintAlternatives = (value: string): readonly string[] =>
  value
    .split(/[|,/，、；;]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const extractMeaningfulHintTokens = (value: unknown): readonly string[] => {
  if (typeof value !== "string") {
    return [];
  }
  const raw = value.trim();
  if (raw.length === 0) {
    return [];
  }
  const normalizedAlternatives = splitHintAlternatives(raw);
  const candidates = normalizedAlternatives.length > 0 ? normalizedAlternatives : [raw];
  return Array.from(new Set(
    candidates.filter((entry) =>
      !isWildcardLikeHint(entry)
      && /[a-z0-9\u4e00-\u9fff]/i.test(entry)
    )
  ));
};

const readScanAndActHintString = (value: unknown): string | undefined =>
  extractMeaningfulHintTokens(value)[0];

const readScanAndActHintNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;

const extractActionTargetHintRecord = (action: WorkbenchWebAction): Record<string, unknown> | undefined => {
  const rawTarget = (action as { readonly target?: unknown }).target;
  if (rawTarget === null || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
    return undefined;
  }
  const target = rawTarget as Record<string, unknown>;
  const targetSignature =
    target.stableSignature !== null
    && typeof target.stableSignature === "object"
    && !Array.isArray(target.stableSignature)
      ? target.stableSignature as Record<string, unknown>
      : undefined;
  const roleHint = normalizeScanAndActRoleHint(
    readScanAndActHintString(target.role)
    ?? readScanAndActHintString(targetSignature?.role)
  );
  const tagNameHint = readScanAndActHintString(target.tagName) ?? readScanAndActHintString(targetSignature?.tagName);
  const inputTypeHint = readScanAndActHintString(target.inputType);
  const idHint = readScanAndActHintString(target.id) ?? readScanAndActHintString(targetSignature?.id);
  const testIdHint = readScanAndActHintString(target.testId) ?? readScanAndActHintString(targetSignature?.testId);
  const nameHint = readScanAndActHintString(target.name) ?? readScanAndActHintString(targetSignature?.name);
  const textHint = readScanAndActHintString(target.text);
  const textContainsHint = readScanAndActHintString(target.textContains);
  const textSnippetHint = readScanAndActHintString(target.textSnippet);
  const ariaLabelHint = readScanAndActHintString(target.ariaLabel) ?? readScanAndActHintString(targetSignature?.ariaLabel);
  const labelHint = readScanAndActHintString(target.label);
  const placeholderHint = readScanAndActHintString(target.placeholder);
  const indexHint = readScanAndActHintNumber(target.index);
  const record: Record<string, unknown> = {
    ...(roleHint === undefined ? {} : { role: roleHint }),
    ...(tagNameHint === undefined ? {} : { tagName: tagNameHint }),
    ...(inputTypeHint === undefined ? {} : { inputType: inputTypeHint }),
    ...(idHint === undefined ? {} : { id: idHint }),
    ...(testIdHint === undefined ? {} : { testId: testIdHint }),
    ...(nameHint === undefined ? {} : { name: nameHint }),
    ...(textHint === undefined ? {} : { text: textHint }),
    ...(textContainsHint === undefined ? {} : { textContains: textContainsHint }),
    ...(textSnippetHint === undefined ? {} : { textSnippet: textSnippetHint }),
    ...(ariaLabelHint === undefined ? {} : { ariaLabel: ariaLabelHint }),
    ...(labelHint === undefined ? {} : { label: labelHint }),
    ...(placeholderHint === undefined ? {} : { placeholder: placeholderHint }),
    ...(indexHint === undefined ? {} : { index: indexHint })
  };
  return Object.keys(record).length > 0 ? record : undefined;
};

const mergeActionWithScanAndActHints = (
  action: WorkbenchWebAction,
  targetHints?: WorkbenchWebScanAndActRequest["targetHints"]
): WorkbenchWebAction => {
  if (targetHints === undefined) {
    return action;
  }
  const rawTarget = (action as { readonly target?: unknown }).target;
  if (rawTarget === null || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
    return action;
  }
  const target = rawTarget as Record<string, unknown>;
  const roleHint = normalizeScanAndActRoleHint(targetHints.role);
  const mergedTarget = {
    ...target,
    ...(target.role === undefined && roleHint !== undefined ? { role: roleHint } : {}),
    ...(target.name === undefined && targetHints.name !== undefined ? { name: targetHints.name } : {}),
    ...(target.text === undefined && targetHints.text !== undefined ? { text: targetHints.text } : {}),
    ...(target.textContains === undefined && targetHints.textContains !== undefined
      ? { textContains: targetHints.textContains }
      : {}),
    ...(target.textSnippet === undefined && targetHints.textSnippet !== undefined
      ? { textSnippet: targetHints.textSnippet }
      : {}),
    ...(target.ariaLabel === undefined && targetHints.ariaLabel !== undefined
      ? { ariaLabel: targetHints.ariaLabel }
      : {}),
    ...(target.label === undefined && targetHints.label !== undefined ? { label: targetHints.label } : {}),
    ...(target.placeholder === undefined && targetHints.placeholder !== undefined
      ? { placeholder: targetHints.placeholder }
      : {}),
  };
  return {
    ...(action as Record<string, unknown>),
    target: mergedTarget
  } as WorkbenchWebAction;
};

const buildScanAndActIntent = ({
  action,
  targetHints
}: {
  readonly action: WorkbenchWebAction;
  readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
}): WorkbenchWebTargetIntent => {
  const actionTargetRecord = extractActionTargetHintRecord(action);
  const roleHint = normalizeScanAndActRoleHint(
    targetHints?.role
    ?? readScanAndActHintString(actionTargetRecord?.role)
  );
  const textHints = normalizeActionTargetValues([
    targetHints?.text,
    targetHints?.textContains,
    targetHints?.textSnippet,
    targetHints?.name,
    targetHints?.ariaLabel,
    targetHints?.label,
    targetHints?.near,
    targetHints?.within,
    readScanAndActHintString(actionTargetRecord?.text),
    readScanAndActHintString(actionTargetRecord?.textContains),
    readScanAndActHintString(actionTargetRecord?.textSnippet),
    readScanAndActHintString(actionTargetRecord?.name),
    readScanAndActHintString(actionTargetRecord?.ariaLabel),
    readScanAndActHintString(actionTargetRecord?.label)
  ]);
  const placeholderHints = normalizeActionTargetValues([
    targetHints?.placeholder,
    targetHints?.name,
    targetHints?.label,
    readScanAndActHintString(actionTargetRecord?.placeholder),
    readScanAndActHintString(actionTargetRecord?.name),
    readScanAndActHintString(actionTargetRecord?.label)
  ]);
  const seedAriaLabel = targetHints?.name ?? readScanAndActHintString(actionTargetRecord?.name);
  const seedPlaceholder = targetHints?.placeholder ?? readScanAndActHintString(actionTargetRecord?.placeholder);
  const defaultIntent = toActionIntent(action, {
    ...(roleHint === undefined ? {} : { role: roleHint }),
    ...(seedAriaLabel === undefined ? {} : { ariaLabel: seedAriaLabel }),
    ...(textHints[0] === undefined ? {} : { textSnippet: textHints[0] }),
    ...(seedPlaceholder === undefined ? {} : { placeholder: seedPlaceholder })
  });
  if (targetHints === undefined && actionTargetRecord === undefined) {
    return defaultIntent;
  }
  return {
    ...defaultIntent,
    desiredRoles: normalizeActionTargetValues([...(defaultIntent.desiredRoles ?? []), roleHint]),
    textHints: normalizeActionTargetValues([...(defaultIntent.textHints ?? []), ...textHints]),
    placeholderHints: normalizeActionTargetValues([
      ...(defaultIntent.placeholderHints ?? []),
      ...placeholderHints
    ])
  };
};

const buildScanAndActTargetRecord = (
  targetHints?: WorkbenchWebScanAndActRequest["targetHints"]
): Record<string, unknown> | undefined => {
  if (targetHints === undefined) {
    return undefined;
  }
  const roleHint = normalizeScanAndActRoleHint(targetHints.role);
  const record: Record<string, unknown> = {
    ...(roleHint === undefined ? {} : { role: roleHint }),
    ...(targetHints.name === undefined ? {} : { name: targetHints.name }),
    ...(targetHints.text === undefined ? {} : { text: targetHints.text }),
    ...(targetHints.textContains === undefined ? {} : { textContains: targetHints.textContains }),
    ...(targetHints.textSnippet === undefined ? {} : { textSnippet: targetHints.textSnippet }),
    ...(targetHints.ariaLabel === undefined ? {} : { ariaLabel: targetHints.ariaLabel }),
    ...(targetHints.label === undefined ? {} : { label: targetHints.label }),
    ...(targetHints.placeholder === undefined ? {} : { placeholder: targetHints.placeholder }),
    ...(targetHints.index === undefined ? {} : { index: targetHints.index })
  };
  return Object.keys(record).length > 0 ? record : undefined;
};

const buildMergedScanAndActTargetRecord = ({
  action,
  targetHints
}: {
  readonly action: WorkbenchWebAction;
  readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
}): Record<string, unknown> | undefined => {
  const actionTargetRecord = extractActionTargetHintRecord(action);
  const hintTargetRecord = buildScanAndActTargetRecord(targetHints);
  if (actionTargetRecord === undefined) {
    return hintTargetRecord;
  }
  if (hintTargetRecord === undefined) {
    return actionTargetRecord;
  }
  const merged = {
    ...actionTargetRecord,
    ...hintTargetRecord
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
};

const hasStrictScanAndActTargetConstraints = ({
  targetRecord,
  targetHints
}: {
  readonly targetRecord: Record<string, unknown> | undefined;
  readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
}): boolean => {
  if (targetRecord === undefined) {
    return false;
  }
  const strictHintRequested = targetHints !== undefined && (
    targetHints.index !== undefined
    || readScanAndActHintString(targetHints.text) !== undefined
    || readScanAndActHintString(targetHints.textContains) !== undefined
    || readScanAndActHintString(targetHints.textSnippet) !== undefined
    || readScanAndActHintString(targetHints.ariaLabel) !== undefined
    || readScanAndActHintString(targetHints.placeholder) !== undefined
  );
  return strictHintRequested
    || readScanAndActHintNumber(targetRecord.index) !== undefined
    || readScanAndActHintString(targetRecord.id) !== undefined
    || readScanAndActHintString(targetRecord.testId) !== undefined;
};

const candidateMatchesContextHint = (
  candidate: LiveSelectorScanCandidateRecord,
  hintNeedle: string
): boolean => {
  if (hintNeedle.length === 0) {
    return false;
  }
  const haystack = [
    candidate.textSnippet,
    candidate.ariaLabel,
    candidate.affordanceLabel,
    candidate.itemIdentity?.label,
    candidate.stableSignature.ariaLabel,
    candidate.stableSignature.name,
    candidate.stableSignature.id,
    candidate.stableSignature.testId,
    candidate.containerHint?.label,
    candidate.selectorPreview
  ].map((value) => normalizeText(value)).filter((value) => value.length > 0);
  return haystack.some((value) => value.includes(hintNeedle) || hintNeedle.includes(value));
};

const constrainCandidatesByContextHint = ({
  candidates,
  hint,
  strict
}: {
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly hint?: string;
  readonly strict?: boolean;
}): readonly LiveSelectorScanCandidateRecord[] => {
  const needles = extractMeaningfulHintTokens(hint).map((entry) => normalizeText(entry));
  if (needles.length === 0) {
    return candidates;
  }
  const anchored = candidates.filter((candidate) =>
    needles.some((needle) => candidateMatchesContextHint(candidate, needle))
  );
  if (anchored.length === 0) {
    return strict === true ? [] : candidates;
  }
  const ownerIds = new Set(
    anchored
      .map((candidate) => candidate.ownerWidgetId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const widgetIds = new Set(
    anchored
      .map((candidate) => candidate.widgetId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const regionIds = new Set(
    anchored
      .map((candidate) => candidate.focusRegionId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const contextual = candidates.filter((candidate) => {
    if (candidate.ownerWidgetId !== undefined && ownerIds.has(candidate.ownerWidgetId)) {
      return true;
    }
    if (candidate.widgetId !== undefined && widgetIds.has(candidate.widgetId)) {
      return true;
    }
    if (candidate.ownerWidgetId !== undefined && widgetIds.has(candidate.ownerWidgetId)) {
      return true;
    }
    return candidate.focusRegionId !== undefined && regionIds.has(candidate.focusRegionId);
  });
  return contextual.length > 0 ? contextual : anchored;
};

const buildScanAndActFingerprint = ({
  action,
  targetHints
}: {
  readonly action: WorkbenchWebAction;
  readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
}): string => {
  const mergedTargetRecord = buildMergedScanAndActTargetRecord({
    action,
    ...(targetHints === undefined ? {} : { targetHints })
  });
  const roleHint = normalizeScanAndActRoleHint(
    readScanAndActHintString(mergedTargetRecord?.role)
    ?? targetHints?.role
  );
  const parts = [
    action.kind,
    roleHint,
    normalizeText(readScanAndActHintString(mergedTargetRecord?.name)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.text)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.textContains)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.textSnippet)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.ariaLabel)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.label)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.placeholder)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.id)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.testId)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.tagName)),
    normalizeText(targetHints?.within),
    normalizeText(targetHints?.near),
    normalizeText(targetHints?.regionId),
    normalizeText(targetHints?.groupId),
    readScanAndActHintNumber(mergedTargetRecord?.index) === undefined
      ? ""
      : String(readScanAndActHintNumber(mergedTargetRecord?.index))
  ];
  return parts.join("::");
};

const normalizeScanAndActLatencyBudget = (value: number | undefined): number => {
  const candidate = Math.round(value ?? SCAN_AND_ACT_DEFAULT_MAX_LATENCY_MS);
  return Math.max(
    SCAN_AND_ACT_MIN_MAX_LATENCY_MS,
    Math.min(SCAN_AND_ACT_MAX_MAX_LATENCY_MS, candidate)
  );
};

const candidateSupportsActionKind = (
  candidate: LiveSelectorScanCandidateRecord,
  action: WorkbenchWebAction
): boolean => {
  switch (action.kind) {
    case "type":
    case "clear_and_type":
      return candidate.interactable.typable || candidate.interactable.focusable;
    case "select_option":
    case "set_checked":
      return candidate.interactable.selectable || candidate.interactable.clickable;
    case "press_key":
    case "focus":
      return candidate.interactable.focusable || candidate.interactable.typable;
    case "hover":
    case "scroll_into_view":
    case "expand_probe":
    case "click":
    case "submit_form":
    case "open_link_node":
      return candidate.interactable.clickable || candidate.interactable.focusable;
    default:
      return true;
  }
};

const selectScanAndActCandidate = ({
  scanResult,
  action,
  targetHints
}: {
  readonly scanResult: WorkbenchWebTargetScanResult;
  readonly action: WorkbenchWebAction;
  readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
}): LiveSelectorScanCandidateRecord | undefined => {
  const allCandidates = scanResult.candidates as readonly LiveSelectorScanCandidateRecord[];
  if (allCandidates.length === 0) {
    return undefined;
  }
  const regionId = normalizeText(targetHints?.regionId);
  const groupId = normalizeText(targetHints?.groupId);
  const regionFiltered = regionId.length === 0
    ? allCandidates
    : allCandidates.filter((candidate) => normalizeText(candidate.focusRegionId) === regionId);
  const groupFiltered = groupId.length === 0
    ? regionFiltered
    : regionFiltered.filter((candidate) =>
      normalizeText(candidate.ownerWidgetId) === groupId
      || normalizeText(candidate.widgetId) === groupId
    );
  const strictContextConstraint = action.kind === "click";
  const scopedCandidates = groupFiltered.length > 0 ? groupFiltered : regionFiltered;
  const nearConstrained = constrainCandidatesByContextHint({
    candidates: scopedCandidates,
    ...(targetHints?.near === undefined ? {} : { hint: targetHints.near }),
    ...(strictContextConstraint ? { strict: true } : {})
  });
  const contextConstrained = constrainCandidatesByContextHint({
    candidates: nearConstrained,
    ...(targetHints?.within === undefined ? {} : { hint: targetHints.within }),
    ...(strictContextConstraint ? { strict: true } : {})
  });
  let candidates = contextConstrained;
  if (candidates.length === 0) {
    return undefined;
  }
  const targetRecord = buildMergedScanAndActTargetRecord({
    action,
    ...(targetHints === undefined ? {} : { targetHints })
  });
  const hasMeaningfulContextHint =
    extractMeaningfulHintTokens(targetHints?.near).length > 0
    || extractMeaningfulHintTokens(targetHints?.within).length > 0;
  const roleHint = normalizeText(
    normalizeScanAndActRoleHint(targetHints?.role)
    ?? readScanAndActHintString(targetRecord?.role)
  );
  const isBroadRoleHint = roleHint.length === 0
    || roleHint === "button"
    || roleHint === "link"
    || roleHint === "listitem"
    || roleHint === "list-item"
    || roleHint === "navigation"
    || roleHint === "list";
  const hasStrongTargetSignal = targetRecord !== undefined && (
    readScanAndActHintNumber(targetRecord.index) !== undefined
    || readScanAndActHintString(targetRecord.id) !== undefined
    || readScanAndActHintString(targetRecord.testId) !== undefined
    || readScanAndActHintString(targetRecord.name) !== undefined
    || readScanAndActHintString(targetRecord.ariaLabel) !== undefined
    || readScanAndActHintString(targetRecord.label) !== undefined
    || readScanAndActHintString(targetRecord.text) !== undefined
    || readScanAndActHintString(targetRecord.textContains) !== undefined
    || readScanAndActHintString(targetRecord.textSnippet) !== undefined
    || readScanAndActHintString(targetRecord.placeholder) !== undefined
  );
  if (action.kind === "click" && !hasStrongTargetSignal && !hasMeaningfulContextHint && isBroadRoleHint) {
    return undefined;
  }
  const hasExplicitTextTarget =
    readScanAndActHintString(targetRecord?.text) !== undefined
    || readScanAndActHintString(targetRecord?.textContains) !== undefined
    || readScanAndActHintString(targetRecord?.textSnippet) !== undefined
    || readScanAndActHintString(targetRecord?.label) !== undefined
    || readScanAndActHintString(targetRecord?.ariaLabel) !== undefined;
  if (
    action.kind === "click"
    && !hasExplicitTextTarget
    && (normalizeText(targetHints?.near).length > 0 || normalizeText(targetHints?.within).length > 0)
  ) {
    const revealTriggerCandidates = candidates.filter((candidate) => isActionRevealTriggerCandidate(candidate));
    if (revealTriggerCandidates.length > 0) {
      candidates = revealTriggerCandidates;
    }
  }
  if (targetRecord !== undefined) {
    const matched = findBestActionTargetCandidate({
      candidates,
      target: targetRecord,
      actionKind: action.kind,
      action
    });
    if (matched !== undefined) {
      return matched;
    }
    if (hasStrictScanAndActTargetConstraints({
      targetRecord,
      ...(targetHints === undefined ? {} : { targetHints })
    })) {
      return undefined;
    }
  }
  const ranked = rankLiveSelectorCandidates(candidates, buildScanAndActIntent({
    action,
    ...(targetHints === undefined ? {} : { targetHints })
  }));
  return ranked[0] ?? (scanResult.bestCandidate as LiveSelectorScanCandidateRecord | undefined);
};

const isVerifiedActionResult = (result: WorkbenchWebActionResult): boolean =>
  result.verified === true
  || (
    result.ok
    && (
      result.actionKind === "goto_url"
      || result.actionKind === "history_back"
      || result.actionKind === "history_forward"
      || result.actionKind === "reload"
      || result.actionKind === "open_link_node"
    )
  );

const actionResultStateTransition = (
  result: WorkbenchWebActionResult
): WorkbenchWebVerificationStateTransition | undefined =>
  result.verification?.stateTransition;

const normalizeGoalTransitionToken = (value: string): string =>
  normalizeText(value).replace(/[\s_-]+/g, "");

const mapGoalExpectedTransition = (
  value: string
): WorkbenchWebVerificationStateTransition | undefined => {
  const token = normalizeGoalTransitionToken(value);
  switch (token) {
    case "valuechanged":
      return "value_changed";
    case "menuopened":
    case "menuopen":
    case "menuvisible":
    case "optionsvisible":
    case "optionsmenuvisible":
    case "panelopened":
    case "dropdownopened":
    case "popoveropened":
    case "openmenu":
      return "menu_opened";
    case "regionexpanded":
    case "expanded":
    case "sidebarexpanded":
      return "region_expanded";
    case "statechanged":
      return "state_changed";
    case "validationchanged":
      return "validation_changed";
    case "navigationchanged":
    case "urlchanged":
    case "pagechanged":
    case "conversationselected":
    case "chatselected":
    case "threadselected":
      return "navigation_changed";
    case "modelchanged":
    case "modechanged":
    case "modelswitched":
    case "modeswitched":
    case "switchmode":
    case "switchmodel":
      return "model_changed";
    case "conversationdeleted":
    case "conversationremoved":
    case "itemremoved":
    case "itemdeleted":
    case "chatdeleted":
    case "threaddeleted":
    case "deleteconversation":
      return "conversation_deleted";
    case "messagesubmitted":
      return "message_submitted";
    case "responsestarted":
      return "response_started";
    case "focuschanged":
      return "focus_changed";
    case "none":
      return "none";
    default:
      return undefined;
  }
};

const normalizeGoalExpectedTransitions = (
  value: readonly string[] | undefined
): readonly WorkbenchWebVerificationStateTransition[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  const mapped = value
    .map((entry) => mapGoalExpectedTransition(entry))
    .filter((entry): entry is WorkbenchWebVerificationStateTransition => entry !== undefined);
  return Array.from(new Set(mapped));
};

const isGoalSatisfiedForResult = ({
  goal,
  result
}: {
  readonly goal?: WorkbenchWebScanAndActRequest["goal"];
  readonly result: WorkbenchWebActionResult;
}): boolean => {
  if (goal === undefined) {
    return result.ok;
  }
  const transition = actionResultStateTransition(result);
  const normalizedExpectedTransitions = normalizeGoalExpectedTransitions(
    Array.isArray(goal.expectedTransitions)
      ? goal.expectedTransitions as readonly string[]
      : undefined
  );
  if (normalizedExpectedTransitions.length > 0) {
    if (transition === undefined || !normalizedExpectedTransitions.includes(transition)) {
      return false;
    }
  }
  if (goal.mustAdvance === true) {
    if (result.ok !== true || isVerifiedActionResult(result) !== true) {
      return false;
    }
    if (transition === undefined || transition === "none") {
      return false;
    }
  }
  return result.ok;
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
  ...(candidate.widgetId === undefined ? {} : { widgetId: candidate.widgetId }),
  ...(candidate.ownerWidgetId === undefined ? {} : { ownerWidgetId: candidate.ownerWidgetId }),
  ...(candidate.widgetKind === undefined ? {} : { widgetKind: candidate.widgetKind }),
  ...(candidate.itemIdentity?.label === undefined ? {} : { itemLabel: candidate.itemIdentity.label }),
});

const toAgentTargetFromCandidate = ({
  tabId,
  toolCallId,
  owner,
  phase,
  candidate,
  pageMode,
  widgets,
}: {
  readonly tabId: string;
  readonly toolCallId: string;
  readonly owner: "agent_scan" | "agent_action" | "agent_wait";
  readonly phase: "scan" | "resolve" | "act" | "wait";
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly pageMode?: WorkbenchWebTargetScanResult["pageMode"];
  readonly widgets?: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
}) => {
  const widgetId = candidate.widgetId ?? candidate.ownerWidgetId;
  const widget = widgetId === undefined
    ? undefined
    : widgets?.find((entry) => entry.widgetId === widgetId);
  return toBrowserAgentTargetInfo({
    tabId,
    toolCallId,
    owner,
    phase,
    candidate,
    ...(widget === undefined
      ? {}
      : {
          widget: {
            widgetId: widget.widgetId,
            kind: widget.kind,
            bounds: widget.bounds,
            ...(widget.label === undefined ? {} : { label: widget.label })
          }
        }),
    ...(pageMode === undefined ? {} : { pageMode })
  });
};

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

const withResolvedCandidateTarget = (
  request: WorkbenchWebActionRequest,
  candidate: LiveSelectorScanCandidateRecord,
  scanSessionId: string
): WorkbenchWebActionRequest => {
  const action = request.action as WorkbenchWebAction & { readonly target?: Record<string, unknown> };
  if (action.target === undefined) {
    return request;
  }
  return {
    ...request,
    action: {
      ...action,
      target: {
        candidateId: candidate.candidateId,
        scanSessionId,
        nodeRef: buildNodeRef({
          candidate,
          revision: (() => {
            const currentNodeRef =
              action.target?.nodeRef !== null
              && typeof action.target?.nodeRef === "object"
              && !Array.isArray(action.target.nodeRef)
                ? action.target.nodeRef as { readonly revision?: unknown }
                : undefined;
            return typeof currentNodeRef?.revision === "string"
              ? currentNodeRef.revision
              : scanSessionId;
          })(),
          scanSessionId
        }),
        selectorAddress: candidate.selectorAddress,
        stableSignature: candidate.stableSignature,
      }
    } as WorkbenchWebAction
  };
};

const withResolvedWaitTarget = (
  request: WorkbenchWebWaitRequest,
  candidate: LiveSelectorScanCandidateRecord,
  scanSessionId: string
): WorkbenchWebWaitRequest => ({
  ...request,
  target: {
    candidateId: candidate.candidateId,
    scanSessionId,
    nodeRef: buildNodeRef({
      candidate,
      revision: (
        (request.target as { readonly nodeRef?: { readonly revision?: string } }).nodeRef?.revision
        ?? scanSessionId
      ),
      scanSessionId
    }),
    selectorAddress: candidate.selectorAddress,
    stableSignature: candidate.stableSignature,
  }
});

const isRecoverableCandidateResolutionError = (error: unknown): boolean => {
  const code = typeof (error as { readonly code?: unknown })?.code === "string"
    ? (error as { readonly code: string }).code
    : "";
  return code === "candidate_stale"
    || code === "candidate_not_found"
    || code === "scan_session_not_found"
    || code === "node_not_found";
};

const readAutomationErrorCode = (error: unknown): string =>
  typeof (error as { readonly code?: unknown })?.code === "string"
    ? (error as { readonly code: string }).code
    : "";

const readAutomationErrorMessage = (error: unknown): string =>
  typeof (error as { readonly message?: unknown })?.message === "string"
    ? (error as { readonly message: string }).message
    : "";

const isNoInteractableCandidatesError = (error: unknown): boolean =>
  readAutomationErrorCode(error) === "no_interactable_candidates";

const readActionTargetString = (
  target: Record<string, unknown> | undefined,
  key: string
): string | undefined =>
  typeof target?.[key] === "string" && (target[key] as string).trim().length > 0
    ? (target[key] as string).trim()
    : undefined;

const readActionTargetNumber = (
  target: Record<string, unknown> | undefined,
  key: string
): number | undefined =>
  typeof target?.[key] === "number" && Number.isFinite(target[key] as number)
    ? Math.max(0, Math.round(target[key] as number))
    : undefined;

const hasMeaningfulActionTargetTextHint = (value: string): boolean =>
  /[a-z0-9\u4e00-\u9fff]/i.test(normalizeText(value));

const readActionTargetTextHint = (
  target: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  const raw = readActionTargetString(target, key);
  if (raw === undefined) {
    return undefined;
  }
  return hasMeaningfulActionTargetTextHint(raw) ? raw : undefined;
};

const ACTION_TARGET_STRUCTURAL_KEYS = [
  "tagName",
  "role",
  "inputType",
  "id",
  "name",
  "testId",
  "ariaLabel"
] as const;

const ACTION_TARGET_TEXT_HINT_KEYS = [
  "text",
  "textContains",
  "textSnippet",
  "placeholder",
  "label"
] as const;

const hasExplicitActionTargetSignal = (target: Record<string, unknown> | undefined): boolean => {
  const cssSelector =
    typeof target?.cssSelector === "string" && target.cssSelector.trim().length > 0
      ? target.cssSelector.trim()
      : null;
  return typeof target?.candidateId === "string"
    || typeof target?.nodeId === "string"
    || readActionTargetNumber(target, "index") !== undefined
    || (
      target?.nodeRef !== null
      && typeof target?.nodeRef === "object"
      && !Array.isArray(target.nodeRef)
      && typeof (target.nodeRef as Record<string, unknown>).nodeId === "string"
    )
    || (target?.selectorAddress !== undefined && target.selectorAddress !== null)
    || (target?.stableSignature !== undefined && target.stableSignature !== null)
    || (cssSelector !== null && !isWeakCssSelector(cssSelector))
    || ACTION_TARGET_STRUCTURAL_KEYS.some((key) => readActionTargetString(target, key) !== undefined)
    || ACTION_TARGET_TEXT_HINT_KEYS.some((key) => readActionTargetTextHint(target, key) !== undefined);
};

const hasHardStructuredActionTargetSignal = (target: Record<string, unknown> | undefined): boolean => {
  const cssSelector =
    typeof target?.cssSelector === "string" && target.cssSelector.trim().length > 0
      ? target.cssSelector.trim()
      : null;
  return typeof target?.candidateId === "string"
    || typeof target?.nodeId === "string"
    || readActionTargetNumber(target, "index") !== undefined
    || (
      target?.nodeRef !== null
      && typeof target?.nodeRef === "object"
      && !Array.isArray(target.nodeRef)
      && typeof (target.nodeRef as Record<string, unknown>).nodeId === "string"
    )
    || (target?.selectorAddress !== undefined && target.selectorAddress !== null)
    || (target?.stableSignature !== undefined && target.stableSignature !== null)
    || (cssSelector !== null && !isWeakCssSelector(cssSelector));
};

const normalizeActionTargetValues = (values: readonly (string | undefined)[]): readonly string[] =>
  Array.from(new Set(values.map((value) => normalizeText(value)).filter((value) => value.length > 0)));

const candidateTargetValues = (
  candidate: LiveSelectorScanCandidateRecord,
  kind: "text" | "label" | "ariaLabel" | "name" | "placeholder" | "profile"
): readonly string[] => {
  switch (kind) {
    case "label":
      return normalizeActionTargetValues([
        candidate.itemIdentity?.label,
        candidate.affordanceLabel,
        candidate.ariaLabel,
        candidate.stableSignature.ariaLabel,
        candidate.stableSignature.name,
        candidate.textSnippet
      ]);
    case "ariaLabel":
      return normalizeActionTargetValues([candidate.ariaLabel, candidate.stableSignature.ariaLabel]);
    case "name":
      return normalizeActionTargetValues([
        candidate.stableSignature.name,
        candidate.itemIdentity?.label,
        candidate.affordanceLabel,
        candidate.ariaLabel
      ]);
    case "placeholder":
      return normalizeActionTargetValues([candidate.placeholder]);
    case "profile":
      return normalizeActionTargetValues([
        candidate.ariaLabel,
        candidate.textSnippet,
        candidate.itemIdentity?.label,
        candidate.affordanceLabel,
        candidate.stableSignature.id,
        candidate.stableSignature.name,
        candidate.stableSignature.testId,
        candidate.stableSignature.ariaLabel
      ]);
    case "text":
    default:
      return normalizeActionTargetValues([
        ...queryTextHaystack(candidate),
        candidate.stableSignature.testId
      ]);
  }
};

const valuesContainNeedle = (
  values: readonly string[],
  needle: string
): boolean => values.some((value) => value.includes(needle) || needle.includes(value));

const semanticRoleMatchesTarget = (
  candidate: LiveSelectorScanCandidateRecord,
  targetRole: string
): boolean => {
  const normalizedRole = normalizeText(targetRole);
  if (normalizedRole.length === 0) {
    return false;
  }
  const candidateRoles = normalizeActionTargetValues([
    candidate.role,
    inferCandidateSemanticRole(candidate)
  ]);
  if (candidateRoles.includes(normalizedRole)) {
    return true;
  }
  if (
    normalizedRole === "navigation"
    && ["sidebar", "history-list", "history-item", "navigation", "list", "list-item"].includes(candidate.widgetKind ?? "")
  ) {
    return true;
  }
  return false;
};

const signatureScoreForActionTarget = (
  candidate: LiveSelectorScanCandidateRecord,
  target: {
    readonly tagName: string | undefined;
    readonly role: string | undefined;
    readonly inputType: string | undefined;
    readonly id: string | undefined;
    readonly name: string | undefined;
    readonly testId: string | undefined;
    readonly ariaLabel: string | undefined;
  }
): number => {
  let score = 0;
  const scoreField = ({
    candidateValue,
    targetValue,
    exactWeight,
    fuzzyWeight,
    allowSemanticRole = false,
    penalizeMismatch = true
  }: {
    readonly candidateValue: string | undefined;
    readonly targetValue: string | undefined;
    readonly exactWeight: number;
    readonly fuzzyWeight?: number;
    readonly allowSemanticRole?: boolean;
    readonly penalizeMismatch?: boolean;
  }) => {
    const normalizedTarget = normalizeText(targetValue);
    if (normalizedTarget.length === 0) {
      return;
    }
    const normalizedCandidate = normalizeText(candidateValue);
    if (normalizedCandidate === normalizedTarget) {
      score += exactWeight;
      return;
    }
    if (allowSemanticRole && semanticRoleMatchesTarget(candidate, normalizedTarget)) {
      score += exactWeight;
      return;
    }
    if (fuzzyWeight !== undefined && normalizedCandidate.length > 0 && (
      normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)
    )) {
      score += fuzzyWeight;
      return;
    }
    if (penalizeMismatch) {
      score -= exactWeight;
    }
  };

  scoreField({
    candidateValue: candidate.tagName,
    targetValue: target.tagName,
    exactWeight: 22
  });
  scoreField({
    candidateValue: candidate.role,
    targetValue: target.role,
    exactWeight: 28,
    fuzzyWeight: 14,
    allowSemanticRole: true
  });
  scoreField({
    candidateValue: candidate.inputType,
    targetValue: target.inputType,
    exactWeight: 18
  });
  scoreField({
    candidateValue: candidate.stableSignature.id,
    targetValue: target.id,
    exactWeight: 68,
    fuzzyWeight: 24
  });
  scoreField({
    candidateValue: candidate.stableSignature.name,
    targetValue: target.name,
    exactWeight: 46,
    fuzzyWeight: 18
  });
  scoreField({
    candidateValue: candidate.stableSignature.testId,
    targetValue: target.testId,
    exactWeight: 84,
    fuzzyWeight: 28
  });
  scoreField({
    candidateValue: candidate.stableSignature.ariaLabel ?? candidate.ariaLabel,
    targetValue: target.ariaLabel,
    exactWeight: 44,
    fuzzyWeight: 18,
    penalizeMismatch: false
  });
  return score;
};

const hasSidebarHistoryIntent = (target: Record<string, unknown> | undefined): boolean =>
  normalizeActionTargetValues([
    readActionTargetString(target, "role"),
    readActionTargetString(target, "ariaLabel"),
    readActionTargetTextHint(target, "text"),
    readActionTargetTextHint(target, "textContains"),
    readActionTargetTextHint(target, "textSnippet"),
    readActionTargetTextHint(target, "label"),
    readActionTargetString(target, "name"),
    readActionTargetString(
      target?.stableSignature !== null && typeof target?.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "ariaLabel"
    ),
    readActionTargetString(
      target?.stableSignature !== null && typeof target?.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "testId"
    )
  ]).some((value) =>
    value.includes("sidebar")
    || value.includes("history")
    || value.includes("chat history")
    || value.includes("recents")
    || value.includes("conversation")
    || value.includes("navigation")
  );

const hasSearchSemanticHint = (value: string): boolean =>
  value.includes("search")
  || value.includes("find")
  || value.includes("lookup")
  || value.includes("查找")
  || value.includes("搜索")
  || value.includes("检索");

const hasComposerSemanticHint = (value: string): boolean =>
  value.includes("chat")
  || value.includes("message")
  || value.includes("reply")
  || value.includes("prompt")
  || value.includes("composer")
  || value.includes("ask")
  || value.includes("question")
  || value.includes("input")
  || value.includes("输入")
  || value.includes("消息")
  || value.includes("提问")
  || value.includes("对话")
  || value.includes("发送");

const isTypingActionKind = (actionKind: WorkbenchWebAction["kind"] | undefined): boolean =>
  actionKind === "type" || actionKind === "clear_and_type";

const inferTypingTargetSemantics = ({
  target,
  action
}: {
  readonly target: Record<string, unknown>;
  readonly action?: WorkbenchWebAction;
}): {
  readonly searchIntent: boolean;
  readonly composerIntent: boolean;
  readonly submitIntent: boolean;
} => {
  const values = normalizeActionTargetValues([
    readActionTargetString(target, "id"),
    readActionTargetString(target, "name"),
    readActionTargetString(target, "testId"),
    readActionTargetString(target, "ariaLabel"),
    readActionTargetTextHint(target, "label"),
    readActionTargetTextHint(target, "text"),
    readActionTargetTextHint(target, "textContains"),
    readActionTargetTextHint(target, "placeholder"),
    readActionTargetString(target, "selectorPreview"),
    readActionTargetString(
      target.stableSignature !== null && typeof target.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "id"
    ),
    readActionTargetString(
      target.stableSignature !== null && typeof target.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "name"
    ),
    readActionTargetString(
      target.stableSignature !== null && typeof target.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "ariaLabel"
    )
  ]);

  const searchIntent = values.some((value) => hasSearchSemanticHint(value));
  const composerIntent = values.some((value) => hasComposerSemanticHint(value));
  const submitIntent = action?.kind === "type" || action?.kind === "clear_and_type"
    ? action.submit === true
    : false;

  return {
    searchIntent,
    composerIntent,
    submitIntent
  };
};

const isProfileLikeCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean =>
  candidateTargetValues(candidate, "profile").some((value) =>
    value.includes("profile")
    || value.includes("account")
    || value.includes("avatar")
    || value.includes("user menu")
  );

const scoreActionTargetCandidate = ({
  actionKind,
  action,
  target,
  candidate
}: {
  readonly actionKind: WorkbenchWebAction["kind"] | undefined;
  readonly action?: WorkbenchWebAction;
  readonly target: Record<string, unknown>;
  readonly candidate: LiveSelectorScanCandidateRecord;
}): number => {
  let score = 0;
  let matchedSignal = false;

  if (typeof target.candidateId === "string" && target.candidateId === candidate.candidateId) {
    return 500;
  }
  if (
    target.nodeRef !== null
    && typeof target.nodeRef === "object"
    && !Array.isArray(target.nodeRef)
    && typeof (target.nodeRef as Record<string, unknown>).nodeId === "string"
    && (target.nodeRef as Record<string, unknown>).nodeId === candidate.candidateId
  ) {
    return 500;
  }
  if (typeof target.nodeId === "string" && target.nodeId === candidate.candidateId) {
    return 480;
  }
  if (
    target.selectorAddress !== null
    && typeof target.selectorAddress === "object"
    && !Array.isArray(target.selectorAddress)
  ) {
    const selectorAddress = target.selectorAddress as Record<string, unknown>;
    matchedSignal = true;
    if (
      selectorAddress.frameTreeNodeId === candidate.selectorAddress.frameTreeNodeId
      && selectorAddress.path === candidate.selectorAddress.path
    ) {
      return 460;
    }
    score -= 160;
  }
  if (typeof target.cssSelector === "string" && target.cssSelector.trim().length > 0) {
    matchedSignal = true;
    score += candidate.selectorPreview === target.cssSelector.trim() ? 54 : -28;
  }

  const targetSignatureSource =
    target.stableSignature !== null && typeof target.stableSignature === "object" && !Array.isArray(target.stableSignature)
      ? target.stableSignature as Record<string, unknown>
      : target;
  const signatureScore = signatureScoreForActionTarget(candidate, {
    tagName: readActionTargetString(targetSignatureSource, "tagName"),
    role: readActionTargetString(targetSignatureSource, "role"),
    inputType: readActionTargetString(targetSignatureSource, "inputType"),
    id: readActionTargetString(targetSignatureSource, "id"),
    name: readActionTargetString(targetSignatureSource, "name"),
    testId: readActionTargetString(targetSignatureSource, "testId"),
    ariaLabel: readActionTargetString(targetSignatureSource, "ariaLabel")
  });
  if (signatureScore !== 0) {
    matchedSignal = true;
    score += signatureScore;
  }

  const scoreTextField = ({
    values,
    targetValue,
    exactWeight,
    containsWeight,
    mismatchWeight
  }: {
    readonly values: readonly string[];
    readonly targetValue: string | undefined;
    readonly exactWeight: number;
    readonly containsWeight: number;
    readonly mismatchWeight: number;
  }) => {
    const normalizedTarget = normalizeText(targetValue);
    if (normalizedTarget.length === 0) {
      return;
    }
    matchedSignal = true;
    if (values.includes(normalizedTarget)) {
      score += exactWeight;
      return;
    }
    if (valuesContainNeedle(values, normalizedTarget)) {
      score += containsWeight;
      return;
    }
    score -= mismatchWeight;
  };

  scoreTextField({
    values: candidateTargetValues(candidate, "text"),
    targetValue: readActionTargetTextHint(target, "text"),
    exactWeight: 48,
    containsWeight: 26,
    mismatchWeight: 28
  });
  scoreTextField({
    values: candidateTargetValues(candidate, "text"),
    targetValue: readActionTargetTextHint(target, "textContains") ?? readActionTargetTextHint(target, "textSnippet"),
    exactWeight: 38,
    containsWeight: 22,
    mismatchWeight: 18
  });
  scoreTextField({
    values: candidateTargetValues(candidate, "text"),
    targetValue: readActionTargetTextHint(target, "ariaLabel"),
    exactWeight: 24,
    containsWeight: 14,
    mismatchWeight: 6
  });
  scoreTextField({
    values: candidateTargetValues(candidate, "placeholder"),
    targetValue: readActionTargetTextHint(target, "placeholder"),
    exactWeight: 34,
    containsWeight: 18,
    mismatchWeight: 20
  });
  scoreTextField({
    values: candidateTargetValues(candidate, "label"),
    targetValue: readActionTargetTextHint(target, "label"),
    exactWeight: 34,
    containsWeight: 18,
    mismatchWeight: 20
  });

  if (hasSidebarHistoryIntent(target)) {
    matchedSignal = true;
    score += ["sidebar", "history-list", "history-item", "navigation", "list", "list-item"].includes(candidate.widgetKind ?? "")
      ? 46
      : -18;
    if (actionKind === "expand_probe" && candidate.widgetKind === "menu-trigger") {
      score -= 14;
    }
    if (isProfileLikeCandidate(candidate)) {
      score -= 96;
    }
  }

  if (isTypingActionKind(actionKind)) {
    matchedSignal = true;
    const typingSemantics = inferTypingTargetSemantics({
      target,
      ...(action === undefined ? {} : { action })
    });
    const candidateTextProfile = candidateTargetValues(candidate, "profile");
    const candidateLooksSearch =
      candidate.widgetKind === "search-bar"
      || candidateTextProfile.some((value) => hasSearchSemanticHint(value));
    const candidateLooksComposer =
      candidate.widgetKind === "composer"
      || candidate.widgetKind === "chat-composer"
      || candidate.widgetKind === "form"
      || candidateTextProfile.some((value) => hasComposerSemanticHint(value));

    if (candidate.interactable.typable) {
      score += 28;
    } else {
      score -= 72;
    }
    if (candidate.widgetKind === "search-bar") {
      score -= 18;
    }
    if (candidateLooksComposer) {
      score += 20;
    }
    if (candidate.bounds.height >= 44) {
      score += 8;
    }
    if (candidate.bounds.height <= 32) {
      score -= 10;
    }
    if (candidate.bounds.width >= 240) {
      score += 6;
    }

    if (typingSemantics.searchIntent) {
      score += candidateLooksSearch ? 36 : -18;
    }

    if (typingSemantics.composerIntent || typingSemantics.submitIntent) {
      score += candidateLooksComposer ? 34 : -16;
      score += candidateLooksSearch ? -52 : 0;
      score += candidate.bounds.y >= 280 ? 12 : -14;
    }
  }

  score += candidate.visibilityState === "visible" ? 4 : 0;
  score += candidate.keyboardReachable !== false ? 3 : 0;
  score += candidate.withinCurrentWorkflow === true ? 4 : 0;

  if (!matchedSignal) {
    return Number.NEGATIVE_INFINITY;
  }
  return score;
};

const findBestActionTargetCandidate = ({
  candidates,
  target,
  actionKind,
  action
}: {
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly target: Record<string, unknown>;
  readonly actionKind: WorkbenchWebAction["kind"] | undefined;
  readonly action?: WorkbenchWebAction;
}): LiveSelectorScanCandidateRecord | undefined => {
  const scoredCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: scoreActionTargetCandidate({
        actionKind,
        ...(action === undefined ? {} : { action }),
        target,
        candidate
      })
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);

  const targetIndex = readActionTargetNumber(target, "index");
  if (targetIndex !== undefined) {
    const indexed = scoredCandidates[targetIndex];
    return indexed !== undefined && indexed.score >= 8
      ? indexed.candidate
      : undefined;
  }

  const best = scoredCandidates[0];
  return best !== undefined && best.score >= 18
    ? best.candidate
    : undefined;
};

const hasTextualActionTargetHints = (target: Record<string, unknown> | undefined): boolean =>
  normalizeActionTargetValues([
    readActionTargetTextHint(target, "text"),
    readActionTargetTextHint(target, "textContains"),
    readActionTargetTextHint(target, "textSnippet"),
    readActionTargetString(target, "ariaLabel"),
    readActionTargetTextHint(target, "label"),
    readActionTargetString(target, "name"),
    readActionTargetTextHint(target, "placeholder"),
    readActionTargetString(target, "testId"),
    readActionTargetString(
      target?.stableSignature !== null && typeof target?.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "ariaLabel"
    ),
    readActionTargetString(
      target?.stableSignature !== null && typeof target?.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "testId"
    )
  ]).length > 0;

const buildExplicitTargetRecoveryIntent = ({
  target,
  actionKind
}: {
  readonly target: Record<string, unknown>;
  readonly actionKind: WorkbenchWebAction["kind"] | undefined;
}): WorkbenchWebTargetIntent => {
  const targetSignature =
    target.stableSignature !== null && typeof target.stableSignature === "object"
      ? target.stableSignature as Record<string, unknown>
      : undefined;
  const tagName = readActionTargetString(target, "tagName") ?? readActionTargetString(targetSignature, "tagName");
  const role = readActionTargetString(target, "role") ?? readActionTargetString(targetSignature, "role");
  const operation: WorkbenchWebTargetIntent["operation"] =
    actionKind === "type" || actionKind === "clear_and_type"
      ? "type"
      : actionKind === "focus" || actionKind === "press_key" || actionKind === "scroll_into_view"
        ? "focus"
        : actionKind === "select_option"
          ? "select"
          : actionKind === "hover"
            ? "hover"
            : actionKind === "submit_form"
              ? "submit"
              : "click";
  return {
    operation,
    desiredTags: [tagName ?? "button", "a", "input", "textarea", "div"],
    desiredRoles: [role ?? "button", "link", "menuitem", "textbox", "option"],
    textHints: normalizeActionTargetValues([
      readActionTargetTextHint(target, "text"),
      readActionTargetTextHint(target, "textContains"),
      readActionTargetTextHint(target, "textSnippet"),
      readActionTargetString(target, "ariaLabel"),
      readActionTargetTextHint(target, "label"),
      readActionTargetString(target, "name"),
      readActionTargetString(targetSignature, "ariaLabel"),
      readActionTargetString(targetSignature, "testId")
    ]),
    placeholderHints: normalizeActionTargetValues([
      readActionTargetTextHint(target, "placeholder")
    ]),
    ...(operation === "type" || operation === "focus" ? { allowContentEditable: true } : {})
  };
};

// --- Inline Micro-Retry: auto-recover from stale DOM references without LLM round-trip ---

const isRetriableActionError = (error: unknown): boolean => {
  const code = readAutomationErrorCode(error);
  const message = readAutomationErrorMessage(error).toLowerCase();
  return code === "node_not_found"
    || code === "not_interactable"
    || code === "element_not_stable"
    || code === "pointer_intercepted"
    || code === "script_execution_timeout"
    || code === "script_execution_failed"
    || code === "cross_origin_frame_blocked"
    || code === "CAPABILITY_INVOKE_FAILED"
    || message.includes("unknown browser frame")
    || message.includes("frame script timed out")
    || message.includes("timed out after");
};

const shouldRetryActionError = ({
  error,
  action,
  explicitTarget,
  sidebarIntent
}: {
  readonly error: unknown;
  readonly action: WorkbenchWebAction;
  readonly explicitTarget: boolean;
  readonly sidebarIntent: boolean;
}): boolean => {
  if (isRetriableActionError(error)) {
    return true;
  }
  const code = readAutomationErrorCode(error);
  return code === "workflow_not_advanced"
    && action.kind === "click"
    && explicitTarget
    && sidebarIntent;
};

/**
 * Wraps an executeWebAction call with a single micro-retry pass. When the
 * initial execution fails with a retriable error (node_not_found, etc.),
 * performs a fast visible-scope re-scan, finds the best matching candidate
 * for the same action intent, and retries immediately — all within ~200ms,
 * without any LLM round-trip.
 */
const runWithMicroRetry = async ({
  execute,
  deps,
  tabId,
  action,
  candidate,
  scanRegistry,
  context,
  agentSessions
}: {
  readonly execute: () => Promise<WorkbenchWebActionResult>;
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly action: WorkbenchWebAction;
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
}): Promise<WorkbenchWebActionResult> => {
  const targetRecord =
    (action as { readonly target?: unknown }).target !== null
    && typeof (action as { readonly target?: unknown }).target === "object"
    && !Array.isArray((action as { readonly target?: unknown }).target)
      ? (action as { readonly target: Record<string, unknown> }).target
      : undefined;
  const explicitTarget = hasExplicitActionTargetSignal(targetRecord);
  const sidebarIntent = hasSidebarHistoryIntent(targetRecord);

  try {
    return await execute();
  } catch (error) {
    if (!shouldRetryActionError({
      error,
      action,
      explicitTarget,
      sidebarIntent
    })) {
      throw error;
    }
  }

  // Fast micro-retry: re-scan visible area and find the best match
  const intent = toActionIntent(action, {
    tagName: candidate.stableSignature.tagName,
    ...(candidate.stableSignature.role === undefined ? {} : { role: candidate.stableSignature.role }),
    ...(candidate.stableSignature.ariaLabel === undefined ? {} : { ariaLabel: candidate.stableSignature.ariaLabel }),
    ...(candidate.textSnippet === undefined ? {} : { textSnippet: candidate.textSnippet })
  });
  const surfaceSession = context?.agentSessionId && context?.agentTurnId
    ? agentSessions.read(context.agentSessionId, context.agentTurnId, tabId) ?? null
    : null;

  let freshScan: Awaited<ReturnType<typeof scanScopeOnce>> | null = null;
  let freshScope: WorkbenchWebTargetScanScope = "visible";
  for (const scope of adaptiveScanScopes("visible")) {
    try {
      const scanned = await scanScopeOnce({
        deps,
        tabId,
        intent,
        scope,
        maxCandidates: scope === "expanded" ? 96 : scope === "nearby" ? 64 : 32,
        ...(surfaceSession === null ? {} : { surfaceSession })
      });
      freshScan = scanned;
      freshScope = scope;
      if (scanned.candidates.length > 0) {
        break;
      }
    } catch (error) {
      if (!isNoInteractableCandidatesError(error)) {
        throw error;
      }
    }
  }

  if (freshScan === null || freshScan.candidates.length === 0) {
    throw createWebAutomationError(
      explicitTarget ? "candidate_stale" : "node_not_found",
      explicitTarget
        ? "micro-retry re-scan did not find the explicit target in current page state"
        : "micro-retry re-scan did not find a confident match",
      "resolve_node",
      true,
      {
        details: {
          microRetryAttempted: true,
          explicitTarget,
          bestScore: 0
        }
      }
    );
  }

  const bestCandidate = explicitTarget && targetRecord !== undefined
    ? findBestActionTargetCandidate({
        candidates: freshScan.candidates,
        target: targetRecord,
        actionKind: action.kind,
        action
      })
    : rankLiveSelectorCandidates(freshScan.candidates, intent)[0];

  if (bestCandidate === undefined || (!explicitTarget && bestCandidate.score < 18)) {
    // No good match — re-throw original error context
    throw createWebAutomationError(
      explicitTarget ? "candidate_stale" : "node_not_found",
      explicitTarget
        ? "micro-retry re-scan did not find the explicit target in current page state"
        : "micro-retry re-scan did not find a confident match",
      "resolve_node",
      true,
      {
        details: {
          microRetryAttempted: true,
          explicitTarget,
          bestScore: bestCandidate?.score ?? 0
        }
      }
    );
  }

  // Register the fresh scan session and retry
  const freshSession = scanRegistry.write({
    tabId,
    scope: freshScope,
    intent,
    pageMode: freshScan.pageMode,
    widgets: freshScan.widgets,
    containerNodes: freshScan.containerNodes,
    candidates: freshScan.candidates
  });

  const retryResult = await executeWebActionWithDeadline({
    browserBridge: deps.browserBridge,
    graph: syntheticGraphFromCandidate(tabId, freshSession.scanSessionId, bestCandidate),
    request: {
      action: {
        ...action,
        target: {
          candidateId: bestCandidate.candidateId,
          scanSessionId: freshSession.scanSessionId,
          selectorAddress: bestCandidate.selectorAddress,
          stableSignature: bestCandidate.stableSignature
        }
      } as WorkbenchWebAction
    },
    ...(context?.agentSessionId && context?.agentTurnId
      ? (() => {
          const session = agentSessions.read(context.agentSessionId, context.agentTurnId, tabId);
          return session?.pointer ? { pointerState: session.pointer } : {};
        })()
      : {})
  });

  return {
    ...retryResult,
    scanSessionId: freshSession.scanSessionId,
    note: [retryResult.note, "resolved by micro-retry re-scan"].filter(Boolean).join("; ")
  };
};

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

const resolveCandidateReference = async ({
  target,
  actionKind,
  action,
  deps,
  scanRegistry,
  focusAtlasRegistry,
  tabId,
  context,
  agentSessions
}: {
  readonly target: Record<string, unknown> | undefined;
  readonly actionKind?: WorkbenchWebAction["kind"];
  readonly action?: WorkbenchWebAction;
  readonly deps?: WorkbenchWebAutomationServiceDeps;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly focusAtlasRegistry: FocusAtlasRegistry;
  readonly tabId: string;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
}): Promise<{
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
}> => {
  const nodeRef =
    target?.nodeRef !== null && typeof target?.nodeRef === "object" && !Array.isArray(target.nodeRef)
      ? target.nodeRef as Record<string, unknown>
      : undefined;
  const scanSessionId =
    typeof target?.scanSessionId === "string"
      ? target.scanSessionId
      : typeof nodeRef?.scanSessionId === "string"
        ? nodeRef.scanSessionId
        : null;
  const candidateId =
    typeof target?.candidateId === "string"
      ? target.candidateId
      : typeof nodeRef?.nodeId === "string"
        ? nodeRef.nodeId
        : null;
  const revision = typeof nodeRef?.revision === "string" ? nodeRef.revision : undefined;
  const atlasEntry = focusAtlasRegistry.read(tabId);
  const agentSession = readAgentSession(agentSessions, context, tabId);
  const preferredScanSessionId =
    scanSessionId
    ?? agentSession?.scanSessionId
    ?? atlasEntry?.preferredScanSessionId;
  const revisionMismatch =
    revision !== undefined
    && atlasEntry !== null
    && atlasEntry.atlas.version !== revision;

  if (revision !== undefined) {
    if (revisionMismatch && !hasExplicitActionTargetSignal(target)) {
      throw createWebAutomationError(
        "candidate_stale",
        "nodeRef revision is stale for the active page skeleton",
        "resolve_node",
        true,
        {
          details: {
            expectedRevision: revision,
            currentRevision: atlasEntry?.atlas.version
          }
        }
      );
    }
  }

  if (scanSessionId !== null && revisionMismatch !== true && candidateId !== null) {
    const candidate = scanRegistry.readCandidate(scanSessionId, candidateId);
    if (candidate !== null) {
      return { scanSessionId, candidate };
    }
  }

  if (agentSession?.scanSessionId && revisionMismatch !== true && candidateId !== null) {
      const candidate = scanRegistry.readCandidate(agentSession.scanSessionId, candidateId);
      if (candidate !== null) {
        return {
          scanSessionId: agentSession.scanSessionId,
          candidate
        };
      }
  }

  if (candidateId !== null && revisionMismatch !== true) {
    const recentCandidate = scanRegistry.readRecentCandidate(candidateId, {
      tabId,
      ...(preferredScanSessionId === undefined ? {} : { preferredScanSessionId })
    });
    if (recentCandidate !== null) {
      return recentCandidate;
    }
  }

  if (target !== undefined && hasExplicitActionTargetSignal(target)) {
    const matched = scanRegistry.findRecentCandidate({
      tabId,
      ...(preferredScanSessionId === undefined ? {} : { preferredScanSessionId }),
      match: (candidate) => scoreActionTargetCandidate({
        actionKind,
        ...(action === undefined ? {} : { action }),
        target,
        candidate
      })
    });
    if (matched !== null) {
      return matched;
    }

    if (deps !== undefined) {
      const recoveryIntent = buildExplicitTargetRecoveryIntent({
        target,
        actionKind
      });
      const tryRecoveryScan = async (scope: WorkbenchWebTargetScanScope) => {
        const recovered = await runLiveSelectorScan({
          deps,
          tabId,
          request: {
            tabId,
            intent: recoveryIntent,
            scope,
            maxCandidates: scope === "expanded" ? 96 : 64
          },
          registry: scanRegistry,
          ...(context === undefined ? {} : { context }),
          agentSessions,
          focusAtlasRegistry
        }).catch(() => null);
        if (recovered === null) {
          return null;
        }
        const recoveredCandidate = findBestActionTargetCandidate({
          candidates: recovered.candidates as readonly LiveSelectorScanCandidateRecord[],
          target,
          actionKind,
          ...(action === undefined ? {} : { action })
        });
        if (recoveredCandidate === undefined) {
          return null;
        }
        return {
          scanSessionId: recovered.scanSessionId,
          candidate: recoveredCandidate
        };
      };

      const visibleRecovered = await tryRecoveryScan("visible");
      if (visibleRecovered !== null) {
        return visibleRecovered;
      }
      if (hasTextualActionTargetHints(target)) {
        const expandedRecovered = await tryRecoveryScan("expanded");
        if (expandedRecovered !== null) {
          return expandedRecovered;
        }
      }
    }
  }

  if (candidateId === null) {
    throw createWebAutomationError(
      "candidate_not_found",
      "action target did not resolve to a known node in the active workflow context",
      "resolve_node",
      true
    );
  }

  if (revisionMismatch) {
    throw createWebAutomationError(
      "candidate_stale",
      "nodeRef revision is stale for the active page skeleton",
      "resolve_node",
      true,
      {
        details: {
          expectedRevision: revision,
          currentRevision: atlasEntry?.atlas.version
        }
      }
    );
  }

  throw createWebAutomationError(
    "candidate_stale",
    "candidate target is no longer available in the active workflow context",
    "resolve_node",
    true
  );
};

const resolveCandidateFromAction = async ({
  deps,
  request,
  scanRegistry,
  focusAtlasRegistry,
  tabId,
  context,
  agentSessions
}: {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly request: WorkbenchWebActionRequest;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly focusAtlasRegistry: FocusAtlasRegistry;
  readonly tabId: string;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
}): Promise<{
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
}> =>
  resolveCandidateReference({
    target: (request.action as { readonly target?: Record<string, unknown> }).target,
    actionKind: request.action.kind,
    action: request.action,
    deps,
    scanRegistry,
    focusAtlasRegistry,
    tabId,
  ...(context === undefined ? {} : { context }),
  agentSessions
  });

const resolveImplicitRecentCandidateFromContext = ({
  request,
  scanRegistry,
  tabId,
  context,
  agentSessions
}: {
  readonly request: WorkbenchWebActionRequest;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly tabId: string;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
}): {
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly scanSession: LiveSelectorScanSession;
} | null => {
  const target = (request.action as { readonly target?: Record<string, unknown> }).target;
  if (hasExplicitActionTargetSignal(target)) {
    return null;
  }
  const cssSelector =
    typeof target?.cssSelector === "string" && target.cssSelector.trim().length > 0
      ? target.cssSelector.trim()
      : null;
  if (
    typeof target?.nodeId === "string"
    || (target?.selectorAddress !== undefined && target.selectorAddress !== null)
    || (
      target?.stableSignature !== undefined
      && target.stableSignature !== null
      && !isWeakStableSignatureTarget(target.stableSignature)
    )
    || (cssSelector !== null && !isWeakCssSelector(cssSelector))
  ) {
    return null;
  }
  if (!context?.agentSessionId || !context.agentTurnId) {
    return null;
  }

  const agentSession = agentSessions.read(context.agentSessionId, context.agentTurnId, tabId);
  if (!agentSession?.scanSessionId) {
    return null;
  }

  const scanSession = scanRegistry.read(agentSession.scanSessionId);
  if (scanSession === null || scanSession.candidates.length === 0) {
    return null;
  }

  const ranked = rankLiveSelectorCandidates(scanSession.candidates, toActionIntent(request.action));
  const bestCandidate = ranked[0];
  if (bestCandidate === undefined) {
    return null;
  }
  const secondCandidate = ranked[1];
  const confidenceMargin = secondCandidate === undefined ? bestCandidate.score : bestCandidate.score - secondCandidate.score;
  if (bestCandidate.score < 18 && confidenceMargin < 8) {
    return null;
  }

  return {
    scanSessionId: scanSession.scanSessionId,
    candidate: bestCandidate,
    scanSession
  };
};

const resolveWorkflowCandidateFromContext = async ({
  request,
  scanRegistry,
  deps,
  tabId,
  context,
  agentSessions,
  focusAtlasRegistry
}: {
  readonly request: WorkbenchWebActionRequest;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  readonly focusAtlasRegistry: FocusAtlasRegistry;
}): Promise<{
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly scanSession: LiveSelectorScanSession;
} | null> => {
  const target = (request.action as { readonly target?: Record<string, unknown> }).target;
  const hasExplicitTarget = hasExplicitActionTargetSignal(target);
  const hasHardStructuredTarget = hasHardStructuredActionTargetSignal(target);

  const agentSession = readAgentSession(agentSessions, context, tabId);
  const widgetId = agentSession?.activeItemId ?? agentSession?.activeWidgetId ?? agentSession?.hoveredWidgetId;

  const rescanned = await runAdaptiveLiveSelectorScan({
    deps,
    tabId,
    request: {
      tabId,
      intent: toActionIntent(request.action),
      ...(widgetId === undefined ? {} : { widgetId }),
      scope: "visible",
      maxCandidates: 24
    },
    registry: scanRegistry,
    ...(context === undefined ? {} : { context }),
    agentSessions,
    focusAtlasRegistry
  }).catch(() => null);
  if (rescanned?.bestCandidate === undefined) {
    return null;
  }

  const scanSession = scanRegistry.read(rescanned.scanSessionId);
  if (scanSession === null) {
    return null;
  }

  let candidate = scanRegistry.readCandidate(rescanned.scanSessionId, rescanned.bestCandidate.candidateId);
  if (candidate === null) {
    return null;
  }
  if (target !== undefined && hasExplicitTarget) {
    const matched = findBestActionTargetCandidate({
      candidates: rescanned.candidates as readonly LiveSelectorScanCandidateRecord[],
      target,
      actionKind: request.action.kind,
      action: request.action
    });
    if (matched !== undefined) {
      candidate = matched;
    } else if (hasHardStructuredTarget) {
      return null;
    }
  }

  return {
    scanSessionId: rescanned.scanSessionId,
    candidate,
    scanSession
  };
};

const matchesStableSignature = (
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

const resolvePrimaryRegionCandidate = ({
  focusAtlas,
  candidates,
  regionId
}: {
  readonly focusAtlas: WorkbenchWebFocusAtlas;
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly regionId: string;
}): LiveSelectorScanCandidateRecord | undefined => {
  const region = focusAtlas.regions.find((entry) => entry.regionId === regionId);
  if (region === undefined) {
    return undefined;
  }
  const nodeId = region.primaryControlId ?? region.nodeIds[0];
  const candidateId = focusAtlas.nodes.find((node) => node.focusNodeId === nodeId)?.candidateId;
  if (candidateId !== undefined) {
    const matched = candidates.find((candidate) => candidate.candidateId === candidateId);
    if (matched !== undefined) {
      return matched;
    }
  }
  return candidates.find((candidate) => candidate.focusRegionId === regionId);
};

const resolveFocusProbeCandidate = async ({
  deps,
  tabId,
  request,
  context,
  agentSessions,
  scanRegistry,
  focusAtlasRegistry
}: {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly tabId: string;
  readonly request: WorkbenchWebFocusProbeRequest;
  readonly context?: WorkbenchWebAutomationCallContext;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly focusAtlasRegistry: FocusAtlasRegistry;
}): Promise<{
  readonly strategy: WorkbenchWebFocusProbeResult["diagnostics"]["strategy"];
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly scanSession: LiveSelectorScanSession | null;
  readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
  readonly focusAtlas: WorkbenchWebFocusAtlas;
  readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
}> => {
  const session = readAgentSession(agentSessions, context, tabId);
  const targetRecord = request.target !== undefined
    ? request.target as unknown as Record<string, unknown>
    : undefined;
  const preferredCandidateId = typeof targetRecord?.candidateId === "string"
    && targetRecord.candidateId.trim().length > 0
    ? targetRecord.candidateId.trim()
    : (
      targetRecord?.nodeRef !== null
      && typeof targetRecord?.nodeRef === "object"
      && !Array.isArray(targetRecord.nodeRef)
      && typeof (targetRecord.nodeRef as Record<string, unknown>).nodeId === "string"
      && ((targetRecord.nodeRef as Record<string, unknown>).nodeId as string).trim().length > 0
    )
      ? ((targetRecord.nodeRef as Record<string, unknown>).nodeId as string).trim()
    : undefined;
  const hasExplicitTargetHint = hasExplicitActionTargetSignal(targetRecord);

  if (preferredCandidateId !== undefined) {
    const resolved = await resolveCandidateReference({
      target: targetRecord,
      scanRegistry,
      focusAtlasRegistry,
      tabId,
      deps,
      ...(context === undefined ? {} : { context }),
      agentSessions
    });
    const cachedAtlas = focusAtlasRegistry.read(tabId);
    if (cachedAtlas !== null) {
      const scanSession = scanRegistry.read(resolved.scanSessionId);
      return {
        strategy: "target",
        scanSessionId: resolved.scanSessionId,
        candidate: annotateCandidateForOperability(resolved.candidate, session),
        scanSession,
        pageMode: cachedAtlas.atlas.pageMode,
        focusAtlas: cachedAtlas.atlas,
        widgets: scanSession?.widgets ?? []
      };
    }
  }

  const runProbeScan = async (
    regionId?: string,
    useSessionFocusRegion = true
  ): Promise<{
    readonly result: Awaited<ReturnType<typeof scanScopeOnce>>;
    readonly annotatedCandidates: readonly LiveSelectorScanCandidateRecord[];
    readonly scanSession: LiveSelectorScanSession;
  }> => {
    const result = await scanScopeOnce({
      deps,
      tabId,
      intent: FOCUS_ATLAS_INTENT,
      scope: "visible",
      maxCandidates: 32,
      ...(request.widgetId === undefined ? {} : { widgetId: request.widgetId }),
      ...(regionId === undefined ? {} : { regionId }),
      ...(session === null || useSessionFocusRegion === false ? {} : { surfaceSession: session })
    });
    const annotatedCandidates = annotateCandidatesForOperability(result.candidates, session);
    const scanSession = scanRegistry.write({
      tabId,
      scope: "visible",
      intent: FOCUS_ATLAS_INTENT,
      pageMode: result.pageMode,
      widgets: result.widgets,
      containerNodes: result.containerNodes,
      candidates: annotatedCandidates
    });
    return {
      result,
      annotatedCandidates,
      scanSession
    };
  };

  const resolveFromProbeScan = ({
    result,
    annotatedCandidates,
    scanSession
  }: {
    readonly result: Awaited<ReturnType<typeof scanScopeOnce>>;
    readonly annotatedCandidates: readonly LiveSelectorScanCandidateRecord[];
    readonly scanSession: LiveSelectorScanSession;
  }): {
    readonly strategy: WorkbenchWebFocusProbeResult["diagnostics"]["strategy"];
    readonly scanSessionId: string;
    readonly candidate: LiveSelectorScanCandidateRecord;
    readonly scanSession: LiveSelectorScanSession;
    readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
    readonly focusAtlas: WorkbenchWebFocusAtlas;
    readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  } | null => {
    if (targetRecord !== undefined) {
      const matched = findBestActionTargetCandidate({
        candidates: annotatedCandidates,
        target: targetRecord,
        actionKind: "focus"
      });
      if (matched !== undefined) {
        return {
          strategy: "target",
          scanSessionId: scanSession.scanSessionId,
          candidate: matched,
          scanSession,
          pageMode: result.pageMode,
          focusAtlas: result.focusAtlas,
          widgets: result.widgets
        };
      }
    }

    if (request.focusRegionId !== undefined) {
      const matched = resolvePrimaryRegionCandidate({
        focusAtlas: result.focusAtlas,
        candidates: annotatedCandidates,
        regionId: request.focusRegionId
      });
      if (matched !== undefined) {
        return {
          strategy: "focus_region",
          scanSessionId: scanSession.scanSessionId,
          candidate: matched,
          scanSession,
          pageMode: result.pageMode,
          focusAtlas: result.focusAtlas,
          widgets: result.widgets
        };
      }
    }

    if (request.widgetId !== undefined) {
      const matched = annotatedCandidates.find((candidate) =>
        candidate.widgetId === request.widgetId || candidate.ownerWidgetId === request.widgetId
      );
      if (matched !== undefined) {
        return {
          strategy: "widget",
          scanSessionId: scanSession.scanSessionId,
          candidate: matched,
          scanSession,
          pageMode: result.pageMode,
          focusAtlas: result.focusAtlas,
          widgets: result.widgets
        };
      }
    }

    const bestCandidate = annotatedCandidates[0];
    if (bestCandidate === undefined) {
      return null;
    }
    return {
      strategy: "best_candidate",
      scanSessionId: scanSession.scanSessionId,
      candidate: bestCandidate,
      scanSession,
      pageMode: result.pageMode,
      focusAtlas: result.focusAtlas,
      widgets: result.widgets
    };
  };

  const primaryProbeScan = await runProbeScan(request.focusRegionId, !hasExplicitTargetHint);
  const primaryResolved = resolveFromProbeScan(primaryProbeScan);
  if (primaryResolved !== null) {
    return primaryResolved;
  }

  if (request.focusRegionId !== undefined) {
    const fallbackProbeScan = await runProbeScan(undefined, false);
    const fallbackResolved = resolveFromProbeScan(fallbackProbeScan);
    if (fallbackResolved !== null) {
      return fallbackResolved;
    }
  }

  throw createWebAutomationError(
    "no_interactable_candidates",
    "no focusable human-operable target found for focus probe",
    "scan",
    true
  );
};

export const createWorkbenchWebAutomationService = (
  deps: WorkbenchWebAutomationServiceDeps
): WorkbenchWebAutomationService => {
  const cache = new WorkbenchWebAutomationCache();
  const store = new WorkbenchWebAutomationStore(deps.storageRoot);
  const scanRegistry = new LiveSelectorScanRegistry();
  const agentSessions = new WorkbenchAgentWebSessionRegistry();
  const focusAtlasRegistry = new FocusAtlasRegistry();
  const queryAttractorStateByTab = new Map<string, QueryAttractorState>();
  const queryIntentCueByTab = new Map<string, WorkbenchWebQueryIntentCue>();
  const scanAndActProbeCache = new Map<string, ScanAndActProbeCacheEntry>();
  let backgroundAtlasRefreshInFlight = false;

  void store.compact().catch(() => undefined);

  const rebuildFocusAtlasForTab = async ({
    tabId,
    refresh,
    session,
  }: {
    readonly tabId: string;
    readonly refresh: boolean;
    readonly session?: WorkbenchAgentWebSession | null;
  }): Promise<WorkbenchWebFocusReadResult> => {
    const cached = refresh ? null : focusAtlasRegistry.read(tabId);
    if (cached !== null) {
      return {
        tabId,
        refreshed: false,
        cached: true,
        atlas: cached.atlas,
        diagnostics: cached.diagnostics
      };
    }

    const { snapshot } = await scanLayoutIntelligenceAcrossFrames({
      deps,
      tabId,
      scope: "visible",
      intent: FOCUS_ATLAS_INTENT,
      maxNodes: 256
    });
    const built = buildFocusAtlas({
      tabId,
      snapshot,
      ...(session === undefined ? {} : { session })
    });
    focusAtlasRegistry.write(tabId, {
      atlas: built.atlas,
      diagnostics: built.diagnostics
    });
    return {
      tabId,
      refreshed: true,
      cached: false,
      atlas: built.atlas,
      diagnostics: built.diagnostics
    };
  };

  const readSharedFocusAtlasScan = ({
    tabId,
    minCandidates
  }: {
    readonly tabId: string;
    readonly minCandidates: number;
  }): {
    readonly atlasEntry: NonNullable<ReturnType<FocusAtlasRegistry["read"]>>;
    readonly scanSession: LiveSelectorScanSession;
  } | null => {
    const atlasEntry = focusAtlasRegistry.read(tabId);
    if (atlasEntry === null) {
      return null;
    }
    if (
      atlasEntry.preferredScanSessionId === undefined
      || Date.now() - atlasEntry.updatedAt > SHARED_FOCUS_SCAN_MAX_AGE_MS
    ) {
      return null;
    }
    const scanSession = scanRegistry.read(atlasEntry.preferredScanSessionId);
    if (scanSession === null) {
      return null;
    }
    if (
      scanSession.tabId !== tabId
      || scanSession.scope !== "visible"
      || scanSession.intent !== FOCUS_ATLAS_INTENT
      || scanSession.candidates.length < minCandidates
    ) {
      return null;
    }
    return {
      atlasEntry,
      scanSession
    };
  };

  const backgroundAtlasTimer = setInterval(() => {
    if (backgroundAtlasRefreshInFlight) {
      return;
    }
    const activeTabId = deps.browserBridge.readActiveTabId();
    if (activeTabId === null || activeTabId.length === 0) {
      return;
    }
    const pageState = deps.browserBridge.readPageState({ tabId: activeTabId });
    if (pageState === null || pageState.isVisible !== true) {
      return;
    }
    if (focusAtlasRegistry.isFresh(activeTabId, 1_200)) {
      return;
    }
    backgroundAtlasRefreshInFlight = true;
    void rebuildFocusAtlasForTab({
      tabId: activeTabId,
      refresh: true
    }).catch(() => undefined).finally(() => {
      backgroundAtlasRefreshInFlight = false;
    });
  }, 1_500);

  const runPostRevealContinuation = async ({
    tabId,
    request,
    result,
    sourceCandidate,
    sourceScanSession,
    sourceScanSessionId,
    context,
  }: {
    readonly tabId: string;
    readonly request: WorkbenchWebActionRequest;
    readonly result: WorkbenchWebActionResult;
    readonly sourceCandidate: LiveSelectorScanCandidateRecord;
    readonly sourceScanSession: LiveSelectorScanSession | null;
    readonly sourceScanSessionId: string;
    readonly context?: WorkbenchWebAutomationCallContext;
  }): Promise<{
    readonly result: WorkbenchWebActionResult;
    readonly scanSessionId: string;
    readonly revealDelta?: WorkbenchAgentWebSession["lastLocalDelta"];
    readonly finalCandidate: LiveSelectorScanCandidateRecord;
    readonly revealObserved: boolean;
  }> => {
    let nextResult = result;
    let effectiveScanSessionId = sourceScanSessionId;
    let revealDelta: WorkbenchAgentWebSession["lastLocalDelta"] | undefined;
    let finalCandidate = sourceCandidate;
    const transition = result.verification?.stateTransition;
    const revealObserved =
      isRevealStateTransition(transition)
      || (
        transition === "navigation_changed"
        && isActionRevealTriggerCandidate(sourceCandidate)
      );

    if (
      request.action.kind !== "click"
      || !revealObserved
      || !isActionRevealTriggerCandidate(sourceCandidate)
      || sourceScanSession === null
      || shouldResetWorkflowContext(result)
    ) {
      return {
        result: nextResult,
        scanSessionId: effectiveScanSessionId,
        ...(revealDelta === undefined ? {} : { revealDelta }),
        finalCandidate,
        revealObserved
      };
    }

    const revealed = await runActionRevealPass({
      deps,
      tabId,
      candidate: sourceCandidate,
      scanSession: sourceScanSession,
      surfaceSession: readAgentSession(agentSessions, context, tabId),
      maxMicroSteps: readMicroExecutorStepBudget(deps)
    });
    if (revealed === null) {
      return {
        result: nextResult,
        scanSessionId: effectiveScanSessionId,
        ...(revealDelta === undefined ? {} : { revealDelta }),
        finalCandidate,
        revealObserved
      };
    }

    const revealSession = scanRegistry.write({
      tabId,
      scope: "visible",
      intent: sourceScanSession.intent,
      pageMode: revealed.pageMode,
      widgets: revealed.widgets,
      containerNodes: revealed.containerNodes,
      candidates: revealed.candidates
    });
    effectiveScanSessionId = revealSession.scanSessionId;
    revealDelta = deriveLocalDeltaFromReveal({
      baseline: sourceScanSession.candidates,
      revealed: revealed.candidates.filter((entry) => entry.discoveryMode === "action_revealed"),
      workflowRegion: resolveWorkflowRegionForCandidate({
        candidate: sourceCandidate,
        widgets: sourceScanSession.widgets,
        containerNodes: sourceScanSession.containerNodes
      }),
      revealRegion: resolveHoverRevealRegion({
        seed: sourceCandidate,
        widgets: sourceScanSession.widgets,
        containerNodes: sourceScanSession.containerNodes
      })
    });

    const targetRecord = (() => {
      const rawTarget = (request.action as { readonly target?: unknown }).target;
      if (rawTarget === null || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
        return undefined;
      }
      return rawTarget as Record<string, unknown>;
    })();
    const revealedActionCandidates = revealed.candidates.filter(
      (entry) => entry.discoveryMode === "action_revealed"
    );
    const queryCue = readFreshQueryIntentCue({
      cueByTab: queryIntentCueByTab,
      tabId,
      ...(context === undefined ? {} : { context }),
      now: Date.now(),
      ttlMs: QUERY_INTENT_CUE_TTL_MS
    });
    const targetTextHints = extractActionTargetTextHints(targetRecord);
    const continuationCandidate = pickRevealContinuationCandidate({
      sourceCandidate,
      revealedCandidates: revealedActionCandidates,
      queryCue,
      targetTextHints
    });
    const continuationQueue = rankRevealContinuationCandidates({
      sourceCandidate,
      revealedCandidates: revealedActionCandidates,
      queryCue,
      targetTextHints,
      maxCandidates: Math.max(1, Math.min(readMicroExecutorStepBudget(deps), 4))
    });
    if (continuationQueue.length === 0 && continuationCandidate === undefined) {
      return {
        result: nextResult,
        scanSessionId: effectiveScanSessionId,
        ...(revealDelta === undefined ? {} : { revealDelta }),
        finalCandidate,
        revealObserved
      };
    }

    const attemptedCandidates = continuationQueue.length > 0
      ? continuationQueue
      : continuationCandidate === undefined
        ? []
        : [continuationCandidate];

    for (const followCandidate of attemptedCandidates) {
      const continuationRequest = withResolvedCandidateTarget(
        {
          tabId,
          timeoutMs: 1_900,
          action: {
            kind: "click",
            target: {
              candidateId: followCandidate.candidateId,
              scanSessionId: effectiveScanSessionId
            }
          }
        },
        followCandidate,
        effectiveScanSessionId
      );
      try {
        const continuedResult = await runWithMicroRetry({
          execute: () => executeWebActionWithDeadline({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, effectiveScanSessionId, followCandidate),
            request: continuationRequest,
            ...pointerStateForContext(agentSessions, context, tabId)
          }),
          deps,
          tabId,
          action: continuationRequest.action,
          candidate: followCandidate,
          scanRegistry,
          ...(context === undefined ? {} : { context }),
          agentSessions
        });
        const continuedRevealTransition = continuedResult.verification?.stateTransition;
        if (
          isRevealStateTransition(continuedRevealTransition)
          && isActionRevealTriggerCandidate(followCandidate)
        ) {
          nextResult = {
            ...continuedResult,
            note: [continuedResult.note, "continuation reopened menu trigger; trying alternate candidate"]
              .filter(Boolean)
              .join("; ")
          };
          continue;
        }
        nextResult = {
          ...continuedResult,
          note: [continuedResult.note, "continued from local reveal delta"].filter(Boolean).join("; ")
        };
        finalCandidate = followCandidate;
        break;
      } catch {
        // Try another locally revealed candidate before giving control back to the agent.
      }
    }

    return {
      result: nextResult,
      scanSessionId: effectiveScanSessionId,
      ...(revealDelta === undefined ? {} : { revealDelta }),
      finalCandidate,
      revealObserved
    };
  };

  const service: WorkbenchWebAutomationService = {
    dispose: () => {
      cache.clear();
      focusAtlasRegistry.clear();
      queryAttractorStateByTab.clear();
      queryIntentCueByTab.clear();
      scanAndActProbeCache.clear();
      clearInterval(backgroundAtlasTimer);
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

    readFocusAtlas: async (
      request?: WorkbenchWebFocusReadRequest,
      context?: WorkbenchWebAutomationCallContext
    ) => {
      const tabId = resolveTabId(deps, request?.tabId);
      assertActiveVisiblePage(deps, tabId);
      const session = readAgentSession(agentSessions, context, tabId);
      return await rebuildFocusAtlasForTab({
        tabId,
        refresh: request?.refresh === true,
        ...(session === null ? {} : { session })
      });
    },

    readSkeleton: async (
      request?: WorkbenchWebSkeletonReadRequest,
      context?: WorkbenchWebAutomationCallContext
    ) => {
      const tabId = resolveTabId(deps, request?.tabId);
      assertActiveVisiblePage(deps, tabId);
      const scanResult = await runLiveSelectorScan({
        deps,
        tabId,
        request: {
          tabId,
          intent: FOCUS_ATLAS_INTENT,
          scope: request?.scope ?? "visible",
          maxCandidates: Math.max(8, Math.min(64, Math.round(request?.maxNodes ?? 24)))
        },
        registry: scanRegistry,
        ...(context === undefined ? {} : { context }),
        agentSessions,
        focusAtlasRegistry
      });
      const atlasEntry = focusAtlasRegistry.read(tabId);
      if (atlasEntry === null) {
        throw createWebAutomationError(
          "invalid_request",
          "skeleton read did not produce a focus atlas",
          "scan",
          true
        );
      }
      return buildSkeletonReadResult({
        tabId,
        scanResult,
        atlas: atlasEntry.atlas
      });
    },

    querySkeleton: async (
      request?: WorkbenchWebQueryRequest,
      context?: WorkbenchWebAutomationCallContext
    ) => {
      const startedAt = Date.now();
      const tabId = resolveTabId(deps, request?.tabId);
      assertActiveVisiblePage(deps, tabId);
      const maxResults = Math.max(1, Math.min(24, Math.round(request?.maxResults ?? 6)));
      const queryIntent = buildQueryIntentFromRequest(request);
      const hasStrongQueryConstraints = (query: WorkbenchWebQueryRequest | undefined): boolean =>
        query !== undefined
        && (
          (typeof query.text === "string" && query.text.trim().length > 0)
          || (typeof query.name === "string" && query.name.trim().length > 0)
          || (typeof query.near === "string" && query.near.trim().length > 0)
          || (typeof query.within === "string" && query.within.trim().length > 0)
          || query.role !== undefined
          || query.state !== undefined
          || (typeof query.regionId === "string" && query.regionId.trim().length > 0)
          || (typeof query.groupId === "string" && query.groupId.trim().length > 0)
          || query.inDialog === true
          || query.underMenu === true
          || query.inTableRow === true
        );
      const loadQuerySnapshot = async (
        forceRefresh: boolean,
        scope: WorkbenchWebTargetScanScope = "visible"
      ): Promise<{
        readonly atlasEntry: NonNullable<ReturnType<FocusAtlasRegistry["read"]>>;
        readonly scanSessionId: string;
        readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
        readonly candidates: readonly LiveSelectorScanCandidateRecord[];
        readonly reused: boolean;
        readonly scope: WorkbenchWebTargetScanScope;
      }> => {
        if (!forceRefresh && request?.refresh !== true && scope === "visible") {
          const shared = readSharedFocusAtlasScan({
            tabId,
            minCandidates: maxResults
          });
          if (shared !== null) {
            return {
              atlasEntry: shared.atlasEntry,
              scanSessionId: shared.scanSession.scanSessionId,
              pageMode: shared.scanSession.pageMode,
              candidates: shared.scanSession.candidates,
              reused: true,
              scope
            };
          }
        }

        const scanResult = await runAdaptiveLiveSelectorScan({
          deps,
          tabId,
          request: {
            tabId,
            intent: queryIntent,
            readOnly: true,
            scope,
            ...(request?.regionId === undefined ? {} : { regionId: request.regionId }),
            maxCandidates: scope === "expanded"
              ? Math.max(48, maxResults * 8)
              : Math.max(24, maxResults * 6)
          },
          registry: scanRegistry,
          ...(context === undefined ? {} : { context }),
          agentSessions,
          focusAtlasRegistry
        });
        const atlasEntry = focusAtlasRegistry.read(tabId);
        if (atlasEntry === null) {
          throw createWebAutomationError(
            "invalid_request",
            "query did not produce a focus atlas",
            "scan",
            true
          );
        }
        return {
          atlasEntry,
          scanSessionId: scanResult.scanSessionId,
          pageMode: scanResult.pageMode,
          candidates: scanResult.candidates as readonly LiveSelectorScanCandidateRecord[],
          reused: false,
          scope
        };
      };
      const rankQueryMatches = (
        snapshot: Awaited<ReturnType<typeof loadQuerySnapshot>>
      ) => {
        const regionKindById = buildRegionKindById(snapshot.atlasEntry.atlas);
        return snapshot.candidates
          .filter((candidate) => candidateSatisfiesQuery({
            candidate,
            request: request ?? {},
            regionKindById
          }))
          .map((candidate) => ({
            candidate,
            score: queryScoreCandidate({
              candidate,
              request: request ?? {},
              regionKindById
            })
          }))
          .filter((entry) => Number.isFinite(entry.score))
          .sort((left, right) => right.score - left.score);
      };

      let snapshot = await loadQuerySnapshot(false, "visible");
      let ranked = rankQueryMatches(snapshot);
      if (ranked.length === 0 && snapshot.reused) {
        snapshot = await loadQuerySnapshot(true, "visible");
        ranked = rankQueryMatches(snapshot);
      }
      if (ranked.length === 0 && hasStrongQueryConstraints(request)) {
        const expandedSnapshot = await loadQuerySnapshot(false, "expanded");
        const expandedRanked = rankQueryMatches(expandedSnapshot);
        if (expandedRanked.length > 0) {
          snapshot = expandedSnapshot;
          ranked = expandedRanked;
        }
      }

      const revision = snapshot.atlasEntry.atlas.version;
      const guardedRanked = applyQueryAttractorGuard({
        tabId,
        request,
        ranked,
        attractorStateByTab: queryAttractorStateByTab
      });
      const indexed = request?.index === undefined ? guardedRanked : guardedRanked.slice(request.index, request.index + maxResults);
      const matches = indexed
        .slice(0, maxResults)
        .map((entry) => toSkeletonNode({
          candidate: entry.candidate,
          revision,
          scanSessionId: snapshot.scanSessionId
        }));
      const ambiguous =
        matches.length > 1
        && guardedRanked[0] !== undefined
        && guardedRanked[1] !== undefined
        && Math.abs(guardedRanked[0]!.score - guardedRanked[1]!.score) <= 6;
      const cue = captureQueryIntentCue({
        ...(request === undefined ? {} : { request }),
        ...(context === undefined ? {} : { context }),
        now: Date.now()
      });
      if (cue !== null) {
        queryIntentCueByTab.set(tabId, cue);
      }
      return {
        tabId,
        scanSessionId: snapshot.scanSessionId,
        pageMode: snapshot.pageMode,
        skeletonVersion: revision,
        ...(snapshot.atlasEntry.atlas.activeFocusRegionId === undefined
          ? {}
          : { activeRegionId: snapshot.atlasEntry.atlas.activeFocusRegionId }),
        matches,
        ...(matches[0] === undefined ? {} : { bestMatch: matches[0] }),
        ambiguous,
        querySatisfied: matches.length > 0,
        diagnostics: {
          durationMs: Date.now() - startedAt,
          candidateCount: matches.length
        }
      };
    },

    readContext: async (
      request?: WorkbenchWebContextReadRequest,
      context?: WorkbenchWebAutomationCallContext
    ) => {
      const startedAt = Date.now();
      const tabId = resolveTabId(deps, request?.tabId);
      assertActiveVisiblePage(deps, tabId);
      const scope = request?.scope ?? "neighborhood";
      const maxNodes = Math.max(1, Math.min(48, Math.round(request?.maxNodes ?? 12)));
      const loadContextSnapshot = async (forceRefresh: boolean): Promise<{
        readonly atlasEntry: NonNullable<ReturnType<FocusAtlasRegistry["read"]>>;
        readonly scanSessionId: string;
        readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
        readonly candidates: readonly LiveSelectorScanCandidateRecord[];
        readonly reused: boolean;
      }> => {
        if (!forceRefresh && request?.refresh !== true) {
          const shared = readSharedFocusAtlasScan({
            tabId,
            minCandidates: Math.max(1, Math.min(maxNodes, 24))
          });
          if (shared !== null) {
            return {
              atlasEntry: shared.atlasEntry,
              scanSessionId: shared.scanSession.scanSessionId,
              pageMode: shared.scanSession.pageMode,
              candidates: shared.scanSession.candidates,
              reused: true
            };
          }
        }

        const scanResult = await runAdaptiveLiveSelectorScan({
          deps,
          tabId,
          request: {
            tabId,
            intent: FOCUS_ATLAS_INTENT,
            scope: "visible",
            ...(request?.regionId === undefined ? {} : { regionId: request.regionId }),
            maxCandidates: Math.max(24, maxNodes * 4)
          },
          registry: scanRegistry,
          ...(context === undefined ? {} : { context }),
          agentSessions,
          focusAtlasRegistry
        });
        const atlasEntry = focusAtlasRegistry.read(tabId);
        if (atlasEntry === null) {
          throw createWebAutomationError(
            "invalid_request",
            "context read did not produce a focus atlas",
            "scan",
            true
          );
        }
        return {
          atlasEntry,
          scanSessionId: scanResult.scanSessionId,
          pageMode: scanResult.pageMode,
          candidates: scanResult.candidates as readonly LiveSelectorScanCandidateRecord[],
          reused: false
        };
      };

      let snapshot = await loadContextSnapshot(false);
      const nodeRef = request?.nodeRef;
      let revision = snapshot.atlasEntry.atlas.version;
      const staleSeedCandidate = nodeRef === undefined
        ? undefined
        : (
            nodeRef.scanSessionId === undefined
              ? scanRegistry.readRecentCandidate(nodeRef.nodeId, { tabId })?.candidate
              : scanRegistry.readCandidate(nodeRef.scanSessionId, nodeRef.nodeId)
          ) ?? undefined;
      let seedCandidate = nodeRef === undefined
        ? undefined
        : snapshot.candidates.find((candidate) => candidate.candidateId === nodeRef.nodeId);
      if (seedCandidate === undefined && staleSeedCandidate !== undefined) {
        seedCandidate = snapshot.candidates.find((candidate) =>
          candidate.focusRegionId === staleSeedCandidate.focusRegionId
          && (
            candidate.widgetId === staleSeedCandidate.widgetId
            || candidate.ownerWidgetId === staleSeedCandidate.ownerWidgetId
            || (
              nodeRef?.stableFingerprint !== undefined
              && matchesStableSignature(candidate, nodeRef.stableFingerprint as Record<string, unknown>)
            )
          )
        ) ?? staleSeedCandidate;
      }
      if (nodeRef !== undefined && nodeRef.revision !== revision) {
        if ((scope === "node" && seedCandidate?.candidateId !== nodeRef.nodeId) || seedCandidate === undefined) {
          throw createWebAutomationError(
            "candidate_stale",
            "nodeRef revision is stale for the active page skeleton",
            "resolve_node",
            true,
            {
              details: {
                expectedRevision: nodeRef.revision,
                currentRevision: revision
              }
            }
          );
        }
      }
      let regionId = request?.regionId ?? seedCandidate?.focusRegionId ?? snapshot.atlasEntry.atlas.activeFocusRegionId;
      let region = regionId === undefined
        ? undefined
        : buildSkeletonRegions({ atlas: snapshot.atlasEntry.atlas, revision }).find((entry) => entry.regionId === regionId);
      let selectedCandidates = (() => {
        switch (scope) {
          case "node":
            return seedCandidate === undefined || seedCandidate.candidateId !== nodeRef?.nodeId ? [] : [seedCandidate];
          case "region":
            return regionId === undefined
              ? snapshot.candidates.slice(0, maxNodes)
              : snapshot.candidates.filter((candidate) => candidate.focusRegionId === regionId).slice(0, maxNodes);
          case "page":
            return snapshot.candidates.slice(0, maxNodes);
          case "neighborhood":
          default: {
            const seed = seedCandidate;
            if (seed === undefined) {
              return regionId === undefined
                ? snapshot.candidates.slice(0, maxNodes)
                : snapshot.candidates.filter((candidate) => candidate.focusRegionId === regionId).slice(0, maxNodes);
            }
            return snapshot.candidates
              .filter((candidate) =>
                candidate.candidateId === seed.candidateId
                || candidate.ownerWidgetId === seed.ownerWidgetId
                || candidate.widgetId === seed.widgetId
                || candidate.focusRegionId === seed.focusRegionId
              )
              .slice(0, maxNodes);
          }
        }
      })();
      if (selectedCandidates.length === 0 && snapshot.reused) {
        snapshot = await loadContextSnapshot(true);
        revision = snapshot.atlasEntry.atlas.version;
        seedCandidate = nodeRef === undefined
          ? undefined
          : snapshot.candidates.find((candidate) => candidate.candidateId === nodeRef.nodeId);
        if (seedCandidate === undefined && staleSeedCandidate !== undefined) {
          seedCandidate = snapshot.candidates.find((candidate) =>
            candidate.focusRegionId === staleSeedCandidate.focusRegionId
            && (
              candidate.widgetId === staleSeedCandidate.widgetId
              || candidate.ownerWidgetId === staleSeedCandidate.ownerWidgetId
              || (
                nodeRef?.stableFingerprint !== undefined
                && matchesStableSignature(candidate, nodeRef.stableFingerprint as Record<string, unknown>)
              )
            )
          ) ?? staleSeedCandidate;
        }
        regionId = request?.regionId ?? seedCandidate?.focusRegionId ?? snapshot.atlasEntry.atlas.activeFocusRegionId;
        region = regionId === undefined
          ? undefined
          : buildSkeletonRegions({ atlas: snapshot.atlasEntry.atlas, revision }).find((entry) => entry.regionId === regionId);
        selectedCandidates = (() => {
          switch (scope) {
            case "node":
              return seedCandidate === undefined ? [] : [seedCandidate];
            case "region":
              return regionId === undefined
                ? snapshot.candidates.slice(0, maxNodes)
                : snapshot.candidates.filter((candidate) => candidate.focusRegionId === regionId).slice(0, maxNodes);
            case "page":
              return snapshot.candidates.slice(0, maxNodes);
            case "neighborhood":
            default: {
              const seed = seedCandidate;
              if (seed === undefined) {
                return regionId === undefined
                  ? snapshot.candidates.slice(0, maxNodes)
                  : snapshot.candidates.filter((candidate) => candidate.focusRegionId === regionId).slice(0, maxNodes);
              }
              return snapshot.candidates
                .filter((candidate) =>
                  candidate.candidateId === seed.candidateId
                  || candidate.ownerWidgetId === seed.ownerWidgetId
                  || candidate.widgetId === seed.widgetId
                  || candidate.focusRegionId === seed.focusRegionId
                )
                .slice(0, maxNodes);
            }
          }
        })();
      }
      const nodes = selectedCandidates.map((candidate) => toSkeletonNode({
        candidate,
        revision,
        scanSessionId: snapshot.scanSessionId
      }));
      const node = seedCandidate === undefined
        ? undefined
        : toSkeletonNode({
            candidate: seedCandidate,
            revision,
            scanSessionId: snapshot.scanSessionId
          });

      return {
        tabId,
        scanSessionId: snapshot.scanSessionId,
        pageMode: snapshot.pageMode,
        skeletonVersion: revision,
        ...(snapshot.atlasEntry.atlas.activeFocusRegionId === undefined
          ? {}
          : { activeRegionId: snapshot.atlasEntry.atlas.activeFocusRegionId }),
        scope,
        ...(node === undefined ? {} : { node }),
        ...(region === undefined ? {} : { region }),
        nodes,
        diagnostics: {
          durationMs: Date.now() - startedAt,
          candidateCount: nodes.length,
          regionCount: snapshot.atlasEntry.atlas.regions.length
        }
      };
    },

    readOperability: async (
      request?: WorkbenchWebOperabilityReadRequest,
      context?: WorkbenchWebAutomationCallContext
    ) => {
      const tabId = resolveTabId(deps, request?.tabId);
      assertActiveVisiblePage(deps, tabId);
      const scope = request?.scope ?? "visible";
      const maxTargets = Math.max(1, Math.min(48, Math.round(request?.maxTargets ?? 12)));
      const result = await runLiveSelectorScan({
        deps,
        tabId,
        request: {
          tabId,
          intent: FOCUS_ATLAS_INTENT,
          scope,
          maxCandidates: maxTargets
        },
        registry: scanRegistry,
        ...(context === undefined ? {} : { context }),
        agentSessions,
        focusAtlasRegistry
      });
      const atlasEntry = focusAtlasRegistry.read(tabId);
      if (atlasEntry === null) {
        throw createWebAutomationError(
          "invalid_request",
          "operability read did not produce a focus atlas",
          "scan",
          true
        );
      }
      return {
        tabId,
        scanSessionId: result.scanSessionId,
        scope: result.scope,
        pageMode: result.pageMode,
        focusAtlasReady: true,
        focusAtlasVersion: atlasEntry.atlas.version,
        ...(atlasEntry.atlas.activeFocusRegionId === undefined
          ? {}
          : { activeFocusRegionId: atlasEntry.atlas.activeFocusRegionId }),
        atlas: atlasEntry.atlas,
        regions: atlasEntry.atlas.regions,
        ...(result.surface === undefined ? {} : { surface: result.surface }),
        widgets: result.widgets ?? [],
        ...(result.bestCandidate === undefined ? {} : { bestCandidate: result.bestCandidate }),
        ...(result.bestCandidate === undefined ? {} : { primaryTarget: result.bestCandidate }),
        topTargets: result.candidates,
        candidates: result.candidates,
        truncated: result.truncated,
        ...(result.continuationToken === undefined
          ? {}
          : { continuationToken: result.continuationToken }),
        intervention: {
          mode: "none",
          label: "Lyra analyzed the page without taking control",
          detail: "read-only operability analysis"
        },
        diagnostics: result.diagnostics
      };
    },

    probeFocus: async (
      request?: WorkbenchWebFocusProbeRequest,
      context?: WorkbenchWebAutomationCallContext
    ) => {
      const startedAt = Date.now();
      const tabId = resolveTabId(deps, request?.tabId);
      assertActiveVisiblePage(deps, tabId);
      const surfaceSession = readAgentSession(agentSessions, context, tabId);
      const resolved = await resolveFocusProbeCandidate({
        deps,
        tabId,
        request: request ?? {},
        ...(context === undefined ? {} : { context }),
        agentSessions,
        scanRegistry,
        focusAtlasRegistry
      });
      let overlayShown = false;
      if (context?.toolCallId) {
        overlayShown = await showAgentSelectorTarget(
          deps.browserBridge,
          toAgentTargetFromCandidate({
            tabId,
            toolCallId: context.toolCallId,
            owner: "agent_action",
            phase: "resolve",
            candidate: resolved.candidate,
            pageMode: resolved.pageMode,
            widgets: resolved.widgets
          })
        ).catch(() => false);
      }
      const action = await runWithMicroRetry({
        execute: () => executeWebActionWithDeadline({
          browserBridge: deps.browserBridge,
          graph: syntheticGraphFromCandidate(tabId, resolved.scanSessionId, resolved.candidate),
          request: withResolvedCandidateTarget(
            {
              tabId,
              action: {
                kind: "focus",
                target: {
                  candidateId: resolved.candidate.candidateId,
                  scanSessionId: resolved.scanSessionId
                }
              }
            },
            resolved.candidate,
            resolved.scanSessionId
          ),
          ...pointerStateForContext(agentSessions, context, tabId)
        }),
        deps,
        tabId,
        action: {
          kind: "focus",
          target: {
            candidateId: resolved.candidate.candidateId,
            scanSessionId: resolved.scanSessionId
          }
        },
        candidate: resolved.candidate,
        scanRegistry,
        ...(context === undefined ? {} : { context }),
        agentSessions
      });
      const refreshedSnapshot = await scanLayoutIntelligenceAcrossFrames({
        deps,
        tabId,
        scope: "visible",
        intent: FOCUS_ATLAS_INTENT,
        maxNodes: 256,
        ...(surfaceSession === null
          ? {}
          : (() => {
              const focusRegion = resolveSessionFocusRegion(surfaceSession, FOCUS_ATLAS_INTENT);
              return focusRegion === undefined ? {} : { focusRegion };
            })())
      });
      const refreshedAtlas = buildFocusAtlas({
        tabId,
        snapshot: refreshedSnapshot.snapshot,
        ...(surfaceSession === null ? {} : { session: surfaceSession }),
        discoveryMode: "probe_verified"
      }).atlas;
      focusAtlasRegistry.write(tabId, {
        atlas: refreshedAtlas,
        diagnostics: {
          durationMs: Date.now() - startedAt,
          candidateCount: refreshedAtlas.nodes.length,
          widgetCount: refreshedSnapshot.snapshot.widgets.length
        }
      });
      const focusDeltaObserved =
        resolved.focusAtlas.version !== refreshedAtlas.version
        || resolved.focusAtlas.activeFocusRegionId !== refreshedAtlas.activeFocusRegionId;
      const focusProbeVerified =
        action.focusProbeVerified === true
        || action.verified === true
        || action.verification?.stateTransition === "focus_changed"
        || focusDeltaObserved;
      if (context?.agentSessionId && context?.agentTurnId) {
        agentSessions.upsert({
          agentSessionId: context.agentSessionId,
          agentTurnId: context.agentTurnId,
          tabId,
          scanSessionId: resolved.scanSessionId,
          focusAtlasVersion: refreshedAtlas.version,
          ...(refreshedAtlas.activeFocusRegionId === undefined
            ? {}
            : { activeFocusRegionId: refreshedAtlas.activeFocusRegionId }),
          lastFocusProbeVerified: focusProbeVerified,
          lastFocusDeltaObserved: focusDeltaObserved
        });
      }
      return {
        tabId,
        scanSessionId: resolved.scanSessionId,
        pageMode: refreshedAtlas.pageMode,
        focusAtlasReady: true,
        focusAtlasVersion: refreshedAtlas.version,
        ...(refreshedAtlas.activeFocusRegionId === undefined
          ? {}
          : { activeFocusRegionId: refreshedAtlas.activeFocusRegionId }),
        atlas: refreshedAtlas,
        probedTarget: resolved.candidate,
        focusProbeVerified,
        focusDeltaObserved,
        intervention: {
          mode: "active",
          label: "Lyra is controlling this page",
          detail: "local focus probe"
        },
        action: {
          ...action,
          overlayShown,
          focusProbeVerified,
          focusDeltaObserved,
          focusAtlasVersion: refreshedAtlas.version,
          ...(refreshedAtlas.activeFocusRegionId === undefined
            ? {}
            : { activeFocusRegionId: refreshedAtlas.activeFocusRegionId })
        },
        diagnostics: {
          scannedFrames: refreshedSnapshot.scannedFrames,
          scannedCandidates: refreshedSnapshot.scannedCandidates,
          durationMs: Date.now() - startedAt,
          refreshed: request?.refresh === true,
          strategy: resolved.strategy
        }
      };
    },

    scanWidgets: async (request?: WorkbenchWebWidgetScanRequest, context?: WorkbenchWebAutomationCallContext) => {
      const startedAt = Date.now();
      const tabId = resolveTabId(deps, request?.tabId);
      assertActiveVisiblePage(deps, tabId);
      const scope = request?.scope ?? "visible";
      const result = await scanScopeOnce({
        deps,
        tabId,
        intent: FOCUS_ATLAS_INTENT,
        scope,
        maxCandidates: scope === "visible" ? VISIBLE_SCAN_MAX : NEARBY_SCAN_MAX,
        surfaceSession: readAgentSession(agentSessions, context, tabId)
      });
      const surfaceSession = readAgentSession(agentSessions, context, tabId);
      const annotatedCandidates = annotateCandidatesForOperability(result.candidates, surfaceSession);
      focusAtlasRegistry.write(tabId, {
        atlas: result.focusAtlas,
        diagnostics: focusAtlasDiagnosticsFromScan({
          durationMs: Date.now() - startedAt,
          atlas: result.focusAtlas,
          widgets: result.widgets
        })
      });
      const maxWidgets = Math.max(1, Math.min(64, Math.round(request?.maxWidgets ?? 16)));
      const scanSession = scanRegistry.write({
        tabId,
        scope,
        intent: FOCUS_ATLAS_INTENT,
        pageMode: result.pageMode,
        widgets: result.widgets,
        containerNodes: result.containerNodes,
        candidates: annotatedCandidates
      });
      if (context?.agentSessionId && context?.agentTurnId) {
        agentSessions.upsert({
          agentSessionId: context.agentSessionId,
          agentTurnId: context.agentTurnId,
          tabId,
          scanSessionId: scanSession.scanSessionId,
          focusAtlasVersion: result.focusAtlas.version,
          ...(result.focusAtlas.activeFocusRegionId === undefined
            ? {}
            : { activeFocusRegionId: result.focusAtlas.activeFocusRegionId })
        });
      }
      return {
        tabId,
        scanSessionId: scanSession.scanSessionId,
        scope,
        pageMode: result.pageMode,
        focusAtlasReady: true,
        focusAtlasVersion: result.focusAtlas.version,
        ...(result.focusAtlas.activeFocusRegionId === undefined
          ? {}
          : { activeFocusRegionId: result.focusAtlas.activeFocusRegionId }),
        widgets: result.widgets.slice(0, maxWidgets),
        layoutNodes: result.layoutNodes,
        containerNodes: result.containerNodes,
        surface: buildSurfaceModel({
          candidates: annotatedCandidates,
          focusAtlas: result.focusAtlas,
          ...(surfaceSession === undefined ? {} : { session: surfaceSession })
        }),
        truncated: result.widgets.length > maxWidgets,
        diagnostics: {
          scannedFrames: result.scannedFrames,
          scannedCandidates: result.scannedCandidates,
          expanded: scope === "expanded",
          scrolled: result.scrolled,
          durationMs: Date.now() - startedAt
        }
      };
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
        agentSessions,
        focusAtlasRegistry
      });
    },

    scanAndAct: async (
      request: WorkbenchWebScanAndActRequest,
      context?: WorkbenchWebAutomationCallContext
    ): Promise<WorkbenchWebScanAndActResult> => {
      const startedAt = Date.now();
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);
      const scope = request.scope ?? SCAN_AND_ACT_DEFAULT_SCOPE;
      const maxCandidates = Math.max(
        1,
        Math.min(
          scope === "expanded" ? EXPANDED_SCAN_MAX : scope === "nearby" ? NEARBY_SCAN_MAX : VISIBLE_SCAN_MAX,
          Math.round(request.maxCandidates ?? SCAN_AND_ACT_DEFAULT_MAX_CANDIDATES)
        )
      );
      const maxLatencyMs = normalizeScanAndActLatencyBudget(request.maxLatencyMs);
      const followThroughSteps = request.followThroughSteps ?? 1;
      const action = mergeActionWithScanAndActHints(request.action, request.targetHints);
      const actionTarget = (action as { readonly target?: unknown }).target;
      const actionTargetRecord = actionTarget !== null && typeof actionTarget === "object" && !Array.isArray(actionTarget)
        ? actionTarget as Record<string, unknown>
        : undefined;
      const hasExplicitTarget = hasExplicitActionTargetSignal(actionTargetRecord);
      const hasHardStructuredTarget = hasHardStructuredActionTargetSignal(actionTargetRecord);
      const shouldBypassScan = hasHardStructuredTarget && request.targetHints === undefined;
      const shouldRunScanAndResolve = !hasExplicitTarget || request.targetHints !== undefined || !shouldBypassScan;
      const isNavigateAction = NAVIGATE_ACTIONS.has(action.kind);
      let scanCount = 0;
      let gateRetryCount = 0;
      let actionAttempts = 0;
      let goalGateSoftFailed = false;
      let cacheHit = false;
      let continuationApplied = false;
      let scanSkipped = false;
      let selectedCandidate: LiveSelectorScanCandidateRecord | undefined;
      let selectedScanSessionId: string | undefined;
      let selectedScope = scope;

      let actionRequest: WorkbenchWebActionRequest = {
        tabId,
        ...(request.graphId === undefined ? {} : { graphId: request.graphId }),
        action,
        timeoutMs:
          request.timeoutMs === undefined
            ? Math.max(3_500, Math.min(7_500, maxLatencyMs + 2_500))
            : request.timeoutMs,
        ...(request.waitForNavigationMs === undefined
          ? {}
          : { waitForNavigationMs: request.waitForNavigationMs })
      };

      if (!isNavigateAction && shouldRunScanAndResolve) {
        const intent = buildScanAndActIntent({
          action,
          ...(request.targetHints === undefined ? {} : { targetHints: request.targetHints })
        });
        const fingerprint = buildScanAndActFingerprint({
          action,
          ...(request.targetHints === undefined ? {} : { targetHints: request.targetHints })
        });
        const scopesToTry = [scope];
        const fallbackScope = nextLiveSelectorScope(scope);
        if (fallbackScope !== null) {
          scopesToTry.push(fallbackScope);
        }

        let fallbackCandidate: LiveSelectorScanCandidateRecord | undefined;
        for (const [attemptIndex, scanScope] of scopesToTry.entries()) {
          if (attemptIndex > 0 && Date.now() - startedAt > maxLatencyMs) {
            break;
          }
          const cacheKey = `${tabId}::${scanScope}::${maxCandidates}::${fingerprint}`;
          const now = Date.now();
          const cached = scanAndActProbeCache.get(cacheKey);
          let scanResult: WorkbenchWebTargetScanResult;
          if (cached !== undefined && now - cached.cachedAt <= SCAN_AND_ACT_CACHE_TTL_MS) {
            scanResult = cached.scanResult;
            cacheHit = true;
          } else {
            if (cached !== undefined) {
              scanAndActProbeCache.delete(cacheKey);
            }
            scanResult = await runLiveSelectorScan({
              deps,
              tabId,
              request: {
                tabId,
                intent,
                scope: scanScope,
                maxCandidates
              },
              registry: scanRegistry,
              ...(context === undefined ? {} : { context }),
              agentSessions,
              focusAtlasRegistry
            });
            scanAndActProbeCache.set(cacheKey, {
              tabId,
              scope: scanScope,
              maxCandidates,
              fingerprint,
              cachedAt: now,
              scanResult
            });
            scanCount += 1;
          }

          const candidate = selectScanAndActCandidate({
            scanResult,
            action,
            ...(request.targetHints === undefined ? {} : { targetHints: request.targetHints })
          });
          if (candidate !== undefined) {
            fallbackCandidate = candidate;
            selectedScope = scanScope;
            selectedScanSessionId = scanResult.scanSessionId;
            if (candidateSupportsActionKind(candidate, action)) {
              selectedCandidate = candidate;
              break;
            }
            goalGateSoftFailed = true;
            if (attemptIndex + 1 < scopesToTry.length) {
              gateRetryCount += 1;
              if (Date.now() - startedAt > maxLatencyMs) {
                break;
              }
            }
          }
        }

        selectedCandidate = selectedCandidate ?? fallbackCandidate;
        if (selectedCandidate === undefined || selectedScanSessionId === undefined) {
          throw createWebAutomationError(
            "no_interactable_candidates",
            "scan_and_act could not find an actionable candidate",
            "scan",
            true
          );
        }

        actionRequest = withResolvedCandidateTarget(
          actionRequest,
          selectedCandidate,
          selectedScanSessionId
        );
      } else {
        scanSkipped = true;
      }

      actionAttempts += 1;
      const actionResult = isNavigateAction
        ? await service.runNavigateAction(actionRequest, context)
        : SAFE_ACTIONS.has(actionRequest.action.kind)
          ? await service.runSafeAction(actionRequest, context)
          : await service.runMutateAction(actionRequest, context);
      const verified = isVerifiedActionResult(actionResult);
      const goalSatisfied = isGoalSatisfiedForResult({
        ...(request.goal === undefined ? {} : { goal: request.goal }),
        result: actionResult
      });
      continuationApplied = followThroughSteps > 0
        && typeof actionResult.note === "string"
        && actionResult.note.toLowerCase().includes("continued from local reveal delta");

      return {
        tabId,
        ok: actionResult.ok,
        verified,
        goalSatisfied,
        actionResult,
        ...(selectedCandidate === undefined ? {} : { selectedCandidate }),
        ...(
          actionResult.scanSessionId === undefined && selectedScanSessionId === undefined
            ? {}
            : { scanSessionId: actionResult.scanSessionId ?? selectedScanSessionId }
        ),
        cacheHit,
        continuationApplied,
        diagnostics: {
          durationMs: Date.now() - startedAt,
          scanCount,
          gateRetryCount,
          actionAttempts,
          maxLatencyMs,
          scope: selectedScope,
          maxCandidates,
          goalGateSoftFailed,
          scanSkipped
        }
      };
    },

    runSafeAction: async (request: WorkbenchWebActionRequest, context?: WorkbenchWebAutomationCallContext): Promise<WorkbenchWebActionResult> => {
      assertActionAllowed(request, "safe");
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);

      const target = (request.action as { readonly target?: Record<string, unknown> }).target;
      const hasCandidate = hasExplicitActionTargetSignal(target);
      let fallbackRequest = request;
      let overlayShown = false;
      try {
        if (hasCandidate) {
          try {
            const { scanSessionId, candidate } = await resolveCandidateFromAction({
              deps,
              request,
              scanRegistry,
              focusAtlasRegistry,
              tabId,
              ...(context === undefined ? {} : { context }),
              agentSessions
            });
            const scanSession = scanRegistry.read(scanSessionId);
            const resolvedRequest = withResolvedCandidateTarget(request, candidate, scanSessionId);
            if (context?.toolCallId) {
              overlayShown = await showAgentSelectorTarget(
                deps.browserBridge,
                toAgentTargetFromCandidate({
                  tabId,
                  toolCallId: context.toolCallId,
                  owner: "agent_action",
                  phase: "resolve",
                  candidate,
                  ...(scanSession === null
                    ? {}
                    : {
                        pageMode: scanSession.pageMode,
                        widgets: scanSession.widgets
                      })
                })
              ).catch(() => false);
            }
            let result = await runWithMicroRetry({
              execute: () => executeWebActionWithDeadline({
                browserBridge: deps.browserBridge,
                graph: syntheticGraphFromCandidate(tabId, scanSessionId, candidate),
                request: resolvedRequest,
                ...pointerStateForContext(agentSessions, context, tabId)
              }),
              deps,
              tabId,
              action: resolvedRequest.action,
              candidate,
              scanRegistry,
              ...(context === undefined ? {} : { context }),
              agentSessions
            });
            const resetWorkflow = shouldResetWorkflowContext(result);
            if (resetWorkflow) {
              agentSessions.clear(tabId);
            } else if (context?.agentSessionId && context?.agentTurnId) {
              agentSessions.upsert({
                agentSessionId: context.agentSessionId,
                agentTurnId: context.agentTurnId,
                tabId,
                scanSessionId,
                ...buildWorkflowSessionPatch({
                  candidate,
                  scanSession,
                  subgoal: inferSubgoalFromAction(request.action),
                  result
                })
              });
            }
            return {
              ...result,
              scanSessionId,
              overlayShown
            };
          } catch (error) {
            if (!isRecoverableCandidateResolutionError(error)) {
              throw error;
            }
          }
        }

        const workflowCandidate = await resolveWorkflowCandidateFromContext({
          request: fallbackRequest,
          scanRegistry,
          deps,
          tabId,
          ...(context === undefined ? {} : { context }),
          agentSessions,
          focusAtlasRegistry
        });
        if (workflowCandidate !== null) {
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toAgentTargetFromCandidate({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_action",
                phase: "resolve",
                candidate: workflowCandidate.candidate,
                pageMode: workflowCandidate.scanSession.pageMode,
                widgets: workflowCandidate.scanSession.widgets
              })
            ).catch(() => false);
          }
          const result = await executeWebActionWithDeadline({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, workflowCandidate.scanSessionId, workflowCandidate.candidate),
            request: withResolvedCandidateTarget(
              fallbackRequest,
              workflowCandidate.candidate,
              workflowCandidate.scanSessionId
            ),
            ...pointerStateForContext(agentSessions, context, tabId)
          });
          const resetWorkflow = shouldResetWorkflowContext(result);
          if (resetWorkflow) {
            agentSessions.clear(tabId);
          } else if (context?.agentSessionId && context?.agentTurnId) {
            agentSessions.upsert({
              agentSessionId: context.agentSessionId,
              agentTurnId: context.agentTurnId,
              tabId,
              scanSessionId: workflowCandidate.scanSessionId,
              ...buildWorkflowSessionPatch({
                candidate: workflowCandidate.candidate,
                scanSession: workflowCandidate.scanSession,
                subgoal: inferSubgoalFromAction(fallbackRequest.action),
                result
              })
            });
          }
          return {
            ...result,
            scanSessionId: workflowCandidate.scanSessionId,
            overlayShown
          };
        }

        const implicitCandidate = resolveImplicitRecentCandidateFromContext({
          request: fallbackRequest,
          scanRegistry,
          tabId,
          ...(context === undefined ? {} : { context }),
          agentSessions
        });
        if (implicitCandidate !== null) {
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toAgentTargetFromCandidate({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_action",
                phase: "resolve",
                candidate: implicitCandidate.candidate,
                pageMode: implicitCandidate.scanSession.pageMode,
                widgets: implicitCandidate.scanSession.widgets
              })
            ).catch(() => false);
          }
          const result = await executeWebActionWithDeadline({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, implicitCandidate.scanSessionId, implicitCandidate.candidate),
            request: withResolvedCandidateTarget(
              fallbackRequest,
              implicitCandidate.candidate,
              implicitCandidate.scanSessionId
            ),
            ...pointerStateForContext(agentSessions, context, tabId)
          });
          const resetWorkflow = shouldResetWorkflowContext(result);
          if (resetWorkflow) {
            agentSessions.clear(tabId);
          } else if (context?.agentSessionId && context?.agentTurnId) {
            agentSessions.upsert({
              agentSessionId: context.agentSessionId,
              agentTurnId: context.agentTurnId,
              tabId,
              scanSessionId: implicitCandidate.scanSessionId,
              ...buildWorkflowSessionPatch({
                candidate: implicitCandidate.candidate,
                scanSession: implicitCandidate.scanSession,
                subgoal: inferSubgoalFromAction(fallbackRequest.action),
                result
              })
            });
          }
          return {
            ...result,
            scanSessionId: implicitCandidate.scanSessionId,
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
        const result = await executeWebActionWithDeadline({
          browserBridge: deps.browserBridge,
          graph,
          request: fallbackRequest,
          ...pointerStateForContext(agentSessions, context, tabId)
        });
        if (shouldResetWorkflowContext(result)) {
          agentSessions.clear(tabId);
        }
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
      const hasCandidate = hasExplicitActionTargetSignal(target);
      let fallbackRequest = request;
      let overlayShown = false;
      try {
        if (hasCandidate) {
          try {
            const { scanSessionId, candidate } = await resolveCandidateFromAction({
              deps,
              request,
              scanRegistry,
              focusAtlasRegistry,
              tabId,
              ...(context === undefined ? {} : { context }),
              agentSessions
            });
            const scanSession = scanRegistry.read(scanSessionId);
            const resolvedRequest = withResolvedCandidateTarget(request, candidate, scanSessionId);
            if (context?.toolCallId) {
              overlayShown = await showAgentSelectorTarget(
                deps.browserBridge,
                toAgentTargetFromCandidate({
                  tabId,
                  toolCallId: context.toolCallId,
                  owner: "agent_action",
                  phase: "act",
                  candidate,
                  ...(scanSession === null
                    ? {}
                    : {
                        pageMode: scanSession.pageMode,
                        widgets: scanSession.widgets
                      })
                })
              ).catch(() => false);
            }
            let result = await runWithMicroRetry({
              execute: () => executeWebActionWithDeadline({
                browserBridge: deps.browserBridge,
                graph: syntheticGraphFromCandidate(tabId, scanSessionId, candidate),
                request: resolvedRequest,
                ...pointerStateForContext(agentSessions, context, tabId)
              }),
              deps,
              tabId,
              action: resolvedRequest.action,
              candidate,
              scanRegistry,
              ...(context === undefined ? {} : { context }),
              agentSessions
            });
            invalidateTabGraphCache(cache, tabId, undefined);
            focusAtlasRegistry.invalidate(tabId);
            let effectiveScanSessionId = scanSessionId;
            let revealDelta = undefined;
            let sessionCandidate = candidate;
            let revealObserved = false;
            if (!shouldResetWorkflowContext(result)) {
              const revealFlow = await runPostRevealContinuation({
                tabId,
                request: resolvedRequest,
                result,
                sourceCandidate: candidate,
                sourceScanSession: scanSession,
                sourceScanSessionId: scanSessionId,
                ...(context === undefined ? {} : { context })
              });
              result = revealFlow.result;
              effectiveScanSessionId = revealFlow.scanSessionId;
              revealDelta = revealFlow.revealDelta;
              sessionCandidate = revealFlow.finalCandidate;
              revealObserved = revealFlow.revealObserved;
            }
            const finalResetWorkflow = shouldResetWorkflowContext(result);
            if (finalResetWorkflow) {
              agentSessions.clear(tabId);
            }
            if (!finalResetWorkflow && context?.agentSessionId && context?.agentTurnId) {
              const sessionForPatch = scanRegistry.read(effectiveScanSessionId) ?? scanSession;
              agentSessions.upsert({
                agentSessionId: context.agentSessionId,
                agentTurnId: context.agentTurnId,
                tabId,
                scanSessionId: effectiveScanSessionId,
                ...buildWorkflowSessionPatch({
                  candidate: sessionCandidate,
                  scanSession: sessionForPatch,
                  subgoal: inferSubgoalFromAction(fallbackRequest.action),
                  result
                }),
                ...(revealDelta === undefined ? {} : { lastLocalDelta: revealDelta }),
                lastRevealObserved: revealObserved
              });
            }
            return {
              ...result,
              scanSessionId: effectiveScanSessionId,
              overlayShown
            };
          } catch (error) {
            if (!isRecoverableCandidateResolutionError(error)) {
              throw error;
            }
          }
        }

        const workflowCandidate = await resolveWorkflowCandidateFromContext({
          request: fallbackRequest,
          scanRegistry,
          deps,
          tabId,
          ...(context === undefined ? {} : { context }),
          agentSessions,
          focusAtlasRegistry
        });
        if (workflowCandidate !== null) {
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toAgentTargetFromCandidate({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_action",
                phase: "act",
                candidate: workflowCandidate.candidate,
                pageMode: workflowCandidate.scanSession.pageMode,
                widgets: workflowCandidate.scanSession.widgets
              })
            ).catch(() => false);
          }
          const resolvedWorkflowRequest = withResolvedCandidateTarget(
            fallbackRequest,
            workflowCandidate.candidate,
            workflowCandidate.scanSessionId
          );
          let result = await runWithMicroRetry({
            execute: () => executeWebActionWithDeadline({
              browserBridge: deps.browserBridge,
              graph: syntheticGraphFromCandidate(tabId, workflowCandidate.scanSessionId, workflowCandidate.candidate),
              request: resolvedWorkflowRequest,
              ...pointerStateForContext(agentSessions, context, tabId)
            }),
            deps,
            tabId,
            action: resolvedWorkflowRequest.action,
            candidate: workflowCandidate.candidate,
            scanRegistry,
            ...(context === undefined ? {} : { context }),
            agentSessions
          });
          invalidateTabGraphCache(cache, tabId, undefined);
          focusAtlasRegistry.invalidate(tabId);
          let effectiveScanSessionId = workflowCandidate.scanSessionId;
          let revealDelta = undefined;
          let sessionCandidate = workflowCandidate.candidate;
          let revealObserved = false;
          if (!shouldResetWorkflowContext(result)) {
            const revealFlow = await runPostRevealContinuation({
              tabId,
              request: resolvedWorkflowRequest,
              result,
              sourceCandidate: workflowCandidate.candidate,
              sourceScanSession: workflowCandidate.scanSession,
              sourceScanSessionId: workflowCandidate.scanSessionId,
              ...(context === undefined ? {} : { context })
            });
            result = revealFlow.result;
            effectiveScanSessionId = revealFlow.scanSessionId;
            revealDelta = revealFlow.revealDelta;
            sessionCandidate = revealFlow.finalCandidate;
            revealObserved = revealFlow.revealObserved;
          }
          const finalResetWorkflow = shouldResetWorkflowContext(result);
          if (finalResetWorkflow) {
            agentSessions.clear(tabId);
          } else if (context?.agentSessionId && context?.agentTurnId) {
            const sessionForPatch = scanRegistry.read(effectiveScanSessionId) ?? workflowCandidate.scanSession;
            agentSessions.upsert({
              agentSessionId: context.agentSessionId,
              agentTurnId: context.agentTurnId,
              tabId,
              scanSessionId: effectiveScanSessionId,
              ...buildWorkflowSessionPatch({
                candidate: sessionCandidate,
                scanSession: sessionForPatch,
                subgoal: inferSubgoalFromAction(fallbackRequest.action),
                result
              }),
              ...(revealDelta === undefined ? {} : { lastLocalDelta: revealDelta }),
              lastRevealObserved: revealObserved
            });
          }
          return {
            ...result,
            scanSessionId: effectiveScanSessionId,
            overlayShown
          };
        }

        const implicitCandidate = resolveImplicitRecentCandidateFromContext({
          request: fallbackRequest,
          scanRegistry,
          tabId,
          ...(context === undefined ? {} : { context }),
          agentSessions
        });
        if (implicitCandidate !== null) {
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toAgentTargetFromCandidate({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_action",
                phase: "act",
                candidate: implicitCandidate.candidate,
                pageMode: implicitCandidate.scanSession.pageMode,
                widgets: implicitCandidate.scanSession.widgets
              })
            ).catch(() => false);
          }
          const resolvedImplicitRequest = withResolvedCandidateTarget(
            fallbackRequest,
            implicitCandidate.candidate,
            implicitCandidate.scanSessionId
          );
          let result = await runWithMicroRetry({
            execute: () => executeWebActionWithDeadline({
              browserBridge: deps.browserBridge,
              graph: syntheticGraphFromCandidate(tabId, implicitCandidate.scanSessionId, implicitCandidate.candidate),
              request: resolvedImplicitRequest,
              ...pointerStateForContext(agentSessions, context, tabId)
            }),
            deps,
            tabId,
            action: resolvedImplicitRequest.action,
            candidate: implicitCandidate.candidate,
            scanRegistry,
            ...(context === undefined ? {} : { context }),
            agentSessions
          });
          invalidateTabGraphCache(cache, tabId, undefined);
          focusAtlasRegistry.invalidate(tabId);
          let effectiveScanSessionId = implicitCandidate.scanSessionId;
          let revealDelta = undefined;
          let sessionCandidate = implicitCandidate.candidate;
          let revealObserved = false;
          if (!shouldResetWorkflowContext(result)) {
            const revealFlow = await runPostRevealContinuation({
              tabId,
              request: resolvedImplicitRequest,
              result,
              sourceCandidate: implicitCandidate.candidate,
              sourceScanSession: implicitCandidate.scanSession,
              sourceScanSessionId: implicitCandidate.scanSessionId,
              ...(context === undefined ? {} : { context })
            });
            result = revealFlow.result;
            effectiveScanSessionId = revealFlow.scanSessionId;
            revealDelta = revealFlow.revealDelta;
            sessionCandidate = revealFlow.finalCandidate;
            revealObserved = revealFlow.revealObserved;
          }
          const finalResetWorkflow = shouldResetWorkflowContext(result);
          if (finalResetWorkflow) {
            agentSessions.clear(tabId);
          }
          if (!finalResetWorkflow && context?.agentSessionId && context?.agentTurnId) {
            const sessionForPatch = scanRegistry.read(effectiveScanSessionId) ?? implicitCandidate.scanSession;
            agentSessions.upsert({
              agentSessionId: context.agentSessionId,
              agentTurnId: context.agentTurnId,
              tabId,
              scanSessionId: effectiveScanSessionId,
              ...buildWorkflowSessionPatch({
                candidate: sessionCandidate,
                scanSession: sessionForPatch,
                subgoal: inferSubgoalFromAction(fallbackRequest.action),
                result
              }),
              ...(revealDelta === undefined ? {} : { lastLocalDelta: revealDelta }),
              lastRevealObserved: revealObserved
            });
          }
          return {
            ...result,
            scanSessionId: effectiveScanSessionId,
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
        const result = await executeWebActionWithDeadline({
          browserBridge: deps.browserBridge,
          graph,
          request: fallbackRequest,
          ...pointerStateForContext(agentSessions, context, tabId)
        });
        invalidateTabGraphCache(cache, tabId, graph.graphId);
        focusAtlasRegistry.invalidate(tabId);
        if (shouldResetWorkflowContext(result)) {
          agentSessions.clear(tabId);
        }
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
      const tabId =
        request.action.kind === "goto_url" && request.action.target === "active-tab"
          ? resolveTabId(deps, "active-tab")
          : resolveTabId(deps, request.tabId);
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
        const result = await executeWebActionWithDeadline({
          browserBridge: deps.browserBridge,
          graph,
          request
        });
        invalidateTabGraphCache(cache, tabId, graph.graphId);
        focusAtlasRegistry.invalidate(tabId);
        agentSessions.clear(tabId);
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
      const target = request.target as {
        readonly candidateId?: unknown;
        readonly scanSessionId?: unknown;
        readonly nodeRef?: { readonly nodeId?: unknown };
      };
      const hasCandidate =
        typeof target.candidateId === "string"
        || typeof target.nodeRef?.nodeId === "string";
      let overlayShown = false;
      try {
        if (hasCandidate) {
          const { scanSessionId, candidate } = await resolveCandidateReference({
            target: request.target as Record<string, unknown>,
            deps,
            scanRegistry,
            focusAtlasRegistry,
            tabId,
            ...(context === undefined ? {} : { context }),
            agentSessions
          });
          const scanSession = scanRegistry.read(scanSessionId);
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toAgentTargetFromCandidate({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_wait",
                phase: "wait",
                candidate,
                ...(scanSession === null
                  ? {}
                  : {
                      pageMode: scanSession.pageMode,
                      widgets: scanSession.widgets
                    })
              })
            ).catch(() => false);
          }
          const result = await waitForTarget({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, scanSessionId, candidate),
            request: withResolvedWaitTarget(request, candidate, scanSessionId)
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
  return service;
};
