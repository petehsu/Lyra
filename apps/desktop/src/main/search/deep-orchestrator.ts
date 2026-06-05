import { randomUUID } from "node:crypto";

import type {
  SearchAggregateEngineBucket,
  SearchAggregateRequest,
  SearchAggregateResponse,
  SearchAggregateResult,
  SearchDeepBudgetPreset,
  SearchDeepEdge,
  SearchDeepExpandRequest,
  SearchDeepExpandResponse,
  SearchDeepNode,
  SearchDeepRequest,
  SearchDeepSnapshot,
  SearchDeepStreamCancelRequest,
  SearchDeepStreamCancelResponse,
  SearchDeepStreamReadRequest,
  SearchDeepStreamReadResponse,
  SearchDeepStreamStartRequest,
  SearchDeepStreamStartResponse,
  SearchLocalResponse,
  SearchLocalResultItem,
  SearchLocalStats,
  SearchLocalStreamReadResponse,
  SearchLocalStreamStartResponse
} from "../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../runtime-client";
import { toResultMergeKey } from "./parse";
import { searchIntelligenceEngine } from "./query-understanding";
import {
  createSiteExpansionEngine,
  toDeepSearchGraphPatch,
  type SearchSiteGraphPatch
} from "./site-expansion";
import { aggregateSearch } from "./service";

const ROOT_RESULT_STREAM_THRESHOLD = 4;
const ROOT_RESULT_STREAM_DELAY_MS = 1_200;
const ROOT_LOCAL_POLL_MS = 70;
const ROOT_SITE_POLL_MS = 180;
const DEFAULT_ROOT_WEB_LIMIT = 5;
const DEFAULT_EXPANSION_WEB_LIMIT = 4;
const DEFAULT_ROOT_LOCAL_LIMIT = 24;
const DEFAULT_EXPANSION_LOCAL_LIMIT = 10;
const RELATED_SCORE_THRESHOLD = 0.34;
const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "this",
  "that",
  "have",
  "your",
  "about",
  "into",
  "using",
  "used",
  "user",
  "users",
  "page",
  "site",
  "home",
  "file",
  "files",
  "index",
  "readme",
  "docs",
  "document",
  "documents",
  "guide",
  "overview",
  "官网",
  "网站",
  "页面",
  "首页",
  "官方",
  "帮助",
  "搜索"
]);

type BudgetConfig = {
  readonly maxDerivedQueries: number;
  readonly maxResultNodes: number;
  readonly concurrency: number;
  readonly maxDomainFamilies: number;
};

type DeepStreamState = {
  readonly streamId: string;
  readonly storageRoot: string;
  readonly request: SearchDeepRequest;
  readonly createdAtMs: number;
  readonly rootNodeId: string;
  readonly budget: BudgetConfig;
  snapshot: SearchDeepSnapshot;
  readonly queryNodeIdByKey: Map<string, string>;
  readonly webKeys: Set<string>;
  readonly localKeys: Set<string>;
  readonly edgeKeys: Set<string>;
  readonly expandedNodeIds: Set<string>;
  readonly nodeIds: Set<string>;
  localStreamId: string | null;
  localPollTimer: ReturnType<typeof setTimeout> | null;
  readonly siteStreamIds: Set<string>;
  activeJobs: number;
  rootWebDone: boolean;
  rootLocalDone: boolean;
  rootSiteDone: boolean;
  autoExpansionStarted: boolean;
  cancelled: boolean;
  done: boolean;
  error?: string;
};

const ZERO_LOCAL_STATS: SearchLocalStats = {
  scannedFiles: 0,
  scannedDirs: 0,
  contentScannedFiles: 0,
  matchedFiles: 0,
  skippedUnreadable: 0,
  skippedBinaryOrTooLarge: 0,
  usedIndex: false
};

const resolveBudget = (preset: SearchDeepBudgetPreset): BudgetConfig => {
  if (preset === "low") {
    return {
      maxDerivedQueries: 4,
      maxResultNodes: 40,
      concurrency: 2,
      maxDomainFamilies: 1
    };
  }
  if (preset === "high") {
    return {
      maxDerivedQueries: 12,
      maxResultNodes: 140,
      concurrency: 6,
      maxDomainFamilies: 4
    };
  }
  return {
    maxDerivedQueries: 8,
    maxResultNodes: 80,
    concurrency: 4,
    maxDomainFamilies: 2
  };
};

const normalizeQueryKey = (value: string): string => value.trim().toLowerCase();

const tokenize = (value: string): readonly string[] =>
  (value.toLowerCase().match(/[a-z0-9\u4e00-\u9fff][a-z0-9._+\-\u4e00-\u9fff]{1,31}/g) ?? [])
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && STOP_WORDS.has(token) === false);

const overlapScore = (left: readonly string[], right: readonly string[]): number => {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftSet.size, rightSet.size);
};

const cloneLocalStats = (stats: SearchLocalStats): SearchLocalStats => ({
  scannedFiles: stats.scannedFiles,
  scannedDirs: stats.scannedDirs,
  contentScannedFiles: stats.contentScannedFiles,
  matchedFiles: stats.matchedFiles,
  skippedUnreadable: stats.skippedUnreadable,
  skippedBinaryOrTooLarge: stats.skippedBinaryOrTooLarge,
  usedIndex: stats.usedIndex
});

