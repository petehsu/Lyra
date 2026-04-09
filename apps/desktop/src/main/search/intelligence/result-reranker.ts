import type { SearchAggregateResult } from "../../../shared/desktop-bridge";
import type { SearchQueryUnderstanding } from "./types";
import {
  calculateEntityMatch,
  isHomepageLike,
  isLikelyAggregatorHost,
  isOfficialResultForQuery,
  pathContains
} from "./official-site-resolver";
import { normalizeForComparison } from "./query-understanding";

export const scoreAggregateResultForQuery = (
  result: SearchAggregateResult,
  understanding: SearchQueryUnderstanding,
  rankIndex: number
): number => {
  const entityMatch = calculateEntityMatch(result, understanding);
  const officialResult = isOfficialResultForQuery(result, understanding);
  const navigationWeight = understanding.scores.navigational;
  const infoWeight = understanding.scores.informational;
  const transactionWeight = understanding.scores.transactional;

  let score = 120 - rankIndex * 8 + result.sourceEngineIds.length * 16;
  score += entityMatch * 48;
  if (officialResult) {
    score += 18;
  }

  if (navigationWeight >= 0.3) {
    if (isHomepageLike(result.url)) {
      score += 14 + navigationWeight * 12;
    }
    if (isOfficialResultForQuery(result, understanding)) {
      score += 10 + navigationWeight * 10;
    }
    if (entityMatch >= 0.65) {
      score += 18 + navigationWeight * 14;
    }
    if (isLikelyAggregatorHost(result.url) && entityMatch < 0.98) {
      score -= 18;
    }
  }

  if (understanding.docsHint || infoWeight >= 0.4) {
    if (pathContains(result.url, ["/docs", "/doc", "/api", "/developers", "/developer", "/sdk"])) {
      score += 34 + entityMatch * 16;
    } else if (isHomepageLike(result.url)) {
      score -= 10;
    }
  }

  if (understanding.loginHint) {
    if (pathContains(result.url, ["/login", "/signin", "/sign-in", "/account", "/dashboard"])) {
      score += 22 + entityMatch * 10;
    }
  }

  if (understanding.downloadHint || transactionWeight >= 0.45) {
    if (pathContains(result.url, ["/download", "/downloads", "/install", "/app", "/client"])) {
      score += 18 + entityMatch * 8;
    }
  }

  if (understanding.localHint && pathContains(result.url, ["/locations", "/stores", "/contact", "/map"])) {
    score += 16;
  }

  if (understanding.freshHint && normalizeForComparison(`${result.title} ${result.snippet}`).match(/\b(202[4-9]|today|最新|更新|发布)\b/)) {
    score += 12;
  }

  return score;
};

export const rerankAggregateResults = (
  results: readonly SearchAggregateResult[],
  understanding: SearchQueryUnderstanding
): readonly SearchAggregateResult[] =>
  [...results]
    .map((result, rankIndex) => ({
      result,
      rankIndex,
      score: scoreAggregateResultForQuery(result, understanding, rankIndex)
    }))
    .sort((left, right) => right.score - left.score || left.rankIndex - right.rankIndex)
    .map((entry) => entry.result);
