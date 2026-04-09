import type { SearchAggregateResult } from "../../../shared/desktop-bridge";
import { getOfficialResultCategoryForQuery, isOfficialResultForQuery } from "./official-site-resolver";
import { analyzeSearchQuery, buildIntentAwareQueryVariants } from "./query-understanding";
import { rerankAggregateResults, scoreAggregateResultForQuery } from "./result-reranker";
import { chooseExpansionTargets, extractSiteSeeds, scoreDomainCandidate } from "./site-expansion";
import type {
  SearchIntelligenceEngine,
  SearchIntentAwareQueryVariant,
  SearchIntentKind,
  SearchQueryUnderstanding,
  SearchSiteExpansionTarget,
  SearchSiteSeed,
  SearchSiteSeedExtraction
} from "./types";

export const createSearchIntelligenceEngine = (): SearchIntelligenceEngine => ({
  understandQuery: analyzeSearchQuery,
  isOfficialResult: isOfficialResultForQuery,
  getOfficialResultCategory: getOfficialResultCategoryForQuery,
  scoreAggregateResult: scoreAggregateResultForQuery,
  rerankAggregateResults,
  buildDerivedQueryVariants: buildIntentAwareQueryVariants,
  extractSiteSeeds,
  scoreDomainCandidate,
  chooseExpansionTargets
});

export const searchIntelligenceEngine = createSearchIntelligenceEngine();

export {
  analyzeSearchQuery,
  buildIntentAwareQueryVariants,
  getOfficialResultCategoryForQuery,
  rerankAggregateResults,
  scoreAggregateResultForQuery,
  extractSiteSeeds,
  scoreDomainCandidate,
  chooseExpansionTargets
};

export type {
  SearchAggregateResult,
  SearchIntelligenceEngine,
  SearchIntentAwareQueryVariant,
  SearchIntentKind,
  SearchQueryUnderstanding,
  SearchSiteExpansionTarget,
  SearchSiteSeed,
  SearchSiteSeedExtraction
};