const mergeLocalStats = (
  current: SearchLocalStats,
  next: SearchLocalStats
): SearchLocalStats => ({
  scannedFiles: current.scannedFiles + next.scannedFiles,
  scannedDirs: current.scannedDirs + next.scannedDirs,
  contentScannedFiles: current.contentScannedFiles + next.contentScannedFiles,
  matchedFiles: current.matchedFiles + next.matchedFiles,
  skippedUnreadable: current.skippedUnreadable + next.skippedUnreadable,
  skippedBinaryOrTooLarge: current.skippedBinaryOrTooLarge + next.skippedBinaryOrTooLarge,
  usedIndex: current.usedIndex || next.usedIndex
});

const createQueryNode = (
  id: string,
  kind: "root_query" | "derived_query",
  title: string,
  subtitle: string,
  status: SearchDeepNode["status"]
): SearchDeepNode => ({
  id,
  kind,
  title,
  subtitle,
  status,
  metadata: {
    query: title
  }
});

const createDiscoveredEdge = (
  sourceId: string,
  targetId: string,
  metadata?: SearchDeepEdge["metadata"]
): SearchDeepEdge => ({
  id: `discover:${sourceId}:${targetId}`,
  sourceId,
  targetId,
  kind: "discovered_from",
  ...(metadata === undefined
    ? {}
    : {
        reasonCode:
          metadata.sourceEngineIds !== undefined
            ? "web_match"
            : "local_match",
        metadata
      })
});

const createExpandedEdge = (
  sourceId: string,
  targetId: string,
  metadata?: SearchDeepEdge["metadata"]
): SearchDeepEdge => ({
  id: `expand:${sourceId}:${targetId}`,
  sourceId,
  targetId,
  kind: "expanded_to",
  reasonCode: "query_expansion",
  ...(metadata === undefined ? {} : { metadata })
});

const createRelatedEdge = (
  sourceId: string,
  targetId: string,
  metadata?: SearchDeepEdge["metadata"]
): SearchDeepEdge => ({
  id: `related:${sourceId}:${targetId}`,
  sourceId,
  targetId,
  kind: "related_to",
  reasonCode: "semantic_overlap",
  ...(metadata === undefined ? {} : { metadata })
});

const createEmptySnapshot = (request: SearchDeepRequest, rootNodeId: string): SearchDeepSnapshot => ({
  query: request.query,
  budgetPreset: request.budgetPreset,
  phase: "bootstrapping",
  nodes: [
    createQueryNode(rootNodeId, "root_query", request.query, "root", "ready")
  ],
  edges: [],
  web: {
    status: "loading",
    engineBuckets: [],
    blendedCount: 0,
    siteExpansion: {
      status: "idle",
      domainCandidates: 0,
      verifiedDomains: 0,
      discoveredSubdomains: 0,
      visitedPages: 0,
      queuedPages: 0,
      droppedPages: 0,
      guessAttempts: 0
    }
  },
  local: {
    status: "loading",
    scopePreset: "home",
    roots: [],
    elapsedMs: 0,
    stats: cloneLocalStats(ZERO_LOCAL_STATS)
  },
  stats: {
    dedupedResults: 0,
    derivedQueries: 0,
    expansionRounds: 0
  },
  lastUpdatedAt: new Date().toISOString()
});

const getSiteExpansionStats = (snapshot: SearchDeepSnapshot) =>
  snapshot.web.siteExpansion ?? {
    status: "idle" as const,
    domainCandidates: 0,
    verifiedDomains: 0,
    discoveredSubdomains: 0,
    visitedPages: 0,
    queuedPages: 0,
    droppedPages: 0,
    guessAttempts: 0
  };

const countResultNodes = (snapshot: SearchDeepSnapshot): number =>
  snapshot.nodes.filter((node) =>
    node.kind === "web_page"
    || node.kind === "site_domain"
    || node.kind === "site_subdomain"
    || node.kind === "local_result"
  ).length;

const updateSnapshot = (state: DeepStreamState, updater: (snapshot: SearchDeepSnapshot) => SearchDeepSnapshot): void => {
  state.snapshot = {
    ...updater(state.snapshot),
    lastUpdatedAt: new Date().toISOString()
  };
};

const maybePromotePhase = (state: DeepStreamState): void => {
  if (state.snapshot.phase !== "bootstrapping") {
    return;
  }
  const resultCount = countResultNodes(state.snapshot);
  const waitedMs = Date.now() - state.createdAtMs;
  if (
    resultCount >= ROOT_RESULT_STREAM_THRESHOLD
    || (waitedMs >= ROOT_RESULT_STREAM_DELAY_MS && resultCount > 0)
  ) {
    updateSnapshot(state, (snapshot) => ({
      ...snapshot,
      phase: "streaming"
    }));
  }
};

const resolveFinalPhase = (state: DeepStreamState): SearchDeepSnapshot["phase"] => {
  if (state.error !== undefined && countResultNodes(state.snapshot) === 0) {
    return "error";
  }
  return "completed";
};

