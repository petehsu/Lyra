import type {
  SearchIndexStatusResponse,
  SearchOfficialCategory
} from "../../../shared/desktop-bridge";

export type SearchEngineDefinition = {
  readonly id: string;
  readonly label: string;
  readonly accentColor: string;
  readonly endpoint?: string;
  readonly searchUrlTemplate?: string;
  readonly probeUrlTemplate?: string;
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

export type LocalSearchScopePreset = "home" | "full_system" | "workspace" | "custom";

export type LocalSearchResultSource =
  | "file"
  | "workspace"
  | "browser_history"
  | "agent_session"
  | "recent";

export type LocalSearchResultKind =
  | "file"
  | "directory"
  | "page"
  | "session"
  | "workspace";

export type LocalSearchMatchRange = {
  readonly field: string;
  readonly start: number;
  readonly end: number;
};

export type LocalSearchResultAction = {
  readonly id: string;
  readonly label: string;
};

export type LocalSearchResultItem = {
  readonly id: string;
  readonly path: string;
  readonly displayPath: string;
  readonly fileName: string;
  readonly extension?: string;
  readonly matchKind: "content" | "file_name" | "extension" | "path" | "fuzzy";
  readonly score: number;
  readonly snippet?: string;
  readonly line?: number;
  readonly modifiedAt?: number;
  readonly source: LocalSearchResultSource;
  readonly kind: LocalSearchResultKind;
  readonly title: string;
  readonly subtitle: string;
  readonly matchRanges: readonly LocalSearchMatchRange[];
  readonly actions: readonly LocalSearchResultAction[];
};

export type LocalSearchStats = {
  readonly scannedFiles: number;
  readonly scannedDirs: number;
  readonly contentScannedFiles: number;
  readonly matchedFiles: number;
  readonly skippedUnreadable: number;
  readonly skippedBinaryOrTooLarge: number;
  readonly usedIndex: boolean;
};

export type LocalSearchPayload = {
  readonly query: string;
  readonly scopePreset: LocalSearchScopePreset;
  readonly roots: readonly string[];
  readonly results: readonly LocalSearchResultItem[];
  readonly truncated: boolean;
  readonly elapsedMs: number;
  readonly stats: LocalSearchStats;
  readonly indexStatus?: SearchIndexStatusResponse;
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
  readonly local: {
    readonly status: SearchChannelStatus;
    readonly payload: LocalSearchPayload;
    readonly error?: string;
  };
};
