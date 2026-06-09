import type {
  LyraDesktopApi,
  SearchIndexStatusResponse,
  SearchLocalRequest,
  SearchLocalResponse,
  SearchLocalStreamReadResponse,
  SearchLocalStreamStartResponse
} from "../../../shared/desktop-bridge";

import type {
  AggregatedSearchPayload,
  BrowserSearchPayload,
  LocalSearchPayload,
  LocalSearchScopePreset,
  SearchEngineDefinition,
  WebSearchEngineDefinition
} from "./types";

const toEmptyAggregatedPayload = (query: string): AggregatedSearchPayload => ({
  query,
  blendedResults: [],
  engineBuckets: [],
  fetchedAt: new Date().toISOString(),
  elapsedMs: 0
});

const DEFAULT_LOCAL_SCOPE_PRESET: LocalSearchScopePreset = "home";
const DEFAULT_WEB_SEARCH_RESOLVE_TIMEOUT_MS = 1800;

export const isSearchIndexReady = (
  status: SearchIndexStatusResponse | null | undefined
): boolean =>
  status !== null &&
  status !== undefined &&
  status.state === "ready" &&
  status.indexedFiles > 0 &&
  status.roots.some((root) => root.state === "ready" && root.indexedFiles > 0);

const toEmptyLocalPayload = (
  query: string,
  scopePreset: LocalSearchScopePreset
): LocalSearchPayload => ({
  query,
  scopePreset,
  roots: [],
  results: [],
  truncated: false,
  elapsedMs: 0,
  stats: {
    scannedFiles: 0,
    scannedDirs: 0,
    contentScannedFiles: 0,
    matchedFiles: 0,
    skippedUnreadable: 0,
    skippedBinaryOrTooLarge: 0,
    usedIndex: false
  }
});