const normalizeWebMetadataText = (node: SearchDeepNode): string =>
  [
    node.title,
    node.subtitle ?? "",
    typeof node.metadata?.snippet === "string" ? node.metadata.snippet : "",
    typeof node.metadata?.contentPreview === "string" ? node.metadata.contentPreview : "",
    Array.isArray(node.metadata?.sourceEngineIds)
      ? (node.metadata?.sourceEngineIds as readonly string[]).join(" ")
      : ""
  ].join(" ");

const normalizeLocalMetadataText = (node: SearchDeepNode): string =>
  [
    node.title,
    node.subtitle ?? "",
    typeof node.metadata?.displayPath === "string" ? node.metadata.displayPath : "",
    typeof node.metadata?.snippet === "string" ? node.metadata.snippet : ""
  ].join(" ");

const maybeLinkRelatedNode = (
  state: DeepStreamState,
  nextNode: SearchDeepNode
): void => {
  if (nextNode.kind !== "web_page" && nextNode.kind !== "local_result") {
    return;
  }
  const nextTokens = tokenize(
    nextNode.kind === "web_page"
      ? normalizeWebMetadataText(nextNode)
      : normalizeLocalMetadataText(nextNode)
  );
  if (nextTokens.length === 0) {
    return;
  }

  const oppositeKind = nextNode.kind === "web_page" ? "local_result" : "web_page";
  const relatedCandidates = state.snapshot.nodes.filter((node) => node.kind === oppositeKind);
  for (const candidate of relatedCandidates) {
    const candidateTokens = tokenize(
      candidate.kind === "web_page"
        ? normalizeWebMetadataText(candidate)
        : normalizeLocalMetadataText(candidate)
    );
    const similarity = overlapScore(nextTokens, candidateTokens);
    if (similarity < RELATED_SCORE_THRESHOLD) {
      continue;
    }
    const sharedTokens = [...new Set(nextTokens.filter((token) => candidateTokens.includes(token)))].slice(0, 4);
    const edge = createRelatedEdge(nextNode.id, candidate.id, {
      sharedTokens,
      overlapScore: similarity
    });
    if (state.edgeKeys.has(edge.id)) {
      continue;
    }
    state.edgeKeys.add(edge.id);
    updateSnapshot(state, (snapshot) => ({
      ...snapshot,
      edges: [...snapshot.edges, edge]
    }));
    break;
  }
};

const addEdgeIfMissing = (state: DeepStreamState, edge: SearchDeepEdge): void => {
  if (state.edgeKeys.has(edge.id)) {
    return;
  }
  state.edgeKeys.add(edge.id);
  updateSnapshot(state, (snapshot) => ({
    ...snapshot,
    edges: [...snapshot.edges, edge]
  }));
};

const addNodeIfMissing = (state: DeepStreamState, node: SearchDeepNode): boolean => {
  if (state.nodeIds.has(node.id)) {
    return false;
  }
  state.nodeIds.add(node.id);
  updateSnapshot(state, (snapshot) => ({
    ...snapshot,
    nodes: [...snapshot.nodes, node]
  }));
  return true;
};

const addWebResults = (
  state: DeepStreamState,
  parentNodeId: string,
  results: readonly SearchAggregateResult[]
): void => {
  for (let index = 0; index < results.length; index += 1) {
    if (countResultNodes(state.snapshot) >= state.budget.maxResultNodes) {
      return;
    }
    const result = results[index];
    if (result === undefined) {
      continue;
    }
    const mergeKey = toResultMergeKey(result.url);
    const nodeId = `page:${mergeKey}`;
    if (state.webKeys.has(mergeKey)) {
      updateSnapshot(state, (snapshot) => ({
        ...snapshot,
        stats: {
          ...snapshot.stats,
          dedupedResults: snapshot.stats.dedupedResults + 1
        }
      }));
      addEdgeIfMissing(state, createDiscoveredEdge(parentNodeId, nodeId, {
        sourceEngineIds: result.sourceEngineIds
      }));
      continue;
    }
    state.webKeys.add(mergeKey);
    let hostname = result.displayUrl;
    let registrableDomain = result.displayUrl;
    try {
      const parsed = new URL(result.url);
      hostname = parsed.hostname.toLowerCase();
      registrableDomain = hostname.split(".").slice(-2).join(".") || hostname;
    } catch (_error) {
      // Fall back to display url.
    }
    const node: SearchDeepNode = {
      id: nodeId,
      kind: "web_page",
      title: result.title,
      subtitle: result.displayUrl,
      status: "ready",
      score: 120 - index * 3 + result.sourceEngineIds.length * 2,
      sourceKinds: ["web"],
      metadata: {
        url: result.url,
        canonicalUrl: result.url,
        hostname,
        registrableDomain,
        snippet: result.snippet,
        fetchDepth: 0,
        discoveredBy: "search",
        sourceEngineIds: result.sourceEngineIds,
        ...(result.isOfficialResult === true ? { isOfficialResult: true } : {}),
        ...(result.officialCategory === undefined ? {} : { officialCategory: result.officialCategory })
      }
    };
    addNodeIfMissing(state, node);
    addEdgeIfMissing(state, createDiscoveredEdge(parentNodeId, node.id, {
      sourceEngineIds: result.sourceEngineIds
    }));
    maybeLinkRelatedNode(state, node);
  }
  maybePromotePhase(state);
};

