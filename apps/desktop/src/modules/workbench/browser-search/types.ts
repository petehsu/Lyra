import type {
  SearchOfficialCategory
} from "../../../shared/desktop-bridge";

export type SearchEngineDefinition = {
  readonly id: string;
  readonly label: string;
  readonly accentColor: string;
  readonly searchUrlTemplate?: string;
  readonly enabledByDefault?: boolean;
};

export type WebSearchEngineDefinition = SearchEngineDefinition & {
  readonly searchUrlTemplate: string;
};

export type AggregatedSearchResult = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly displayUrl: string;
  readonly snippet: string;
  readonly sourceEngineIds: readonly string[];
  readonly isOfficialResult?: boolean;
  readonly officialCategory?: SearchOfficialCategory;
};

export type AggregatedSearchEngineBucket = {
  readonly engine: SearchEngineDefinition;
  readonly results: readonly AggregatedSearchResult[];
  readonly error?: string;
  readonly latencyMs?: number;
};

export type AggregatedSearchPayload = {
  readonly query: string;
  readonly blendedResults: readonly AggregatedSearchResult[];
  readonly engineBuckets: readonly AggregatedSearchEngineBucket[];
  readonly fetchedAt?: string;
  readonly elapsedMs?: number;
};

export type SearchChannelStatus = "idle" | "loading" | "ready" | "error";

export type BrowserSearchPayload = {
  readonly query: string;
  readonly queryRequestId: string;
  readonly lastUpdatedAt?: string;
  readonly web: {
    readonly status: SearchChannelStatus;
    readonly payload: AggregatedSearchPayload;
    readonly error?: string;
  };
};
