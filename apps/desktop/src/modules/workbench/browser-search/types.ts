export type SearchEngineDefinition = {
  readonly id: string;
  readonly label: string;
  readonly accentColor: string;
};

export type AggregatedSearchResult = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly displayUrl: string;
  readonly snippet: string;
  readonly sourceEngineIds: readonly string[];
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