export const resolveSearchUrl = (
  engine: WebSearchEngineDefinition,
  query: string,
  template = engine.searchUrlTemplate
): string => {
  const encoded = encodeURIComponent(query);
  if (template.includes("{searchTerms}")) {
    return template.replaceAll("{searchTerms}", encoded);
  }
  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}q=${encoded}`;
};

const isWebSearchEngine = (
  engine: SearchEngineDefinition
): engine is WebSearchEngineDefinition =>
  typeof engine.searchUrlTemplate === "string" && engine.searchUrlTemplate.trim().length > 0;

export const resolveWebSearchTarget = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly query: string;
  readonly searchEngines: readonly SearchEngineDefinition[];
  readonly timeoutMs?: number;
}): Promise<{
  readonly engine: WebSearchEngineDefinition;
  readonly searchUrl: string;
  readonly fallbackUsed: boolean;
  readonly latencyMs?: number;
} | null> => {
  const query = options.query.trim();
  const engines = options.searchEngines.filter(isWebSearchEngine);
  if (query.length === 0 || engines.length === 0) {
    return null;
  }

  if (options.desktopApi === null) {
    const engine = engines[0]!;
    return {
      engine,
      searchUrl: resolveSearchUrl(engine, query),
      fallbackUsed: true
    };
  }

  const response = await options.desktopApi.search.resolveWebSearchEngine({
    query,
    engines,
    timeoutMs: options.timeoutMs ?? DEFAULT_WEB_SEARCH_RESOLVE_TIMEOUT_MS
  });
  return {
    engine: response.engine,
    searchUrl: response.searchUrl,
    fallbackUsed: response.fallbackUsed,
    ...(response.latencyMs === undefined ? {} : { latencyMs: response.latencyMs })
  };
};

export const resolveManualWebSearchTargets = (options: {
  readonly query: string;
  readonly engineIds: readonly string[];
  readonly searchEngines: readonly SearchEngineDefinition[];
}): readonly {
  readonly engine: WebSearchEngineDefinition;
  readonly searchUrl: string;
}[] => {
  const query = options.query.trim();
  if (query.length === 0) {
    return [];
  }
  const engineById = new Map(
    options.searchEngines.filter(isWebSearchEngine).map((engine) => [engine.id, engine])
  );
  return options.engineIds
    .slice(0, 4)
    .map((engineId) => engineById.get(engineId))
    .filter((engine): engine is WebSearchEngineDefinition => engine !== undefined)
    .map((engine) => ({
      engine,
      searchUrl: resolveSearchUrl(engine, query)
    }));
};

export const resolveNextSearchEngineSelection = (options: {
  readonly currentMode: "auto" | "manual";
  readonly currentEngineIds: readonly string[];
  readonly clickedEngineId: string | "auto";
}): {
  readonly mode: "auto" | "manual";
  readonly engineIds: readonly string[];
} => {
  if (options.clickedEngineId === "auto") {
    return {
      mode: "auto",
      engineIds: []
    };
  }

  const current =
    options.currentMode === "manual"
      ? [...options.currentEngineIds]
      : [];
  const existingIndex = current.indexOf(options.clickedEngineId);
  if (existingIndex >= 0) {
    current.splice(existingIndex, 1);
    return current.length === 0
      ? { mode: "auto", engineIds: [] }
      : { mode: "manual", engineIds: current };
  }

  if (current.length >= 4) {
    current[current.length - 1] = options.clickedEngineId;
  } else {
    current.push(options.clickedEngineId);
  }

  return {
    mode: "manual",
    engineIds: current
  };
};

const normalizeLocalResponse = (response: SearchLocalResponse): LocalSearchPayload => ({
  query: response.query,
  scopePreset: response.scopePreset,
  roots: response.roots,
  results: response.results,
  truncated: response.truncated,
  elapsedMs: response.elapsedMs,
  stats: response.stats,
  indexStatus: response.indexStatus
});

export const fetchLocalSearchPayload = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly request: SearchLocalRequest;
}): Promise<LocalSearchPayload> => {
  const query = options.request.query.trim();
  if (query.length === 0 || options.desktopApi === null) {
    return toEmptyLocalPayload(query, DEFAULT_LOCAL_SCOPE_PRESET);
  }
  const response = await options.desktopApi.search.local({
    ...options.request,
    query
  });
  return normalizeLocalResponse(response);
};

export type LocalSearchStreamStartPayload = {
  readonly streamId: string;
  readonly query: string;
  readonly scopePreset: LocalSearchScopePreset;
  readonly roots: readonly string[];
};

export type LocalSearchStreamReadPayload = {
  readonly streamId: string;
  readonly payload: LocalSearchPayload;
  readonly done: boolean;
  readonly error?: string;
};

const normalizeStreamStartResponse = (
  response: SearchLocalStreamStartResponse
): LocalSearchStreamStartPayload => ({
  streamId: response.streamId,
  query: response.query,
  scopePreset: response.scopePreset,
  roots: response.roots
});

const normalizeStreamReadResponse = (
  response: SearchLocalStreamReadResponse
): LocalSearchStreamReadPayload => ({
  streamId: response.streamId,
  payload: normalizeLocalResponse({
    query: response.query,
    scopePreset: response.scopePreset,
    roots: response.roots,
    results: response.results,
    truncated: response.truncated,
    elapsedMs: response.elapsedMs,
    stats: response.stats,
    indexStatus: response.indexStatus
  }),
  done: response.done,
  ...(typeof response.error === "string" ? { error: response.error } : {})
});

export const startLocalSearchStream = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly request: SearchLocalRequest;
}): Promise<LocalSearchStreamStartPayload | null> => {
  const query = options.request.query.trim();
  if (query.length === 0 || options.desktopApi === null) {
    return null;
  }
  const response = await options.desktopApi.search.startLocalStream({
    ...options.request,
    query
  });
  return normalizeStreamStartResponse(response);
};

export const readLocalSearchStream = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly streamId: string;
  readonly limit?: number;
}): Promise<LocalSearchStreamReadPayload | null> => {
  if (options.desktopApi === null) {
    return null;
  }
  const response = await options.desktopApi.search.readLocalStream({
    streamId: options.streamId,
    ...(options.limit === undefined ? {} : { limit: options.limit })
  });
  return normalizeStreamReadResponse(response);
};

export const cancelLocalSearchStream = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly streamId: string;
}): Promise<void> => {
  if (options.desktopApi === null) {
    return;
  }
  await options.desktopApi.search.cancelLocalStream({
    streamId: options.streamId
  });
};

export const createEmptySearchPayload = (options: {
  readonly query: string;
  readonly scopePreset: LocalSearchScopePreset;
}): BrowserSearchPayload => {
  const query = options.query.trim();
  return {
    query,
    queryRequestId: "init",
    lastUpdatedAt: new Date().toISOString(),
    web: {
      status: "idle",
      payload: toEmptyAggregatedPayload(query)
    },
    local: {
      status: "idle",
      payload: toEmptyLocalPayload(query, options.scopePreset)
    }
  };
};
