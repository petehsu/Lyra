import type {
  WorkbenchWebAction,
  WorkbenchWebFocusAtlas,
  WorkbenchWebFocusProbeRequest,
  WorkbenchWebFocusProbeResult,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanResult,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSessionRegistry } from "../agent-session/registry";
import type { FocusAtlasRegistry } from "../focus-atlas/registry";
import type { LiveSelectorScanRegistry } from "../live-selector/scan-session";
import type {
  LiveSelectorScanCandidateRecord,
  LiveSelectorScanSession,
} from "../live-selector/types";
import type {
  WorkbenchWebAutomationCallContext,
  WorkbenchWebAutomationServiceDeps,
} from "../types";

type CandidateResolution = {
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
};

export type WorkbenchWebFocusProbeResolverRuntime = {
  readonly FOCUS_ATLAS_INTENT: WorkbenchWebTargetIntent;
  readonly readAgentSession: (...args: any[]) => any;
  readonly hasExplicitActionTargetSignal: (
    target: Record<string, unknown> | undefined
  ) => boolean;
  readonly resolveCandidateReference: (args: {
    readonly target: Record<string, unknown> | undefined;
    readonly deps?: WorkbenchWebAutomationServiceDeps;
    readonly scanRegistry: LiveSelectorScanRegistry;
    readonly focusAtlasRegistry: FocusAtlasRegistry;
    readonly tabId: string;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  }) => Promise<CandidateResolution>;
  readonly annotateCandidateForOperability: (
    candidate: LiveSelectorScanCandidateRecord,
    session?: any
  ) => LiveSelectorScanCandidateRecord;
  readonly scanScopeOnce: (args: any) => Promise<any>;
  readonly annotateCandidatesForOperability: (
    candidates: readonly LiveSelectorScanCandidateRecord[],
    session?: any
  ) => readonly LiveSelectorScanCandidateRecord[];
  readonly findBestActionTargetCandidate: (args: {
    readonly candidates: readonly LiveSelectorScanCandidateRecord[];
    readonly target: Record<string, unknown>;
    readonly actionKind: WorkbenchWebAction["kind"] | undefined;
  }) => LiveSelectorScanCandidateRecord | undefined;
  readonly createWebAutomationError: (...args: any[]) => Error;
};

export const createWorkbenchWebFocusProbeResolver = (
  runtime: WorkbenchWebFocusProbeResolverRuntime
) => {
  const {
    FOCUS_ATLAS_INTENT,
    readAgentSession,
    hasExplicitActionTargetSignal,
    resolveCandidateReference,
    annotateCandidateForOperability,
    scanScopeOnce,
    annotateCandidatesForOperability,
    findBestActionTargetCandidate,
    createWebAutomationError,
  } = runtime;

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

  return {
    resolveFocusProbeCandidate,
  };
};
