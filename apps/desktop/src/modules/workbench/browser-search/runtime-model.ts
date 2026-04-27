import type {
  WorkspaceSearchMode,
  WorkspaceTabPageKind
} from "../workspace-tabs/types";
import {
  createEmptyDeepSearchState,
  createEmptySearchPayload
} from "./service";
import type { BrowserSearchSettings } from "./runtime-types";
import type {
  BrowserSearchPayload,
  DeepSearchViewState,
  LocalSearchScopePreset
} from "./types";

export const DEFAULT_LOCAL_SEARCH_LIMIT = 60;

export const buildBrowserSearchSettingsCacheKey = (
  settings: BrowserSearchSettings
): string =>
  JSON.stringify({
    engines: settings.searchEngines.map((engine) => ({
      id: engine.id,
      endpoint: engine.endpoint ?? null
    })),
    limitPerEngine: settings.resultsPerEngine,
    localScopePreset: settings.localScopePreset,
    localCustomRoots: settings.localCustomRoots,
    localIncludeHidden: settings.localIncludeHidden,
    localEnableFuzzy: settings.localEnableFuzzy,
    localEnableContent: settings.localEnableContent,
    localEnableExtensionMatch: settings.localEnableExtensionMatch,
    localProjectRoot: settings.localProjectRoot ?? null,
    localLimit: settings.localLimit ?? DEFAULT_LOCAL_SEARCH_LIMIT,
    deepBudgetPreset: settings.deepBudgetPreset,
    deepSiteExpansionEnabled: settings.deepSiteExpansionEnabled,
    deepProactiveDomainGuessingEnabled: settings.deepProactiveDomainGuessingEnabled,
    deepCrawlPolicy: settings.deepCrawlPolicy
  });

export const createLoadingSearchPayload = (options: {
  readonly query: string;
  readonly requestId: string;
  readonly scopePreset: LocalSearchScopePreset;
}): BrowserSearchPayload => {
  const payload = createEmptySearchPayload({
    query: options.query,
    scopePreset: options.scopePreset
  });
  return {
    ...payload,
    queryRequestId: options.requestId,
    web: {
      status: "loading",
      payload: payload.web.payload
    },
    local: {
      status: "loading",
      payload: payload.local.payload
    }
  };
};

export const createLoadingDeepSearchState = (options: {
  readonly query: string;
  readonly requestId: string;
  readonly scopePreset: LocalSearchScopePreset;
  readonly budgetPreset: "low" | "medium" | "high";
}): DeepSearchViewState => ({
  ...createEmptyDeepSearchState({
    query: options.query,
    scopePreset: options.scopePreset,
    budgetPreset: options.budgetPreset
  }),
  queryRequestId: options.requestId,
  status: "loading"
});

export const buildStandardSearchCacheKey = (
  tabId: string,
  query: string,
  settingsCacheKey: string
): string => `${tabId}:standard:${query}:${settingsCacheKey}`;

export const buildDeepSearchCacheKey = (
  tabId: string,
  query: string,
  settingsCacheKey: string
): string => `${tabId}:deep:${query}:${settingsCacheKey}`;

export const resolveActiveBrowserSearchCacheKeys = (options: {
  readonly activeTabId: string;
  readonly activeTabPageKind: WorkspaceTabPageKind;
  readonly currentResultMode: WorkspaceSearchMode;
  readonly activeTabQuery: string;
  readonly settingsCacheKey: string;
}): {
  readonly activeStandardCacheKey: string | null;
  readonly activeDeepCacheKey: string | null;
} => {
  const query = options.activeTabQuery.trim();
  if (options.activeTabPageKind !== "results" || query.length === 0) {
    return {
      activeStandardCacheKey: null,
      activeDeepCacheKey: null
    };
  }

  return {
    activeStandardCacheKey:
      options.currentResultMode === "standard"
        ? buildStandardSearchCacheKey(
            options.activeTabId,
            query,
            options.settingsCacheKey
          )
        : null,
    activeDeepCacheKey:
      options.currentResultMode === "deep"
        ? buildDeepSearchCacheKey(
            options.activeTabId,
            query,
            options.settingsCacheKey
          )
        : null
  };
};

export const createRequestId = (): string =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const markDeepSearchStateExpanding = (
  state: DeepSearchViewState
): DeepSearchViewState => ({
  ...state,
  status: "loading",
  done: false,
  snapshot: {
    ...state.snapshot,
    phase: "streaming",
    lastUpdatedAt: new Date().toISOString()
  }
});

export const applyCancelledDeepSearchState = (
  state: DeepSearchViewState
): DeepSearchViewState => ({
  ...state,
  status: state.status === "error" ? "error" : "ready",
  done: true,
  snapshot: {
    ...state.snapshot,
    phase: state.snapshot.phase === "error" ? "error" : "completed",
    lastUpdatedAt: new Date().toISOString()
  }
});
