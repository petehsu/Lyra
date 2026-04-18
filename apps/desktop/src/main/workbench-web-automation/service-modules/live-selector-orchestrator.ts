import type {
  WorkbenchWebFocusAtlas,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanRequest,
  WorkbenchWebTargetScanResult,
  WorkbenchWebTargetScanScope,
  WorkbenchWebWidgetScanResult,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSessionRegistry } from "../agent-session/registry";
import type { FocusAtlasRegistry } from "../focus-atlas/registry";
import type { LiveSelectorScanRegistry } from "../live-selector/scan-session";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";
import type {
  WorkbenchWebAutomationCallContext,
  WorkbenchWebAutomationServiceDeps,
} from "../types";

export type WorkbenchWebLiveSelectorOrchestratorRuntime = {
  readonly readAgentSession: (...args: any[]) => any;
  readonly readMicroExecutorStepBudget: (deps: WorkbenchWebAutomationServiceDeps) => number;
  readonly scanScopeOnce: (args: any) => Promise<any>;
  readonly runHoverRevealPass: (args: any) => Promise<any>;
  readonly decodeLiveSelectorContinuationToken: (token: string | undefined) => { scope: WorkbenchWebTargetScanScope; offset: number } | null;
  readonly encodeLiveSelectorContinuationToken: (args: { scope: WorkbenchWebTargetScanScope; offset: number }) => string;
  readonly nextLiveSelectorScope: (scope: WorkbenchWebTargetScanScope) => WorkbenchWebTargetScanScope | null;
  readonly createWebAutomationError: (...args: any[]) => Error;
  readonly focusAtlasDiagnosticsFromScan: (args: any) => any;
  readonly annotateCandidatesForOperability: (
    candidates: readonly LiveSelectorScanCandidateRecord[],
    session?: any
  ) => readonly LiveSelectorScanCandidateRecord[];
  readonly buildSurfaceModel: (...args: any[]) => any;
  readonly resolveActiveItemId: (...args: any[]) => string | undefined;
  readonly resolveWorkflowRegionForCandidate: (...args: any[]) => any;
  readonly resolveHoverRevealRegion: (...args: any[]) => any;
  readonly deriveLocalDeltaFromReveal: (...args: any[]) => any;
  readonly deriveFocusAtlasLocalDelta: (...args: any[]) => any;
  readonly inferSubgoalFromIntent: (intent: WorkbenchWebTargetIntent) => string;
  readonly showAgentSelectorTarget: (...args: any[]) => Promise<boolean>;
  readonly toAgentTargetFromCandidate: (...args: any[]) => any;
  readonly FOCUS_ATLAS_INTENT: WorkbenchWebTargetIntent;
  readonly VISIBLE_SCAN_MAX: number;
  readonly NEARBY_SCAN_MAX: number;
  readonly EXPANDED_SCAN_MAX: number;
  readonly MAX_EXPANDED_SCROLL_STEPS: number;
  readonly isNoInteractableCandidatesError: (error: unknown) => boolean;
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

export const createWorkbenchWebLiveSelectorOrchestrator = (
  runtime: WorkbenchWebLiveSelectorOrchestratorRuntime
): {
  readonly runLiveSelectorScan: (args: {
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly tabId: string;
    readonly request: WorkbenchWebTargetScanRequest;
    readonly registry: LiveSelectorScanRegistry;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
    readonly focusAtlasRegistry: FocusAtlasRegistry;
  }) => Promise<WorkbenchWebTargetScanResult>;
  readonly runAdaptiveLiveSelectorScan: (args: {
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly tabId: string;
    readonly request: WorkbenchWebTargetScanRequest;
    readonly registry: LiveSelectorScanRegistry;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
    readonly focusAtlasRegistry: FocusAtlasRegistry;
  }) => Promise<WorkbenchWebTargetScanResult>;
} => {
  const {
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
  } = runtime;

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

  return {
    runLiveSelectorScan,
    runAdaptiveLiveSelectorScan,
  };
};