const addLocalResults = (
  state: DeepStreamState,
  parentNodeId: string,
  results: readonly SearchLocalResultItem[]
): void => {
  for (const result of results) {
    if (countResultNodes(state.snapshot) >= state.budget.maxResultNodes) {
      return;
    }
    const nodeId = `local:${result.path}`;
    if (state.localKeys.has(result.path)) {
      updateSnapshot(state, (snapshot) => ({
        ...snapshot,
        stats: {
          ...snapshot.stats,
          dedupedResults: snapshot.stats.dedupedResults + 1
        }
      }));
      addEdgeIfMissing(state, createDiscoveredEdge(parentNodeId, nodeId, {
        matchKind: result.matchKind,
        ...(result.line === undefined ? {} : { line: result.line })
      }));
      continue;
    }
    state.localKeys.add(result.path);
    const node: SearchDeepNode = {
      id: nodeId,
      kind: "local_result",
      title: result.fileName,
      subtitle: result.displayPath,
      status: "ready",
      score: result.score,
      sourceKinds: ["local"],
      metadata: {
        path: result.path,
        displayPath: result.displayPath,
        ...(result.snippet === undefined ? {} : { snippet: result.snippet }),
        ...(result.line === undefined ? {} : { line: result.line }),
        ...(result.extension === undefined ? {} : { extension: result.extension }),
        ...(result.modifiedAt === undefined ? {} : { modifiedAt: result.modifiedAt }),
        matchKind: result.matchKind
      }
    };
    addNodeIfMissing(state, node);
    addEdgeIfMissing(state, createDiscoveredEdge(parentNodeId, node.id, {
      matchKind: result.matchKind,
      ...(result.line === undefined ? {} : { line: result.line })
    }));
    maybeLinkRelatedNode(state, node);
  }
  maybePromotePhase(state);
};

const pickExpansionSeeds = (
  state: DeepStreamState,
  parentNodeId: string
): readonly SearchDeepNode[] => {
  const childIds = state.snapshot.edges
    .filter((edge) =>
      (edge.kind === "discovered_from" || edge.kind === "contains_page" || edge.kind === "hosts_subdomain")
      && edge.sourceId === parentNodeId
    )
    .map((edge) => edge.targetId);
  if (childIds.length === 0 && parentNodeId === state.rootNodeId) {
    return state.snapshot.nodes.filter((node) => node.kind === "web_page" || node.kind === "local_result");
  }
  const idSet = new Set(childIds);
  return state.snapshot.nodes.filter((node) => idSet.has(node.id));
};

type DerivedQuerySeed = {
  readonly query: string;
  readonly derivedToken: string;
  readonly seedQuery: string;
};

