import type {
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
  WorkbenchWebContextReadRequest,
  WorkbenchWebContextReadResult,
  WorkbenchWebFocusProbeRequest,
  WorkbenchWebFocusProbeResult,
  WorkbenchWebFocusReadRequest,
  WorkbenchWebInterventionState,
  WorkbenchWebOperabilityReadRequest,
  WorkbenchWebOperabilityReadResult,
  WorkbenchWebQueryResult,
  WorkbenchWebScanAndActResult,
  WorkbenchWebSkeletonReadRequest,
  WorkbenchWebSkeletonReadResult,
  WorkbenchWebVerificationStateTransition,
  WorkbenchWebWidgetScanRequest,
  WorkbenchWebWidgetScanResult,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanScope,
  WorkbenchWebTargetScanRequest,
  WorkbenchWebTargetScanResult,
} from "../../shared/workbench-web-automation";
import { WorkbenchWebAutomationCache } from "./cache";
import { executeWebAction, waitForTarget } from "./action-executor";
import { WorkbenchAgentWebSessionRegistry } from "./agent-session/registry";
import { createWebAutomationError } from "./diagnostics";
import { buildFocusAtlas } from "./focus-atlas/build";
import { FocusAtlasRegistry } from "./focus-atlas/registry";
import { buildWebGraphSnapshot } from "./graph-builder";
import {
  buildResultFromSnapshot,
  ensureGraphLoaded,
  queryGraphSnapshot,
} from "./service-modules/graph-runtime-helpers";
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
import { createWorkbenchWebActionDeadlineExecutor } from "./service-modules/action-deadline";
import {
  isWeakStableSignatureTarget,
  toActionIntent,
} from "./service-modules/action-intent-utils";
import { createWorkbenchWebActionMethods } from "./service-modules/actions";
import {
  syntheticGraphFromCandidate,
  toAgentTargetFromCandidate,
  withResolvedCandidateTarget,
  withResolvedWaitTarget,
} from "./service-modules/candidate-target-utils";
import { createWorkbenchWebCoreReadMethods } from "./service-modules/core-reads";
import {
  applyFocusAtlasMetadata,
  deriveFocusAtlasLocalDelta,
} from "./service-modules/focus-atlas-helpers";
import { createWorkbenchWebFocusAtlasRuntime } from "./service-modules/focus-atlas-runtime";
import { createWorkbenchWebLiveSelectorOrchestrator } from "./service-modules/live-selector-orchestrator";
import { createWorkbenchWebReadScanMethods } from "./service-modules/read-scan";
import { createWorkbenchWebObservationMethods } from "./service-modules/observation";
import { createWorkbenchWebFocusProbeResolver } from "./service-modules/focus-probe-resolver";
import {
  annotateCandidateForOperability,
  annotateCandidatesForOperability,
  focusAtlasDiagnosticsFromScan,
} from "./service-modules/operability-helpers";
import { createWorkbenchWebPostRevealContinuation } from "./service-modules/post-reveal-continuation";
import { createWorkbenchWebQueryIntentBuilder } from "./service-modules/query-intent-builder";
import {
  resolveHoverRevealRegion,
  resolveSessionFocusRegion,
  resolveWorkflowRegionForCandidate,
} from "./service-modules/region-resolvers";
import {
  isLocallyRelevantCandidate,
  mergeRevealedCandidates,
  shouldAttemptHoverReveal,
} from "./service-modules/reveal-helpers";
import { createWorkbenchWebScanPrimitives } from "./service-modules/scan-primitives";
import { createWorkbenchWebServiceGuards } from "./service-modules/service-guards";
import {
  pointerStateForContext,
  readAgentSession,
} from "./service-modules/session-context-helpers";
import { createWorkbenchWorkflowSessionPatchBuilder } from "./service-modules/workflow-session-patch";
import {
  inferSubgoalFromAction,
  inferSubgoalFromIntent,
  isActionRevealTriggerCandidate,
  isRevealStateTransition,
  resolveActiveItemId,
  shouldResetWorkflowContext,
} from "./service-modules/workflow-heuristics";
import {
  createWorkbenchWebRecoveryMethods,
  isNoInteractableCandidatesError,
} from "./service-modules/recovery-resolver";
import {
  buildScanAndActFingerprint,
  candidateSupportsActionKind,
  isGoalSatisfiedForResult,
  isVerifiedActionResult,
  mergeActionWithScanAndActHints,
  normalizeScanAndActLatencyBudget,
} from "./service-modules/scan-and-act-helpers";
import {
  adaptiveScanScopes,
  createWorkbenchWebScanAndActOrchestration,
  readMicroExecutorStepBudget,
} from "./service-modules/scan-orchestration-helpers";
import {
  buildExplicitTargetRecoveryIntent,
  findBestActionTargetCandidate,
  hasExplicitActionTargetSignal,
  hasHardStructuredActionTargetSignal,
  hasSidebarHistoryIntent,
  hasTextualActionTargetHints,
  isWeakCssSelector,
  scoreActionTargetCandidate,
} from "./service-modules/action-target-helpers";
import {
  applyQueryAttractorGuard,
  buildRegionKindById,
  buildSkeletonReadResult,
  buildSkeletonRegions,
  candidateSatisfiesQuery,
  matchesStableSignature,
  queryScoreCandidate,
  toSkeletonNode,
  type QueryAttractorState,
} from "./service-modules/query-skeleton-helpers";
import {
  clearAgentSelectorTarget,
  showAgentSelectorTarget,
} from "./live-selector/agent-visualization";
import { decodeLiveSelectorContinuationToken, encodeLiveSelectorContinuationToken } from "./live-selector/continuation-token";
import { nextLiveSelectorScope } from "./live-selector/expansion";
import { deriveLocalDeltaFromReveal, deriveLocalDeltaFromVerification } from "./live-selector/local-delta";
import { LiveSelectorScanRegistry } from "./live-selector/scan-session";
import { buildSurfaceModel } from "./live-selector/surface-model";
import type {
  LiveSelectorScanCandidateRecord,
  LiveSelectorScanSession,
} from "./live-selector/types";
import { scanLayoutIntelligenceAcrossFrames } from "./layout-intelligence/service";
import type {
  WorkbenchWebAutomationCallContext,
  WorkbenchWebAutomationService,
  WorkbenchWebAutomationServiceDeps,
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
const ACTION_TIMEOUT_HOVER_MS = 3_500;
const ACTION_TIMEOUT_SAFE_MS = 4_500;
const ACTION_TIMEOUT_MUTATE_MS = 6_500;
const ACTION_TIMEOUT_NAVIGATE_MS = 8_000;
const SCAN_AND_ACT_CACHE_TTL_MS = 1_200;
const SCAN_AND_ACT_DEFAULT_MAX_CANDIDATES = 24;
const SCAN_AND_ACT_DEFAULT_SCOPE: WorkbenchWebTargetScanScope = "visible";

const {
  resolveTabId,
  assertActiveVisiblePage,
  assertActionAllowed,
  invalidateTabGraphCache,
} = createWorkbenchWebServiceGuards({
  createWebAutomationError,
  safeActions: SAFE_ACTIONS,
  mutateActions: MUTATE_ACTIONS,
  navigateActions: NAVIGATE_ACTIONS,
});

type ScanAndActProbeCacheEntry = {
  readonly tabId: string;
  readonly scope: WorkbenchWebTargetScanScope;
  readonly maxCandidates: number;
  readonly fingerprint: string;
  readonly cachedAt: number;
  readonly scanResult: WorkbenchWebTargetScanResult;
};

const { executeWebActionWithDeadline } = createWorkbenchWebActionDeadlineExecutor({
  executeWebAction,
  createWebAutomationError,
  actionTimeoutHoverMs: ACTION_TIMEOUT_HOVER_MS,
  actionTimeoutSafeMs: ACTION_TIMEOUT_SAFE_MS,
  actionTimeoutMutateMs: ACTION_TIMEOUT_MUTATE_MS,
  actionTimeoutNavigateMs: ACTION_TIMEOUT_NAVIGATE_MS,
});

const FOCUS_ATLAS_INTENT: WorkbenchWebTargetIntent = {
  operation: "focus",
  desiredTags: ["textarea", "input", "select", "button", "a"],
  desiredRoles: ["textbox", "searchbox", "combobox", "button", "link"],
  allowContentEditable: true
};

const { buildQueryIntentFromRequest } = createWorkbenchWebQueryIntentBuilder({
  focusAtlasIntent: FOCUS_ATLAS_INTENT,
});

const {
  scanScopeOnce,
  runHoverRevealPass,
  runActionRevealPass,
} = createWorkbenchWebScanPrimitives({
  applyFocusAtlasMetadata,
  resolveSessionFocusRegion,
  shouldAttemptHoverReveal,
  isLocallyRelevantCandidate,
  mergeRevealedCandidates,
  executeWebActionWithDeadline,
  syntheticGraphFromCandidate,
  resolveHoverRevealRegion,
  visibleScanMax: VISIBLE_SCAN_MAX,
});

const {
  runLiveSelectorScan,
  runAdaptiveLiveSelectorScan,
} = createWorkbenchWebLiveSelectorOrchestrator({
  readAgentSession,
  readMicroExecutorStepBudget,
  scanScopeOnce,
  runHoverRevealPass,
  decodeLiveSelectorContinuationToken,
  encodeLiveSelectorContinuationToken,
  nextLiveSelectorScope,
  createWebAutomationError,
  focusAtlasDiagnosticsFromScan,
  annotateCandidatesForOperability,
  buildSurfaceModel,
  resolveActiveItemId,
  resolveWorkflowRegionForCandidate,
  resolveHoverRevealRegion,
  deriveLocalDeltaFromReveal,
  deriveFocusAtlasLocalDelta,
  inferSubgoalFromIntent,
  showAgentSelectorTarget,
  toAgentTargetFromCandidate,
  FOCUS_ATLAS_INTENT,
  VISIBLE_SCAN_MAX,
  NEARBY_SCAN_MAX,
  EXPANDED_SCAN_MAX,
  MAX_EXPANDED_SCROLL_STEPS,
  isNoInteractableCandidatesError,
});

const {
  buildScanAndActIntent,
  selectScanAndActCandidate,
} = createWorkbenchWebScanAndActOrchestration({
  toActionIntent,
  isActionRevealTriggerCandidate,
});

const { buildWorkflowSessionPatch } = createWorkbenchWorkflowSessionPatchBuilder({
  resolveActiveItemId,
  resolveWorkflowRegionForCandidate,
  resolveHoverRevealRegion,
  deriveLocalDeltaFromVerification,
});

const recoveryMethods = createWorkbenchWebRecoveryMethods({
  createWebAutomationError,
  toActionIntent,
  adaptiveScanScopes,
  scanScopeOnce,
  executeWebActionWithDeadline,
  syntheticGraphFromCandidate,
  runLiveSelectorScan,
  runAdaptiveLiveSelectorScan,
  readAgentSession,
  isWeakStableSignatureTarget,
});

const {
  isRecoverableCandidateResolutionError,
  runWithMicroRetry,
  resolveCandidateReference,
  resolveCandidateFromAction,
  resolveImplicitRecentCandidateFromContext,
  resolveWorkflowCandidateFromContext,
} = recoveryMethods;

const { resolveFocusProbeCandidate } = createWorkbenchWebFocusProbeResolver({
  FOCUS_ATLAS_INTENT,
  readAgentSession,
  hasExplicitActionTargetSignal,
  resolveCandidateReference,
  annotateCandidateForOperability,
  scanScopeOnce,
  annotateCandidatesForOperability,
  findBestActionTargetCandidate,
  createWebAutomationError,
});

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

  void store.compact().catch(() => undefined);

  const {
    rebuildFocusAtlasForTab,
    readSharedFocusAtlasScan,
    startBackgroundAtlasRefresh,
  } = createWorkbenchWebFocusAtlasRuntime({
    deps,
    focusAtlasRegistry,
    scanRegistry,
    focusAtlasIntent: FOCUS_ATLAS_INTENT,
    sharedFocusScanMaxAgeMs: SHARED_FOCUS_SCAN_MAX_AGE_MS,
  });
  const disposeBackgroundAtlasRefresh = startBackgroundAtlasRefresh();

  const { runPostRevealContinuation } = createWorkbenchWebPostRevealContinuation({
    deps,
    scanRegistry,
    agentSessions,
    queryIntentCueByTab,
    queryIntentCueTtlMs: QUERY_INTENT_CUE_TTL_MS,
    readAgentSession,
    readMicroExecutorStepBudget,
    runActionRevealPass,
    deriveLocalDeltaFromReveal,
    resolveWorkflowRegionForCandidate,
    resolveHoverRevealRegion,
    readFreshQueryIntentCue,
    extractActionTargetTextHints,
    pickRevealContinuationCandidate,
    rankRevealContinuationCandidates,
    withResolvedCandidateTarget,
    runWithMicroRetry,
    executeWebActionWithDeadline,
    syntheticGraphFromCandidate,
    pointerStateForContext,
    isRevealStateTransition,
    isActionRevealTriggerCandidate,
    shouldResetWorkflowContext,
  });

  const actionMethods = createWorkbenchWebActionMethods({
    deps,
    cache,
    store,
    scanRegistry,
    focusAtlasRegistry,
    agentSessions,
    assertActionAllowed,
    resolveTabId,
    assertActiveVisiblePage,
    hasExplicitActionTargetSignal,
    resolveCandidateFromAction,
    withResolvedCandidateTarget,
    showAgentSelectorTarget,
    toAgentTargetFromCandidate,
    runWithMicroRetry,
    executeWebActionWithDeadline,
    syntheticGraphFromCandidate,
    pointerStateForContext,
    shouldResetWorkflowContext,
    buildWorkflowSessionPatch,
    inferSubgoalFromAction,
    isRecoverableCandidateResolutionError,
    resolveWorkflowCandidateFromContext,
    resolveImplicitRecentCandidateFromContext,
    ensureGraphLoaded,
    invalidateTabGraphCache,
    runPostRevealContinuation,
    clearAgentSelectorTarget,
    resolveCandidateReference,
    withResolvedWaitTarget,
    waitForResolvedTarget: waitForTarget,
  });

  const readScanMethods = createWorkbenchWebReadScanMethods({
    deps,
    agentSessions,
    scanRegistry,
    focusAtlasRegistry,
    queryAttractorStateByTab,
    queryIntentCueByTab,
    scanAndActProbeCache,
    resolveTabId,
    assertActiveVisiblePage,
    buildQueryIntentFromRequest,
    readSharedFocusAtlasScan,
    runAdaptiveLiveSelectorScan,
    createWebAutomationError,
    buildRegionKindById,
    candidateSatisfiesQuery,
    queryScoreCandidate,
    applyQueryAttractorGuard,
    toSkeletonNode,
    captureQueryIntentCue,
    buildSkeletonRegions,
    matchesStableSignature,
    FOCUS_ATLAS_INTENT,
    normalizeScanAndActLatencyBudget,
    mergeActionWithScanAndActHints,
    hasExplicitActionTargetSignal,
    hasHardStructuredActionTargetSignal,
    safeActions: SAFE_ACTIONS,
    navigateActions: NAVIGATE_ACTIONS,
    nextLiveSelectorScope,
    runLiveSelectorScan,
    buildScanAndActIntent,
    buildScanAndActFingerprint,
    selectScanAndActCandidate,
    candidateSupportsActionKind,
    withResolvedCandidateTarget,
    runSafeAction: actionMethods.runSafeAction,
    runMutateAction: actionMethods.runMutateAction,
    runNavigateAction: actionMethods.runNavigateAction,
    isVerifiedActionResult,
    isGoalSatisfiedForResult,
    visibleScanMax: VISIBLE_SCAN_MAX,
    nearbyScanMax: NEARBY_SCAN_MAX,
    expandedScanMax: EXPANDED_SCAN_MAX,
    scanAndActCacheTtlMs: SCAN_AND_ACT_CACHE_TTL_MS,
    scanAndActDefaultMaxCandidates: SCAN_AND_ACT_DEFAULT_MAX_CANDIDATES,
    scanAndActDefaultScope: SCAN_AND_ACT_DEFAULT_SCOPE,
  });

  const observationMethods = createWorkbenchWebObservationMethods({
    deps,
    agentSessions,
    scanRegistry,
    focusAtlasRegistry,
    resolveTabId,
    assertActiveVisiblePage,
    runLiveSelectorScan,
    createWebAutomationError,
    FOCUS_ATLAS_INTENT,
    resolveFocusProbeCandidate,
    showAgentSelectorTarget,
    toAgentTargetFromCandidate,
    runWithMicroRetry,
    executeWebActionWithDeadline,
    syntheticGraphFromCandidate,
    withResolvedCandidateTarget,
    pointerStateForContext,
    scanLayoutIntelligenceAcrossFrames,
    readAgentSession,
    resolveSessionFocusRegion,
    buildFocusAtlas,
    annotateCandidatesForOperability,
    focusAtlasDiagnosticsFromScan,
    scanScopeOnce,
    buildSurfaceModel,
    visibleScanMax: VISIBLE_SCAN_MAX,
    nearbyScanMax: NEARBY_SCAN_MAX,
  });

  const coreReadMethods = createWorkbenchWebCoreReadMethods({
    deps,
    cache,
    store,
    scanRegistry,
    focusAtlasRegistry,
    agentSessions,
    resolveTabId,
    assertActiveVisiblePage,
    ensureGraphLoaded,
    queryGraphSnapshot,
    buildResultFromSnapshot,
    buildWebGraphSnapshot,
    readAgentSession,
    rebuildFocusAtlasForTab,
    runLiveSelectorScan,
    FOCUS_ATLAS_INTENT,
    createWebAutomationError,
    buildSkeletonReadResult,
  });

  const service: WorkbenchWebAutomationService = {
    dispose: () => {
      cache.clear();
      focusAtlasRegistry.clear();
      queryAttractorStateByTab.clear();
      queryIntentCueByTab.clear();
      scanAndActProbeCache.clear();
      disposeBackgroundAtlasRefresh();
    },

    buildGraph: coreReadMethods.buildGraph,

    queryGraph: coreReadMethods.queryGraph,

    readFocusAtlas: coreReadMethods.readFocusAtlas,

    readSkeleton: coreReadMethods.readSkeleton,

    querySkeleton: readScanMethods.querySkeleton,

    readContext: readScanMethods.readContext,

    readOperability: observationMethods.readOperability,

    probeFocus: observationMethods.probeFocus,

    scanWidgets: observationMethods.scanWidgets,

    scanTargets: observationMethods.scanTargets,

    scanAndAct: readScanMethods.scanAndAct,

    runSafeAction: actionMethods.runSafeAction,

    runMutateAction: actionMethods.runMutateAction,

    runNavigateAction: actionMethods.runNavigateAction,

    waitForTarget: actionMethods.waitForTarget
  };
  return service;
};
