import type {
  WorkbenchWebFocusAtlas,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanRequest,
  WorkbenchWebTargetScanResult,
  WorkbenchWebTargetScanScope,
  WorkbenchWebWidgetScanResult,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import { buildFocusAtlas } from "../focus-atlas/build";
import { rankLiveSelectorCandidates } from "../live-selector/candidate-ranker";
import { prioritizeSurfaceCandidates } from "../live-selector/surface-filter";
import { buildLiveSelectorScrollScript } from "../live-selector/scan-script";
import type { LiveSelectorScanCandidateRecord, LiveSelectorScanSession } from "../live-selector/types";
import { scanLayoutIntelligenceAcrossFrames } from "../layout-intelligence/service";
import type { WorkbenchWebAutomationServiceDeps } from "../types";

export type WorkbenchWebScanPrimitivesRuntime = {
  readonly applyFocusAtlasMetadata: (args: any) => {
    readonly candidates: readonly LiveSelectorScanCandidateRecord[];
    readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  };
  readonly resolveSessionFocusRegion: (
    session: WorkbenchAgentWebSession | null | undefined,
    intent: WorkbenchWebTargetIntent
  ) => WorkbenchWebFocusAtlas["regions"][number]["bounds"] | undefined;
  readonly shouldAttemptHoverReveal: (
    candidate: LiveSelectorScanCandidateRecord,
    pageMode: WorkbenchWebTargetScanResult["pageMode"]
  ) => boolean;
  readonly isLocallyRelevantCandidate: (args: {
    readonly candidate: LiveSelectorScanCandidateRecord;
    readonly seed: LiveSelectorScanCandidateRecord;
    readonly revealRegion: any;
  }) => boolean;
  readonly mergeRevealedCandidates: (args: {
    readonly baseline: readonly LiveSelectorScanCandidateRecord[];
    readonly revealed: readonly LiveSelectorScanCandidateRecord[];
    readonly intent: WorkbenchWebTargetIntent;
  }) => readonly LiveSelectorScanCandidateRecord[];
  readonly executeWebActionWithDeadline: (args: any) => Promise<any>;
  readonly syntheticGraphFromCandidate: (
    tabId: string,
    scanSessionId: string,
    candidate: LiveSelectorScanCandidateRecord
  ) => any;
  readonly resolveHoverRevealRegion: (args: {
    readonly seed: LiveSelectorScanCandidateRecord;
    readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
    readonly containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
  }) => any;
  readonly visibleScanMax: number;
};

export const createWorkbenchWebScanPrimitives = (
  runtime: WorkbenchWebScanPrimitivesRuntime
): {
  readonly scanScopeOnce: (args: {
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly tabId: string;
    readonly intent: WorkbenchWebTargetIntent;
    readonly scope: "visible" | "nearby" | "expanded";
    readonly maxCandidates: number;
    readonly widgetId?: string;
    readonly regionId?: string;
    readonly scrollStep?: number;
    readonly surfaceSession?: WorkbenchAgentWebSession | null;
  }) => Promise<{
    readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
    readonly focusAtlas: WorkbenchWebFocusAtlas;
    readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
    readonly layoutNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["layoutNodes"]>[number][];
    readonly containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
    readonly candidates: readonly LiveSelectorScanCandidateRecord[];
    readonly scannedFrames: number;
    readonly scannedCandidates: number;
    readonly scrolled: boolean;
  }>;
  readonly runHoverRevealPass: (args: {
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
  }) => Promise<{
    readonly candidates: readonly LiveSelectorScanCandidateRecord[];
    readonly focusAtlas: WorkbenchWebFocusAtlas;
    readonly scannedFrames: number;
    readonly scannedCandidates: number;
    readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
    readonly containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
    readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
  } | null>;
  readonly runActionRevealPass: (args: {
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly tabId: string;
    readonly candidate: LiveSelectorScanCandidateRecord;
    readonly scanSession: LiveSelectorScanSession;
    readonly surfaceSession?: WorkbenchAgentWebSession | null;
    readonly maxMicroSteps?: number;
  }) => Promise<{
    readonly pageMode: WorkbenchWebTargetScanResult["pageMode"];
    readonly focusAtlas: WorkbenchWebFocusAtlas;
    readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
    readonly containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
    readonly candidates: readonly LiveSelectorScanCandidateRecord[];
    readonly scannedFrames: number;
    readonly scannedCandidates: number;
  } | null>;
} => {
  const {
    applyFocusAtlasMetadata,
    resolveSessionFocusRegion,
    shouldAttemptHoverReveal,
    isLocallyRelevantCandidate,
    mergeRevealedCandidates,
    executeWebActionWithDeadline,
    syntheticGraphFromCandidate,
    resolveHoverRevealRegion,
    visibleScanMax,
  } = runtime;

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
        maxCandidates: Math.max(request.maxCandidates ?? visibleScanMax, 24),
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

  return {
    scanScopeOnce,
    runHoverRevealPass,
    runActionRevealPass,
  };
};