const buildDerivedQueries = (
  baseQuery: string,
  seedNodes: readonly SearchDeepNode[],
  limit: number,
  existingKeys: ReadonlySet<string>
): readonly DerivedQuerySeed[] => {
  const intentAwareVariants = searchIntelligenceEngine.buildDerivedQueryVariants(
    baseQuery,
    existingKeys,
    limit
  );
  const baseTokens = new Set(tokenize(baseQuery));
  const scores = new Map<string, number>();

  seedNodes.forEach((node, index) => {
    const weight = Math.max(1, 12 - index);
    const sourceText =
      node.kind === "web_page"
      || node.kind === "site_domain"
      || node.kind === "site_subdomain"
        ? normalizeWebMetadataText(node)
        : normalizeLocalMetadataText(node);
    const tokens = tokenize(sourceText).filter((token) => baseTokens.has(token) === false);
    tokens.forEach((token, tokenIndex) => {
      scores.set(token, (scores.get(token) ?? 0) + Math.max(1, weight - tokenIndex));
    });
  });

  const tokenVariants = [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .map(([token]) => ({
      query: `${baseQuery} ${token}`.trim(),
      derivedToken: token,
      seedQuery: baseQuery
    }))
    .filter((candidate) => existingKeys.has(normalizeQueryKey(candidate.query)) === false);

  return [...intentAwareVariants, ...tokenVariants].slice(0, limit);
};

const readRuntime = async <T>(
  runtimeClient: LyraRuntimeClient,
  storageRoot: string,
  method: string,
  payload: unknown
): Promise<T> =>
  await runtimeClient.request<T>(method, {
    storageRoot,
    ...((payload ?? {}) as Record<string, unknown>)
  });

const waitFor = async (delayMs: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const mergeSitePatch = (state: DeepStreamState, patch: SearchSiteGraphPatch): void => {
  patch.nodes.forEach((node) => {
    const added = addNodeIfMissing(state, node);
    if (added && node.kind === "web_page") {
      maybeLinkRelatedNode(state, node);
    }
  });
  patch.edges.forEach((edge) => {
    addEdgeIfMissing(state, edge);
  });
  updateSnapshot(state, (snapshot) => ({
    ...snapshot,
    web: {
      ...snapshot.web,
      siteExpansion: {
        status: patch.stats.status,
        domainCandidates: patch.stats.domainCandidates,
        verifiedDomains: patch.stats.verifiedDomains,
        discoveredSubdomains: patch.stats.discoveredSubdomains,
        visitedPages: patch.stats.visitedPages,
        queuedPages: patch.stats.queuedPages,
        droppedPages: patch.stats.droppedPages,
        guessAttempts: patch.stats.guessAttempts,
        ...(patch.stats.error === undefined ? {} : { error: patch.stats.error })
      }
    }
  }));
  maybePromotePhase(state);
};

const shouldExpandSites = (
  state: DeepStreamState,
  query: string,
  results: readonly SearchAggregateResult[]
): boolean => {
  if (state.request.enableSiteExpansion === false) {
    return false;
  }
  const understanding = searchIntelligenceEngine.understandQuery(query);
  if (
    understanding.officialHint
    || understanding.docsHint
    || understanding.loginHint
    || understanding.downloadHint
    || understanding.primaryIntent === "navigational"
  ) {
    return true;
  }
  return results.some((result) => result.isOfficialResult === true);
};

const runSiteExpansion = async (
  siteExpansionEngine: ReturnType<typeof createSiteExpansionEngine>,
  state: DeepStreamState,
  parentNodeId: string,
  query: string,
  results: readonly SearchAggregateResult[],
  persistAsRoot = false
): Promise<void> => {
  if (state.cancelled || shouldExpandSites(state, query, results) === false) {
    if (persistAsRoot) {
      state.rootSiteDone = true;
      updateSnapshot(state, (snapshot) => ({
        ...snapshot,
        web: {
          ...snapshot.web,
          siteExpansion: {
            ...getSiteExpansionStats(snapshot),
            status: "ready"
          }
        }
      }));
    }
    return;
  }
  const extraction = searchIntelligenceEngine.extractSiteSeeds(query, results);
  const seeds = state.request.enableProactiveDomainGuessing === false
    ? extraction.seeds.filter((seed) => seed.guessSource !== "guessed")
    : extraction.seeds;
  const filteredExtraction = {
    ...extraction,
    seeds,
    targets: state.request.enableProactiveDomainGuessing === false
      ? extraction.targets.filter((target) => target.guessedOnly === false)
      : extraction.targets
  };
  const targets = searchIntelligenceEngine.chooseExpansionTargets(
    filteredExtraction,
    state.budget.maxDomainFamilies
  );
  if (targets.length === 0) {
    if (persistAsRoot) {
      state.rootSiteDone = true;
      updateSnapshot(state, (snapshot) => ({
        ...snapshot,
        web: {
          ...snapshot.web,
          siteExpansion: {
            ...getSiteExpansionStats(snapshot),
            status: "ready",
            domainCandidates: filteredExtraction.targets.length,
            guessAttempts: filteredExtraction.seeds.filter((seed) => seed.guessSource === "guessed").length
          }
        }
      }));
    }
    return;
  }

  const started = await siteExpansionEngine.start({
    query,
    understanding: filteredExtraction.understanding,
    budgetPreset: state.request.budgetPreset,
    seeds: filteredExtraction.seeds,
    targets,
    enableProactiveDomainGuessing: state.request.enableProactiveDomainGuessing !== false,
    crawlPolicy: state.request.crawlPolicy ?? "accessibility_only"
  });
  state.siteStreamIds.add(started.streamId);
  mergeSitePatch(state, toDeepSearchGraphPatch(parentNodeId, started.snapshot));
  while (state.cancelled === false) {
    const next = await siteExpansionEngine.read(started.streamId);
    mergeSitePatch(state, toDeepSearchGraphPatch(parentNodeId, next.snapshot));
    if (next.done) {
      break;
    }
    await waitFor(ROOT_SITE_POLL_MS);
  }
  state.siteStreamIds.delete(started.streamId);
  if (persistAsRoot) {
    state.rootSiteDone = true;
  }
};

const runAggregate = async (
  request: SearchDeepRequest,
  query: string,
  limitPerEngine: number
): Promise<SearchAggregateResponse> =>
  await aggregateSearch({
    query,
    limitPerEngine,
    engines: request.engines
  } satisfies SearchAggregateRequest);

const markQueryNodeStatus = (
  state: DeepStreamState,
  nodeId: string,
  status: SearchDeepNode["status"]
): void => {
  updateSnapshot(state, (snapshot) => ({
    ...snapshot,
    nodes: snapshot.nodes.map((node) => (
      node.id === nodeId
        ? {
            ...node,
            status
          }
        : node
    ))
  }));
};

const createDerivedNode = (
  state: DeepStreamState,
  parentNodeId: string,
  query: string,
  metadata?: SearchDeepEdge["metadata"]
): string => {
  const key = normalizeQueryKey(query);
  const existingId = state.queryNodeIdByKey.get(key);
  if (existingId !== undefined) {
    addEdgeIfMissing(state, createExpandedEdge(parentNodeId, existingId, metadata));
    return existingId;
  }

  const nodeId = `query:${randomUUID()}`;
  state.queryNodeIdByKey.set(key, nodeId);
  const node = createQueryNode(nodeId, "derived_query", query, "derived", "loading");
  state.nodeIds.add(nodeId);
  updateSnapshot(state, (snapshot) => ({
    ...snapshot,
    nodes: [...snapshot.nodes, node],
    stats: {
      ...snapshot.stats,
      derivedQueries: snapshot.stats.derivedQueries + 1
    }
  }));
  addEdgeIfMissing(state, createExpandedEdge(parentNodeId, nodeId, metadata));
  return nodeId;
};

const completeIfSettled = (state: DeepStreamState): void => {
  if (state.cancelled || state.done) {
    return;
  }
  if (state.activeJobs > 0) {
    return;
  }
  if (state.rootWebDone === false || state.rootLocalDone === false || state.rootSiteDone === false) {
    return;
  }
  if (state.autoExpansionStarted === false) {
    return;
  }
  state.done = true;
  updateSnapshot(state, (snapshot) => ({
    ...snapshot,
    phase: resolveFinalPhase(state)
  }));
};

const beginJob = (state: DeepStreamState): void => {
  state.activeJobs += 1;
};

const endJob = (state: DeepStreamState): void => {
  state.activeJobs = Math.max(0, state.activeJobs - 1);
  completeIfSettled(state);
};

const searchDerivedQuery = async (
  runtimeClient: LyraRuntimeClient,
  siteExpansionEngine: ReturnType<typeof createSiteExpansionEngine>,
  state: DeepStreamState,
  parentNodeId: string,
  query: string,
  metadata?: SearchDeepEdge["metadata"]
): Promise<void> => {
  if (state.cancelled) {
    return;
  }
  const derivedNodeId = createDerivedNode(state, parentNodeId, query, metadata);
  if (state.expandedNodeIds.has(derivedNodeId)) {
    markQueryNodeStatus(state, derivedNodeId, "ready");
    return;
  }

  state.expandedNodeIds.add(derivedNodeId);
  try {
    const [webResponse, localResponse] = await Promise.all([
      runAggregate(state.request, query, DEFAULT_EXPANSION_WEB_LIMIT),
      readRuntime<SearchLocalResponse>(runtimeClient, state.storageRoot, "search.local", {
        query,
        limit: DEFAULT_EXPANSION_LOCAL_LIMIT,
        ...(state.request.context === undefined ? {} : { context: state.request.context })
      })
    ]);
    addWebResults(state, derivedNodeId, webResponse.blendedResults);
    addLocalResults(state, derivedNodeId, localResponse.results);
    await runSiteExpansion(siteExpansionEngine, state, derivedNodeId, query, webResponse.blendedResults);
    updateSnapshot(state, (snapshot) => ({
      ...snapshot,
      local: {
        ...snapshot.local,
        elapsedMs: snapshot.local.elapsedMs + localResponse.elapsedMs,
        stats: mergeLocalStats(snapshot.local.stats, localResponse.stats)
      }
    }));
    markQueryNodeStatus(state, derivedNodeId, "ready");
  } catch (error) {
    markQueryNodeStatus(state, derivedNodeId, "error");
    updateSnapshot(state, (snapshot) => ({
      ...snapshot,
      local: {
        ...snapshot.local,
        ...(snapshot.local.error === undefined
          ? {
              error: error instanceof Error ? error.message : String(error)
            }
          : {})
      }
    }));
  }
};

const runLimited = async (
  limit: number,
  tasks: readonly (() => Promise<void>)[]
): Promise<void> => {
  const queue = [...tasks];
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) {
        return;
      }
      await next();
    }
  });
  await Promise.all(runners);
};

