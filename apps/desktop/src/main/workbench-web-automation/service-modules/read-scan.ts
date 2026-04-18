import type {
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
  WorkbenchWebContextReadRequest,
  WorkbenchWebContextReadResult,
  WorkbenchWebQueryRequest,
  WorkbenchWebQueryResult,
  WorkbenchWebScanAndActRequest,
  WorkbenchWebScanAndActResult,
  WorkbenchWebTargetScanScope,
} from "../../../shared/workbench-web-automation";
import type {
  WorkbenchWebAutomationCallContext,
  WorkbenchWebAutomationService,
  WorkbenchWebAutomationServiceDeps,
} from "../types";

export type WorkbenchWebReadScanMethods = Pick<
  WorkbenchWebAutomationService,
  "querySkeleton" | "readContext" | "scanAndAct"
>;

export type WorkbenchWebReadScanMethodsRuntime = {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly agentSessions: any;
  readonly scanRegistry: any;
  readonly focusAtlasRegistry: any;
  readonly queryAttractorStateByTab: Map<string, any>;
  readonly queryIntentCueByTab: Map<string, any>;
  readonly scanAndActProbeCache: Map<string, any>;
  readonly resolveTabId: (
    deps: WorkbenchWebAutomationServiceDeps,
    requested?: string
  ) => string;
  readonly assertActiveVisiblePage: (
    deps: WorkbenchWebAutomationServiceDeps,
    tabId: string
  ) => void;
  readonly buildQueryIntentFromRequest: (request?: WorkbenchWebQueryRequest) => any;
  readonly readSharedFocusAtlasScan: (args: {
    readonly tabId: string;
    readonly minCandidates: number;
  }) => any;
  readonly runAdaptiveLiveSelectorScan: (args: any) => Promise<any>;
  readonly createWebAutomationError: (...args: any[]) => Error;
  readonly buildRegionKindById: (atlas: any) => any;
  readonly candidateSatisfiesQuery: (args: any) => boolean;
  readonly queryScoreCandidate: (args: any) => number;
  readonly applyQueryAttractorGuard: (args: any) => readonly any[];
  readonly toSkeletonNode: (args: any) => any;
  readonly captureQueryIntentCue: (args: any) => any;
  readonly buildSkeletonRegions: (args: any) => readonly any[];
  readonly matchesStableSignature: (candidate: any, fingerprint: Record<string, unknown>) => boolean;
  readonly FOCUS_ATLAS_INTENT: any;
  readonly normalizeScanAndActLatencyBudget: (value: number | undefined) => number;
  readonly mergeActionWithScanAndActHints: (action: any, hints: any) => any;
  readonly hasExplicitActionTargetSignal: (
    target: Record<string, unknown> | undefined
  ) => boolean;
  readonly hasHardStructuredActionTargetSignal: (
    target: Record<string, unknown> | undefined
  ) => boolean;
  readonly safeActions: ReadonlySet<string>;
  readonly navigateActions: ReadonlySet<string>;
  readonly nextLiveSelectorScope: (scope: WorkbenchWebTargetScanScope) => WorkbenchWebTargetScanScope | null;
  readonly runLiveSelectorScan: (args: any) => Promise<any>;
  readonly buildScanAndActIntent: (args: any) => any;
  readonly buildScanAndActFingerprint: (args: any) => string;
  readonly selectScanAndActCandidate: (args: any) => any;
  readonly candidateSupportsActionKind: (candidate: any, action: any) => boolean;
  readonly withResolvedCandidateTarget: (
    request: WorkbenchWebActionRequest,
    candidate: any,
    scanSessionId: string
  ) => WorkbenchWebActionRequest;
  readonly runSafeAction: (
    request: WorkbenchWebActionRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebActionResult>;
  readonly runMutateAction: (
    request: WorkbenchWebActionRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebActionResult>;
  readonly runNavigateAction: (
    request: WorkbenchWebActionRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebActionResult>;
  readonly isVerifiedActionResult: (result: any) => boolean;
  readonly isGoalSatisfiedForResult: (args: any) => boolean;
  readonly visibleScanMax: number;
  readonly nearbyScanMax: number;
  readonly expandedScanMax: number;
  readonly scanAndActCacheTtlMs: number;
  readonly scanAndActDefaultMaxCandidates: number;
  readonly scanAndActDefaultScope: WorkbenchWebTargetScanScope;
};

export const createWorkbenchWebReadScanMethods = (
  runtime: WorkbenchWebReadScanMethodsRuntime
): WorkbenchWebReadScanMethods => {
  const {
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
    safeActions,
    navigateActions,
    nextLiveSelectorScope,
    runLiveSelectorScan,
    buildScanAndActIntent,
    buildScanAndActFingerprint,
    selectScanAndActCandidate,
    candidateSupportsActionKind,
    withResolvedCandidateTarget,
    runSafeAction,
    runMutateAction,
    runNavigateAction,
    isVerifiedActionResult,
    isGoalSatisfiedForResult,
    visibleScanMax,
    nearbyScanMax,
    expandedScanMax,
    scanAndActCacheTtlMs,
    scanAndActDefaultMaxCandidates,
    scanAndActDefaultScope,
  } = runtime;

  return {
    querySkeleton: async (
      request?: WorkbenchWebQueryRequest,
      context?: WorkbenchWebAutomationCallContext
    ): Promise<WorkbenchWebQueryResult> => {
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
      ) => {
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
          candidates: scanResult.candidates,
          reused: false,
          scope
        };
      };
      const rankQueryMatches = (snapshot: any) => {
        const regionKindById = buildRegionKindById(snapshot.atlasEntry.atlas);
        return snapshot.candidates
          .filter((candidate: any) => candidateSatisfiesQuery({
            candidate,
            request: request ?? {},
            regionKindById
          }))
          .map((candidate: any) => ({
            candidate,
            score: queryScoreCandidate({
              candidate,
              request: request ?? {},
              regionKindById
            })
          }))
          .filter((entry: any) => Number.isFinite(entry.score))
          .sort((left: any, right: any) => right.score - left.score);
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
        .map((entry: any) => toSkeletonNode({
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
    ): Promise<WorkbenchWebContextReadResult> => {
      const startedAt = Date.now();
      const tabId = resolveTabId(deps, request?.tabId);
      assertActiveVisiblePage(deps, tabId);
      const scope = request?.scope ?? "neighborhood";
      const maxNodes = Math.max(1, Math.min(48, Math.round(request?.maxNodes ?? 12)));
      const loadContextSnapshot = async (forceRefresh: boolean) => {
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
          candidates: scanResult.candidates,
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
        : snapshot.candidates.find((candidate: any) => candidate.candidateId === nodeRef.nodeId);
      if (seedCandidate === undefined && staleSeedCandidate !== undefined) {
        seedCandidate = snapshot.candidates.find((candidate: any) =>
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
        : buildSkeletonRegions({ atlas: snapshot.atlasEntry.atlas, revision }).find((entry: any) => entry.regionId === regionId);
      let selectedCandidates = (() => {
        switch (scope) {
          case "node":
            return seedCandidate === undefined || seedCandidate.candidateId !== nodeRef?.nodeId ? [] : [seedCandidate];
          case "region":
            return regionId === undefined
              ? snapshot.candidates.slice(0, maxNodes)
              : snapshot.candidates.filter((candidate: any) => candidate.focusRegionId === regionId).slice(0, maxNodes);
          case "page":
            return snapshot.candidates.slice(0, maxNodes);
          case "neighborhood":
          default: {
            const seed = seedCandidate;
            if (seed === undefined) {
              return regionId === undefined
                ? snapshot.candidates.slice(0, maxNodes)
                : snapshot.candidates.filter((candidate: any) => candidate.focusRegionId === regionId).slice(0, maxNodes);
            }
            return snapshot.candidates
              .filter((candidate: any) =>
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
          : snapshot.candidates.find((candidate: any) => candidate.candidateId === nodeRef.nodeId);
        if (seedCandidate === undefined && staleSeedCandidate !== undefined) {
          seedCandidate = snapshot.candidates.find((candidate: any) =>
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
          : buildSkeletonRegions({ atlas: snapshot.atlasEntry.atlas, revision }).find((entry: any) => entry.regionId === regionId);
        selectedCandidates = (() => {
          switch (scope) {
            case "node":
              return seedCandidate === undefined ? [] : [seedCandidate];
            case "region":
              return regionId === undefined
                ? snapshot.candidates.slice(0, maxNodes)
                : snapshot.candidates.filter((candidate: any) => candidate.focusRegionId === regionId).slice(0, maxNodes);
            case "page":
              return snapshot.candidates.slice(0, maxNodes);
            case "neighborhood":
            default: {
              const seed = seedCandidate;
              if (seed === undefined) {
                return regionId === undefined
                  ? snapshot.candidates.slice(0, maxNodes)
                  : snapshot.candidates.filter((candidate: any) => candidate.focusRegionId === regionId).slice(0, maxNodes);
              }
              return snapshot.candidates
                .filter((candidate: any) =>
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
      const nodes = selectedCandidates.map((candidate: any) => toSkeletonNode({
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

    scanAndAct: async (
      request: WorkbenchWebScanAndActRequest,
      context?: WorkbenchWebAutomationCallContext
    ): Promise<WorkbenchWebScanAndActResult> => {
      const startedAt = Date.now();
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);
      const scope = request.scope ?? scanAndActDefaultScope;
      const maxCandidates = Math.max(
        1,
        Math.min(
          scope === "expanded" ? expandedScanMax : scope === "nearby" ? nearbyScanMax : visibleScanMax,
          Math.round(request.maxCandidates ?? scanAndActDefaultMaxCandidates)
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
      const isNavigateAction = navigateActions.has(action.kind);
      let scanCount = 0;
      let gateRetryCount = 0;
      let actionAttempts = 0;
      let goalGateSoftFailed = false;
      let cacheHit = false;
      let continuationApplied = false;
      let scanSkipped = false;
      let selectedCandidate: any;
      let selectedScanSessionId: string | undefined;
      let selectedScope = scope;
      const actionConstraints = request.constraints;
      const actionTimeoutMs = actionConstraints?.timeoutMs ?? request.timeoutMs;
      const waitForNavigationMs =
        actionConstraints?.waitForNavigationMs ?? request.waitForNavigationMs;

      let actionRequest: WorkbenchWebActionRequest = {
        tabId,
        ...(request.graphId === undefined ? {} : { graphId: request.graphId }),
        action,
        ...(actionConstraints === undefined ? {} : { constraints: actionConstraints }),
        timeoutMs:
          actionTimeoutMs === undefined
            ? Math.max(3_500, Math.min(7_500, maxLatencyMs + 2_500))
            : actionTimeoutMs,
        ...(waitForNavigationMs === undefined
          ? {}
          : { waitForNavigationMs })
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
        const scopesToTry: WorkbenchWebTargetScanScope[] = [scope];
        const fallbackScope = nextLiveSelectorScope(scope);
        if (fallbackScope !== null) {
          scopesToTry.push(fallbackScope);
        }

        let fallbackCandidate: any;
        for (const [attemptIndex, scanScope] of scopesToTry.entries()) {
          if (attemptIndex > 0 && Date.now() - startedAt > maxLatencyMs) {
            break;
          }
          const cacheKey = `${tabId}::${scanScope}::${maxCandidates}::${fingerprint}`;
          const now = Date.now();
          const cached = scanAndActProbeCache.get(cacheKey);
          let scanResult: any;
          if (cached !== undefined && now - cached.cachedAt <= scanAndActCacheTtlMs) {
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
        ? await runNavigateAction(actionRequest, context)
        : safeActions.has(actionRequest.action.kind)
          ? await runSafeAction(actionRequest, context)
          : await runMutateAction(actionRequest, context);
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
  };
};
