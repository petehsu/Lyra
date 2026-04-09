import type {
  SearchDeepBudgetPreset,
  SearchDeepEdge,
  SearchDeepNode,
  SearchOfficialCategory,
  SearchDeepSnapshot
} from "../../../shared/desktop-bridge";

export type SearchEngineDefinition = {
  readonly id: string;
  readonly label: string;
  readonly accentColor: string;
  readonly endpoint?: string;
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
};

export type LocalSearchIndexStatus = {
  readonly state: "idle" | "building" | "ready" | "failed";
  readonly indexedFiles: number;
  readonly indexedDirs: number;
  readonly lastBuiltAt?: string;
  readonly progress?: number;
  readonly error?: string;
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
    readonly indexStatus?: LocalSearchIndexStatus;
    readonly error?: string;
  };
};

export type DeepSearchNodeKind = SearchDeepNode["kind"];
export type DeepSearchEdgeKind = SearchDeepEdge["kind"];
export type DeepSearchEdgeKindFilter = "all" | DeepSearchEdgeKind;
export type DeepSearchEdgeDirectionFilter = "both" | "incoming" | "outgoing";
export type DeepSearchViewportPolicy = "focus_ring" | "restore_if_enabled";

export type DeepSearchViewState = {
  readonly query: string;
  readonly queryRequestId: string;
  readonly streamId?: string;
  readonly budgetPreset: SearchDeepBudgetPreset;
  readonly status: SearchChannelStatus;
  readonly snapshot: SearchDeepSnapshot;
  readonly done: boolean;
  readonly error?: string;
};