const triggerAutoExpansion = (
  runtimeClient: LyraRuntimeClient,
  siteExpansionEngine: ReturnType<typeof createSiteExpansionEngine>,
  state: DeepStreamState
): void => {
  if (state.autoExpansionStarted || state.cancelled) {
    return;
  }
  if (state.rootWebDone === false || state.rootLocalDone === false) {
    return;
  }
  state.autoExpansionStarted = true;
  beginJob(state);
  updateSnapshot(state, (snapshot) => ({
    ...snapshot,
    stats: {
      ...snapshot.stats,
      expansionRounds: snapshot.stats.expansionRounds + 1
    }
  }));

  const remainingBudget = Math.max(0, state.budget.maxDerivedQueries - (state.snapshot.stats.derivedQueries ?? 0));
  const derivedQueries = buildDerivedQueries(
    state.request.query,
    pickExpansionSeeds(state, state.rootNodeId),
    remainingBudget,
    new Set(state.queryNodeIdByKey.keys())
  );
  if (derivedQueries.length === 0) {
    endJob(state);
    return;
  }

  void runLimited(
    state.budget.concurrency,
    derivedQueries.map((entry) => async () => {
      await searchDerivedQuery(runtimeClient, siteExpansionEngine, state, state.rootNodeId, entry.query, {
        seedQuery: entry.seedQuery,
        derivedToken: entry.derivedToken
      });
    })
  )
    .finally(() => {
      endJob(state);
    });
};

