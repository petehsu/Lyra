import type {
  WorkbenchWebFocusProbeRequest,
  WorkbenchWebFocusProbeResult,
  WorkbenchWebOperabilityReadRequest,
  WorkbenchWebOperabilityReadResult,
  WorkbenchWebTargetScanRequest,
  WorkbenchWebTargetScanResult,
  WorkbenchWebWidgetScanRequest,
  WorkbenchWebWidgetScanResult,
} from "../../../shared/workbench-web-automation";
import type {
  WorkbenchWebAutomationCallContext,
  WorkbenchWebAutomationService,
  WorkbenchWebAutomationServiceDeps,
} from "../types";

export type WorkbenchWebObservationMethods = Pick<
  WorkbenchWebAutomationService,
  "readOperability" | "probeFocus" | "scanWidgets" | "scanTargets"
>;

export type WorkbenchWebObservationMethodsRuntime = {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly agentSessions: any;
  readonly scanRegistry: any;
  readonly focusAtlasRegistry: any;
  readonly resolveTabId: (
    deps: WorkbenchWebAutomationServiceDeps,
    requested?: string
  ) => string;
  readonly assertActiveVisiblePage: (
    deps: WorkbenchWebAutomationServiceDeps,
    tabId: string
  ) => void;
  readonly runLiveSelectorScan: (args: any) => Promise<any>;
  readonly createWebAutomationError: (...args: any[]) => Error;
  readonly FOCUS_ATLAS_INTENT: any;
  readonly resolveFocusProbeCandidate: (args: any) => Promise<any>;
  readonly showAgentSelectorTarget: (...args: any[]) => Promise<boolean>;
  readonly toAgentTargetFromCandidate: (...args: any[]) => any;
  readonly runWithMicroRetry: (...args: any[]) => Promise<any>;
  readonly executeWebActionWithDeadline: (...args: any[]) => Promise<any>;
  readonly syntheticGraphFromCandidate: (
    tabId: string,
    scanSessionId: string,
    candidate: any
  ) => any;
  readonly withResolvedCandidateTarget: (...args: any[]) => any;
  readonly pointerStateForContext: (...args: any[]) => Record<string, unknown>;
  readonly scanLayoutIntelligenceAcrossFrames: (args: any) => Promise<any>;
  readonly readAgentSession: (...args: any[]) => any;
  readonly resolveSessionFocusRegion: (...args: any[]) => any;
  readonly buildFocusAtlas: (...args: any[]) => any;
  readonly annotateCandidatesForOperability: (...args: any[]) => readonly any[];
  readonly focusAtlasDiagnosticsFromScan: (...args: any[]) => any;
  readonly scanScopeOnce: (args: any) => Promise<any>;
  readonly buildSurfaceModel: (...args: any[]) => any;
  readonly visibleScanMax: number;
  readonly nearbyScanMax: number;
};

export const createWorkbenchWebObservationMethods = (
  runtime: WorkbenchWebObservationMethodsRuntime
): WorkbenchWebObservationMethods => {
  const {
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
    visibleScanMax,
    nearbyScanMax,
  } = runtime;

  return {
    readOperability: async (
      request?: WorkbenchWebOperabilityReadRequest,
      context?: WorkbenchWebAutomationCallContext
    ): Promise<WorkbenchWebOperabilityReadResult> => {
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
    ): Promise<WorkbenchWebFocusProbeResult> => {
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

    scanWidgets: async (
      request?: WorkbenchWebWidgetScanRequest,
      context?: WorkbenchWebAutomationCallContext
    ): Promise<WorkbenchWebWidgetScanResult> => {
      const startedAt = Date.now();
      const tabId = resolveTabId(deps, request?.tabId);
      assertActiveVisiblePage(deps, tabId);
      const scope = request?.scope ?? "visible";
      const result = await scanScopeOnce({
        deps,
        tabId,
        intent: FOCUS_ATLAS_INTENT,
        scope,
        maxCandidates: scope === "visible" ? visibleScanMax : nearbyScanMax,
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

    scanTargets: async (
      request: WorkbenchWebTargetScanRequest,
      context?: WorkbenchWebAutomationCallContext
    ): Promise<WorkbenchWebTargetScanResult> => {
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
  };
};
