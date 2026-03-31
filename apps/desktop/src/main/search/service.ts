import type {
  SearchAggregateEngineBucket,
  SearchAggregateRequest,
  SearchAggregateResponse,
  SearchAggregateResult
} from "../../shared/desktop-bridge";

import { fetchEngineResults } from "./providers";
import { toResultMergeKey } from "./parse";

const MAX_ENGINES = 8;
const MAX_RESULTS_PER_ENGINE = 10;
const MIN_RESULTS_PER_ENGINE = 1;

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const sanitizeRequest = (request: SearchAggregateRequest): SearchAggregateRequest => {
  const query = request.query.trim();
  const limitPerEngine = clamp(
    Number.isFinite(request.limitPerEngine) ? request.limitPerEngine : 5,
    MIN_RESULTS_PER_ENGINE,
    MAX_RESULTS_PER_ENGINE
  );

  return {
    query,
    limitPerEngine,
    engines: request.engines.slice(0, MAX_ENGINES)
  };
};

const blendResults = (engineBuckets: readonly SearchAggregateEngineBucket[]): readonly SearchAggregateResult[] => {
  const byMergeKey = new Map<
    string,
    {
      result: SearchAggregateResult;
      bestRank: number;
      rankScore: number;
      sourceEngineIds: Set<string>;
    }
  >();

  engineBuckets.forEach((bucket) => {
    bucket.results.forEach((result, rankIndex) => {
      const mergeKey = toResultMergeKey(result.url);
      const current = byMergeKey.get(mergeKey);

      if (current === undefined) {
        byMergeKey.set(mergeKey, {
          result,
          bestRank: rankIndex,
          rankScore: rankIndex + 1,
          sourceEngineIds: new Set(result.sourceEngineIds)
        });
        return;
      }

      result.sourceEngineIds.forEach((engineId) => {
        current.sourceEngineIds.add(engineId);
      });

      const isBetterRank = rankIndex < current.bestRank;
      current.rankScore += rankIndex + 1;

      if (isBetterRank) {
        current.bestRank = rankIndex;
        current.result = result;
      }
    });
  });

  return [...byMergeKey.values()]
    .map((entry) => ({
      ...entry.result,
      sourceEngineIds: [...entry.sourceEngineIds]
    }))
    .sort((left, right) => {
      const sourceDiff = right.sourceEngineIds.length - left.sourceEngineIds.length;
      if (sourceDiff !== 0) {
        return sourceDiff;
      }
      const leftScore = byMergeKey.get(toResultMergeKey(left.url))?.rankScore ?? Number.MAX_SAFE_INTEGER;
      const rightScore = byMergeKey.get(toResultMergeKey(right.url))?.rankScore ?? Number.MAX_SAFE_INTEGER;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return left.title.localeCompare(right.title, "zh-CN");
    });
};

export const aggregateSearch = async (request: SearchAggregateRequest): Promise<SearchAggregateResponse> => {
  const startedAt = Date.now();
  const sanitized = sanitizeRequest(request);

  if (sanitized.query.length === 0 || sanitized.engines.length === 0) {
    return {
      query: sanitized.query,
      blendedResults: [],
      engineBuckets: [],
      fetchedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt
    };
  }

  const bucketEntries = await Promise.all(
    sanitized.engines.map(async (engine): Promise<SearchAggregateEngineBucket> => {
      const fetched = await fetchEngineResults(engine, sanitized.query, sanitized.limitPerEngine);

      return {
        engine,
        results: fetched.results,
        latencyMs: fetched.latencyMs,
        ...(fetched.error !== undefined ? { error: fetched.error } : {})
      };
    })
  );

  return {
    query: sanitized.query,
    blendedResults: blendResults(bucketEntries),
    engineBuckets: bucketEntries,
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt
  };
};
