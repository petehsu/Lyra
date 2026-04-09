import type {
  SearchAggregateEngineBucket,
  SearchAggregateRequest,
  SearchAggregateResponse,
  SearchAggregateResult
} from "../../shared/desktop-bridge";

import { fetchEngineResults } from "./providers";
import { toResultMergeKey } from "./parse";
import {
  searchIntelligenceEngine,
  type SearchQueryUnderstanding
} from "./query-understanding";

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

const blendResults = (
  engineBuckets: readonly SearchAggregateEngineBucket[],
  understanding: SearchQueryUnderstanding
): readonly SearchAggregateResult[] => {
  const byMergeKey = new Map<
    string,
    {
      result: SearchAggregateResult;
      bestRank: number;
      rankScore: number;
      queryAwareScore: number;
      isOfficialResult: boolean;
      officialCategory?: SearchAggregateResult["officialCategory"];
      sourceEngineIds: Set<string>;
    }
  >();

  engineBuckets.forEach((bucket) => {
    bucket.results.forEach((result, rankIndex) => {
      const mergeKey = toResultMergeKey(result.url);
      const current = byMergeKey.get(mergeKey);
      const queryAwareScore = searchIntelligenceEngine.scoreAggregateResult(result, understanding, rankIndex);
      const isOfficialResult = searchIntelligenceEngine.isOfficialResult(result, understanding);
      const officialCategory = searchIntelligenceEngine.getOfficialResultCategory(result, understanding);

      if (current === undefined) {
        byMergeKey.set(mergeKey, {
          result,
          bestRank: rankIndex,
          rankScore: rankIndex + 1,
          queryAwareScore,
          isOfficialResult,
          officialCategory: officialCategory ?? undefined,
          sourceEngineIds: new Set(result.sourceEngineIds)
        });
        return;
      }

      result.sourceEngineIds.forEach((engineId) => {
        current.sourceEngineIds.add(engineId);
      });

      const isBetterRank = rankIndex < current.bestRank;
      current.rankScore += rankIndex + 1;
      current.queryAwareScore = Math.max(current.queryAwareScore, queryAwareScore) + queryAwareScore * 0.25;
      current.isOfficialResult = current.isOfficialResult || isOfficialResult;
      current.officialCategory = current.officialCategory ?? officialCategory ?? undefined;

      if (isBetterRank) {
        current.bestRank = rankIndex;
        current.result = result;
      }
    });
  });

  return [...byMergeKey.values()]
    .map((entry) => ({
      ...entry.result,
      sourceEngineIds: [...entry.sourceEngineIds],
      ...(entry.isOfficialResult ? { isOfficialResult: true } : {}),
      ...(entry.officialCategory === undefined ? {} : { officialCategory: entry.officialCategory })
    }))
    .sort((left, right) => {
      const leftQueryScore = byMergeKey.get(toResultMergeKey(left.url))?.queryAwareScore ?? Number.MIN_SAFE_INTEGER;
      const rightQueryScore = byMergeKey.get(toResultMergeKey(right.url))?.queryAwareScore ?? Number.MIN_SAFE_INTEGER;
      if (leftQueryScore !== rightQueryScore) {
        return rightQueryScore - leftQueryScore;
      }
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
  const understanding = searchIntelligenceEngine.understandQuery(sanitized.query);

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
      const rerankedResults = searchIntelligenceEngine
        .rerankAggregateResults(fetched.results, understanding)
        .map((result) => {
          const officialCategory = searchIntelligenceEngine.getOfficialResultCategory(result, understanding);
          return {
            ...result,
            ...(searchIntelligenceEngine.isOfficialResult(result, understanding)
              ? { isOfficialResult: true }
              : {}),
            ...(officialCategory === null ? {} : { officialCategory })
          };
        });

      return {
        engine,
        results: rerankedResults,
        latencyMs: fetched.latencyMs,
        ...(fetched.error !== undefined ? { error: fetched.error } : {})
      };
    })
  );

  return {
    query: sanitized.query,
    blendedResults: blendResults(bucketEntries, understanding),
    engineBuckets: bucketEntries,
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt
  };
};
