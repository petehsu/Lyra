import type {
  SearchDeepExpandRequest,
  SearchDeepExpandResponse,
  SearchDeepSnapshot,
  SearchDeepStreamReadResponse,
  SearchDeepStreamStartRequest,
  SearchDeepStreamStartResponse,
  LyraDesktopApi,
  SearchAggregateRequest,
  SearchAggregateResponse,
  SearchLocalRequest,
  SearchLocalResponse,
  SearchLocalStreamReadResponse,
  SearchLocalStreamStartResponse
} from "../../../shared/desktop-bridge";

import type {
  AggregatedSearchPayload,
  BrowserSearchPayload,
  DeepSearchViewState,
  LocalSearchPayload,
  LocalSearchScopePreset,
  SearchEngineDefinition
} from "./types";

const toEmptyAggregatedPayload = (query: string): AggregatedSearchPayload => ({
  query,
  blendedResults: [],
  engineBuckets: [],
  fetchedAt: new Date().toISOString(),
  elapsedMs: 0
});

const DEFAULT_LOCAL_SCOPE_PRESET: LocalSearchScopePreset = "home";

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

export const createEmptyDeepSearchSnapshot = (options: {
  readonly query: string;
  readonly scopePreset: LocalSearchScopePreset;
  readonly budgetPreset: "low" | "medium" | "high";
}): SearchDeepSnapshot => ({
  query: options.query.trim(),
  budgetPreset: options.budgetPreset,
  phase: "bootstrapping",
  nodes: [],
  edges: [],
  web: {
    status: "idle",
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
    status: "idle",
    scopePreset: options.scopePreset,
    roots: [],
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
  },
  stats: {
    dedupedResults: 0,
    derivedQueries: 0,
    expansionRounds: 0
  },
  lastUpdatedAt: new Date().toISOString()
});

const normalizeAggregateResponse = (
  response: SearchAggregateResponse
): AggregatedSearchPayload => ({
  query: response.query,
  blendedResults: response.blendedResults,
  engineBuckets: response.engineBuckets,
  fetchedAt: response.fetchedAt,
  elapsedMs: response.elapsedMs
});

const normalizeLocalResponse = (response: SearchLocalResponse): LocalSearchPayload => ({
  query: response.query,
  scopePreset: response.scopePreset,
  roots: response.roots,
  results: response.results,
  truncated: response.truncated,
  elapsedMs: response.elapsedMs,
  stats: response.stats
});

export const fetchAggregatedSearchPayload = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly query: string;
  readonly searchEngines: readonly SearchEngineDefinition[];
  readonly resultsPerEngine: number;
}): Promise<AggregatedSearchPayload> => {
  const query = options.query.trim();
  if (query.length === 0 || options.searchEngines.length === 0 || options.desktopApi === null) {
    return toEmptyAggregatedPayload(query);
  }

  const request: SearchAggregateRequest = {
    query,
    limitPerEngine: options.resultsPerEngine,
    engines: options.searchEngines
  };
  const response = await options.desktopApi.search.aggregate(request);
  return normalizeAggregateResponse(response);
};

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
    stats: response.stats
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

export const createEmptyDeepSearchState = (options: {
  readonly query: string;
  readonly scopePreset: LocalSearchScopePreset;
  readonly budgetPreset: "low" | "medium" | "high";
}): DeepSearchViewState => {
  const query = options.query.trim();
  return {
    query,
    queryRequestId: "init",
    budgetPreset: options.budgetPreset,
    status: "idle",
    snapshot: createEmptyDeepSearchSnapshot(options),
    done: false
  };
};

export const startDeepSearchStream = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly request: SearchDeepStreamStartRequest;
}): Promise<SearchDeepStreamStartResponse | null> => {
  const query = options.request.query.trim();
  if (query.length === 0 || options.desktopApi === null) {
    return null;
  }
  return await options.desktopApi.search.startDeepStream({
    ...options.request,
    query
  });
};

export const readDeepSearchStream = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly streamId: string;
}): Promise<SearchDeepStreamReadResponse | null> => {
  if (options.desktopApi === null) {
    return null;
  }
  return await options.desktopApi.search.readDeepStream({
    streamId: options.streamId
  });
};

export const cancelDeepSearchStream = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly streamId: string;
}): Promise<void> => {
  if (options.desktopApi === null) {
    return;
  }
  await options.desktopApi.search.cancelDeepStream({
    streamId: options.streamId
  });
};

export const expandDeepSearchNode = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly request: SearchDeepExpandRequest;
}): Promise<SearchDeepExpandResponse | null> => {
  if (options.desktopApi === null) {
    return null;
  }
  return await options.desktopApi.search.expandDeepNode(options.request);
};
