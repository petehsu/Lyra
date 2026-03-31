import type {
  LyraDesktopApi,
  SearchAggregateRequest,
  SearchAggregateResponse
} from "../../../shared/desktop-bridge";

import type { AggregatedSearchPayload, SearchEngineDefinition } from "./types";

const toEmptyPayload = (query: string): AggregatedSearchPayload => ({
  query,
  blendedResults: [],
  engineBuckets: [],
  fetchedAt: new Date().toISOString(),
  elapsedMs: 0
});

const normalizeResponse = (response: SearchAggregateResponse): AggregatedSearchPayload => ({
  query: response.query,
  blendedResults: response.blendedResults,
  engineBuckets: response.engineBuckets,
  fetchedAt: response.fetchedAt,
  elapsedMs: response.elapsedMs
});

export const fetchAggregatedSearchPayload = async (options: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly query: string;
  readonly searchEngines: readonly SearchEngineDefinition[];
  readonly resultsPerEngine: number;
}): Promise<AggregatedSearchPayload> => {
  const query = options.query.trim();
  if (query.length === 0 || options.searchEngines.length === 0 || options.desktopApi === null) {
    return toEmptyPayload(query);
  }

  const request: SearchAggregateRequest = {
    query,
    limitPerEngine: options.resultsPerEngine,
    engines: options.searchEngines
  };

  const response = await options.desktopApi.search.aggregate(request);
  return normalizeResponse(response);
};

export const createEmptySearchPayload = toEmptyPayload;