const startRootWebSearch = (
  runtimeClient: LyraRuntimeClient,
  siteExpansionEngine: ReturnType<typeof createSiteExpansionEngine>,
  state: DeepStreamState
): void => {
  void runtimeClient;
  beginJob(state);
  void runAggregate(state.request, state.request.query, DEFAULT_ROOT_WEB_LIMIT)
    .then((response) => {
      if (state.cancelled) {
        return;
      }
      updateSnapshot(state, (snapshot) => ({
        ...snapshot,
        web: {
          status: "ready",
          engineBuckets: response.engineBuckets,
          blendedCount: response.blendedResults.length,
          siteExpansion: {
            ...getSiteExpansionStats(snapshot),
            status: state.request.enableSiteExpansion === false ? "ready" : "loading"
          }
        }
      }));
      addWebResults(state, state.rootNodeId, response.blendedResults);
      if (state.request.enableSiteExpansion === false) {
        state.rootSiteDone = true;
      } else {
        beginJob(state);
        void runSiteExpansion(siteExpansionEngine, state, state.rootNodeId, state.request.query, response.blendedResults, true)
          .catch((error: unknown) => {
            if (state.cancelled) {
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            state.error = state.error ?? message;
            state.rootSiteDone = true;
            updateSnapshot(state, (snapshot) => ({
              ...snapshot,
              web: {
                ...snapshot.web,
                siteExpansion: {
                  ...getSiteExpansionStats(snapshot),
                  status: "error",
                  error: message
                }
              }
            }));
          })
          .finally(() => {
            endJob(state);
          });
      }
    })
    .catch((error: unknown) => {
      if (state.cancelled) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      state.error = state.error ?? message;
      state.rootSiteDone = true;
      updateSnapshot(state, (snapshot) => ({
        ...snapshot,
        web: {
          ...snapshot.web,
          status: "error",
          error: message,
          siteExpansion: {
            ...getSiteExpansionStats(snapshot),
            status: "error",
            error: message
          }
        }
      }));
    })
    .finally(() => {
      state.rootWebDone = true;
      triggerAutoExpansion(runtimeClient, siteExpansionEngine, state);
      endJob(state);
    });
};

const startRootLocalSearch = (
  runtimeClient: LyraRuntimeClient,
  siteExpansionEngine: ReturnType<typeof createSiteExpansionEngine>,
  state: DeepStreamState
): void => {
  beginJob(state);

  void readRuntime<SearchLocalStreamStartResponse>(
    runtimeClient,
    state.storageRoot,
    "search.local.stream.start",
    {
      query: state.request.query,
      limit: DEFAULT_ROOT_LOCAL_LIMIT,
      ...(state.request.context === undefined ? {} : { context: state.request.context })
    }
  )
    .then((started) => {
      if (state.cancelled) {
        return;
      }
      state.localStreamId = started.streamId;
      updateSnapshot(state, (snapshot) => ({
        ...snapshot,
        local: {
          ...snapshot.local,
          status: "loading",
          roots: started.roots
        }
      }));

      const poll = async (): Promise<void> => {
        if (state.cancelled || state.localStreamId === null) {
          return;
        }
        try {
          const snapshot = await readRuntime<SearchLocalStreamReadResponse>(
            runtimeClient,
            state.storageRoot,
            "search.local.stream.read",
            {
              streamId: state.localStreamId,
              limit: DEFAULT_ROOT_LOCAL_LIMIT
            }
          );
          if (state.cancelled) {
            return;
          }
          updateSnapshot(state, (current) => ({
            ...current,
            local: {
              ...current.local,
              status: snapshot.done
                ? (snapshot.error === undefined ? "ready" : "error")
                : "loading",
              scopePreset: snapshot.scopePreset,
              roots: snapshot.roots,
              elapsedMs: snapshot.elapsedMs,
              stats: cloneLocalStats(snapshot.stats),
              ...(snapshot.error === undefined ? {} : { error: snapshot.error })
            }
          }));
          addLocalResults(state, state.rootNodeId, snapshot.results);
          if (snapshot.done) {
            if (snapshot.error !== undefined) {
              state.error = state.error ?? snapshot.error;
            }
            state.rootLocalDone = true;
            triggerAutoExpansion(runtimeClient, siteExpansionEngine, state);
            endJob(state);
            return;
          }
        } catch (error) {
          if (state.cancelled) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          state.error = state.error ?? message;
          updateSnapshot(state, (snapshot) => ({
            ...snapshot,
            local: {
              ...snapshot.local,
              status: "error",
              error: message
            }
          }));
          state.rootLocalDone = true;
          triggerAutoExpansion(runtimeClient, siteExpansionEngine, state);
          endJob(state);
          return;
        }
        state.localPollTimer = setTimeout(() => {
          void poll();
        }, ROOT_LOCAL_POLL_MS);
      };

      void poll();
    })
    .catch((error) => {
      if (state.cancelled) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      state.error = state.error ?? message;
      updateSnapshot(state, (snapshot) => ({
        ...snapshot,
        local: {
          ...snapshot.local,
          status: "error",
          error: message
        }
      }));
      state.rootLocalDone = true;
      triggerAutoExpansion(runtimeClient, siteExpansionEngine, state);
      endJob(state);
    });
};

export type DeepSearchOrchestrator = {
  readonly start: (request: SearchDeepStreamStartRequest) => Promise<SearchDeepStreamStartResponse>;
  readonly read: (request: SearchDeepStreamReadRequest) => Promise<SearchDeepStreamReadResponse>;
  readonly cancel: (request: SearchDeepStreamCancelRequest) => Promise<SearchDeepStreamCancelResponse>;
  readonly expand: (request: SearchDeepExpandRequest) => Promise<SearchDeepExpandResponse>;
  readonly dispose: () => Promise<void>;
};

export const createDeepSearchOrchestrator = (options: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly storageRoot: string;
}): DeepSearchOrchestrator => {
  const streams = new Map<string, DeepStreamState>();
  const siteExpansionEngine = createSiteExpansionEngine({
    runtimeClient: options.runtimeClient,
    storageRoot: options.storageRoot
  });

  const removeState = async (state: DeepStreamState): Promise<void> => {
    state.cancelled = true;
    if (state.localPollTimer !== null) {
      clearTimeout(state.localPollTimer);
      state.localPollTimer = null;
    }
    if (state.localStreamId !== null) {
      try {
        await readRuntime<SearchDeepStreamCancelResponse>(
          options.runtimeClient,
          options.storageRoot,
          "search.local.stream.cancel",
          { streamId: state.localStreamId }
        );
      } catch (_error) {
        // Best-effort cancellation.
      }
      state.localStreamId = null;
    }
    if (state.siteStreamIds.size > 0) {
      await Promise.all([...state.siteStreamIds].map(async (streamId) => {
        try {
          await siteExpansionEngine.cancel(streamId);
        } catch (_error) {
          // Best-effort cancellation.
        }
      }));
      state.siteStreamIds.clear();
    }
    streams.delete(state.streamId);
  };

  return {
    start: async (request) => {
      const query = request.query.trim();
      const streamId = `deep-search-${randomUUID()}`;
      const rootNodeId = `root:${normalizeQueryKey(query)}`;
      const state: DeepStreamState = {
        streamId,
        storageRoot: options.storageRoot,
        request: {
          ...request,
          query
        },
        createdAtMs: Date.now(),
        rootNodeId,
        budget: resolveBudget(request.budgetPreset),
        snapshot: createEmptySnapshot(
          {
            ...request,
            query
          },
          rootNodeId
        ),
        queryNodeIdByKey: new Map([[normalizeQueryKey(query), rootNodeId]]),
        webKeys: new Set<string>(),
        localKeys: new Set<string>(),
        edgeKeys: new Set<string>(),
        expandedNodeIds: new Set<string>(),
        nodeIds: new Set<string>([rootNodeId]),
        localStreamId: null,
        localPollTimer: null,
        siteStreamIds: new Set<string>(),
        activeJobs: 0,
        rootWebDone: false,
        rootLocalDone: false,
        rootSiteDone: request.enableSiteExpansion === false,
        autoExpansionStarted: false,
        cancelled: false,
        done: false
      };
      streams.set(streamId, state);
      startRootWebSearch(options.runtimeClient, siteExpansionEngine, state);
      startRootLocalSearch(options.runtimeClient, siteExpansionEngine, state);
      return {
        streamId,
        snapshot: state.snapshot
      };
    },
    read: async (request) => {
      const state = streams.get(request.streamId);
      if (state === undefined) {
        return {
          streamId: request.streamId,
          snapshot: createEmptySnapshot(
            {
              query: "",
              budgetPreset: "medium",
              engines: []
            },
            "root:missing"
          ),
          done: true,
          error: "deep search stream not found"
        };
      }
      return {
        streamId: state.streamId,
        snapshot: state.snapshot,
        done: state.done,
        ...(state.error === undefined ? {} : { error: state.error })
      };
    },
    cancel: async (request) => {
      const state = streams.get(request.streamId);
      if (state === undefined) {
        return { removed: false };
      }
      await removeState(state);
      return { removed: true };
    },
    expand: async (request) => {
      const state = streams.get(request.streamId);
      if (state === undefined || state.cancelled) {
        return {
          streamId: request.streamId,
          accepted: false
        };
      }
      const node = state.snapshot.nodes.find((entry) => entry.id === request.nodeId);
      if (
        node === undefined
        || (node.kind !== "root_query" && node.kind !== "derived_query")
      ) {
        return {
          streamId: request.streamId,
          accepted: false
        };
      }
      if (state.expandedNodeIds.has(node.id)) {
        return {
          streamId: request.streamId,
          accepted: false
        };
      }
      const remainingBudget = Math.max(0, state.budget.maxDerivedQueries - state.snapshot.stats.derivedQueries);
      if (remainingBudget <= 0) {
        return {
          streamId: request.streamId,
          accepted: false
        };
      }

      const derivedQueries = buildDerivedQueries(
        node.title,
        pickExpansionSeeds(state, node.id),
        remainingBudget,
        new Set(state.queryNodeIdByKey.keys())
      );
      state.expandedNodeIds.add(node.id);
      if (derivedQueries.length === 0) {
        return {
          streamId: request.streamId,
          accepted: false
        };
      }

      state.done = false;
      updateSnapshot(state, (snapshot) => ({
        ...snapshot,
        phase: "streaming",
        stats: {
          ...snapshot.stats,
          expansionRounds: snapshot.stats.expansionRounds + 1
        }
      }));
      beginJob(state);
      void runLimited(
        state.budget.concurrency,
        derivedQueries.map((entry) => async () => {
          await searchDerivedQuery(options.runtimeClient, siteExpansionEngine, state, node.id, entry.query, {
            seedQuery: entry.seedQuery,
            derivedToken: entry.derivedToken
          });
        })
      )
        .finally(() => {
          endJob(state);
        });

      return {
        streamId: request.streamId,
        accepted: true
      };
    },
    dispose: async () => {
      await Promise.all([...streams.values()].map(async (state) => {
        await removeState(state);
      }));
    }
  };
};
