import type {
  WorkbenchWebFocusReadRequest,
  WorkbenchWebFocusReadResult,
  WorkbenchWebGraphBuildRequest,
  WorkbenchWebGraphBuildResult,
  WorkbenchWebGraphQueryRequest,
  WorkbenchWebGraphQueryResult,
  WorkbenchWebSkeletonReadRequest,
  WorkbenchWebSkeletonReadResult,
} from "../../../shared/workbench-web-automation";
import type {
  WorkbenchWebAutomationCallContext,
  WorkbenchWebAutomationService,
  WorkbenchWebAutomationServiceDeps,
} from "../types";

export type WorkbenchWebCoreReadMethods = Pick<
  WorkbenchWebAutomationService,
  "buildGraph" | "queryGraph" | "readFocusAtlas" | "readSkeleton"
>;

export type WorkbenchWebCoreReadMethodsRuntime = {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly cache: any;
  readonly store: any;
  readonly scanRegistry: any;
  readonly focusAtlasRegistry: any;
  readonly agentSessions: any;
  readonly resolveTabId: (
    deps: WorkbenchWebAutomationServiceDeps,
    requested?: string
  ) => string;
  readonly assertActiveVisiblePage: (
    deps: WorkbenchWebAutomationServiceDeps,
    tabId: string
  ) => void;
  readonly ensureGraphLoaded: (args: any) => Promise<any>;
  readonly queryGraphSnapshot: (args: any) => WorkbenchWebGraphQueryResult;
  readonly buildResultFromSnapshot: (snapshot: any, detail: "summary" | "full") => WorkbenchWebGraphBuildResult;
  readonly buildWebGraphSnapshot: (args: {
    readonly browserBridge: WorkbenchWebAutomationServiceDeps["browserBridge"];
    readonly request?: WorkbenchWebGraphBuildRequest;
  }) => Promise<any>;
  readonly readAgentSession: (...args: any[]) => any;
  readonly rebuildFocusAtlasForTab: (args: any) => Promise<WorkbenchWebFocusReadResult>;
  readonly runLiveSelectorScan: (args: any) => Promise<any>;
  readonly FOCUS_ATLAS_INTENT: any;
  readonly createWebAutomationError: (...args: any[]) => Error;
  readonly buildSkeletonReadResult: (args: any) => WorkbenchWebSkeletonReadResult;
};

export const createWorkbenchWebCoreReadMethods = (
  runtime: WorkbenchWebCoreReadMethodsRuntime
): WorkbenchWebCoreReadMethods => {
  const {
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
  } = runtime;

  return {
    buildGraph: async (request?: WorkbenchWebGraphBuildRequest): Promise<WorkbenchWebGraphBuildResult> => {
      const detail = request?.detail === "full" ? "full" : "summary";
      const snapshot = await buildWebGraphSnapshot({
        browserBridge: deps.browserBridge,
        ...(request === undefined ? {} : { request })
      });

      const normalizedSnapshot = {
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

    queryGraph: async (request?: WorkbenchWebGraphQueryRequest): Promise<WorkbenchWebGraphQueryResult> => {
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
    ): Promise<WorkbenchWebFocusReadResult> => {
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
    ): Promise<WorkbenchWebSkeletonReadResult> => {
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
  };
};
