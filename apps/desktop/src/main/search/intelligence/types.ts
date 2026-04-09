import type { SearchAggregateResult, SearchOfficialCategory } from "../../../shared/desktop-bridge";

export type SearchIntentKind =
  | "navigational"
  | "informational"
  | "transactional"
  | "local"
  | "fresh";

export type SearchQueryUnderstanding = {
  readonly query: string;
  readonly normalizedQuery: string;
  readonly tokens: readonly string[];
  readonly entityCandidate: string;
  readonly primaryIntent: SearchIntentKind;
  readonly scores: Readonly<Record<SearchIntentKind, number>>;
  readonly officialHint: boolean;
  readonly docsHint: boolean;
  readonly loginHint: boolean;
  readonly downloadHint: boolean;
  readonly localHint: boolean;
  readonly freshHint: boolean;
  readonly isQuestionLike: boolean;
  readonly containsCjk: boolean;
};

export type SearchIntentAwareQueryVariant = {
  readonly query: string;
  readonly derivedToken: string;
  readonly seedQuery: string;
};

export type SearchSiteSeed = {
  readonly registrableDomain: string;
  readonly hostname: string;
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly sourceEngineIds: readonly string[];
  readonly isOfficialResult: boolean;
  readonly guessSource: "result" | "guessed";
};

export type SearchSiteExpansionTarget = {
  readonly registrableDomain: string;
  readonly candidateUrls: readonly string[];
  readonly hostnames: readonly string[];
  readonly score: number;
  readonly officialWeight: number;
  readonly guessSources: readonly string[];
  readonly guessedOnly: boolean;
};

export type SearchSiteSeedExtraction = {
  readonly understanding: SearchQueryUnderstanding;
  readonly seeds: readonly SearchSiteSeed[];
  readonly targets: readonly SearchSiteExpansionTarget[];
};

export type SearchIntelligenceEngine = {
  readonly understandQuery: (query: string) => SearchQueryUnderstanding;
  readonly isOfficialResult: (
    result: SearchAggregateResult,
    understanding: SearchQueryUnderstanding
  ) => boolean;
  readonly getOfficialResultCategory: (
    result: SearchAggregateResult,
    understanding: SearchQueryUnderstanding
  ) => SearchOfficialCategory | null;
  readonly scoreAggregateResult: (
    result: SearchAggregateResult,
    understanding: SearchQueryUnderstanding,
    rankIndex: number
  ) => number;
  readonly rerankAggregateResults: (
    results: readonly SearchAggregateResult[],
    understanding: SearchQueryUnderstanding
  ) => readonly SearchAggregateResult[];
  readonly buildDerivedQueryVariants: (
    query: string,
    existingKeys: ReadonlySet<string>,
    limit: number
  ) => readonly SearchIntentAwareQueryVariant[];
  readonly extractSiteSeeds: (
    query: string,
    results: readonly SearchAggregateResult[]
  ) => SearchSiteSeedExtraction;
  readonly scoreDomainCandidate: (
    candidate: SearchSiteExpansionTarget,
    understanding: SearchQueryUnderstanding
  ) => number;
  readonly chooseExpansionTargets: (
    extraction: SearchSiteSeedExtraction,
    limit: number
  ) => readonly SearchSiteExpansionTarget[];
};
