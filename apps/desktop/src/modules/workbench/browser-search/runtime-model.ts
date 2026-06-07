import type { WorkspaceTabPageKind } from "../workspace-tabs/types";
import { createEmptySearchPayload } from "./service";
import type { BrowserSearchSettings } from "./runtime-types";
import type {
  BrowserSearchPayload,
  LocalSearchScopePreset
} from "./types";

export const DEFAULT_LOCAL_SEARCH_LIMIT = 60;
export const DEFAULT_LOCAL_SCOPE_PRESET: LocalSearchScopePreset = "home";

export const buildBrowserSearchSettingsCacheKey = (
  settings: BrowserSearchSettings
): string =>
  JSON.stringify({
    engines: settings.searchEngines.map((engine) => ({
      id: engine.id,
      endpoint: engine.endpoint ?? null
    })),
    limitPerEngine: settings.resultsPerEngine,
    localProjectRoot: settings.localProjectRoot ?? null,
    localLimit: settings.localLimit ?? DEFAULT_LOCAL_SEARCH_LIMIT
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
    web: payload.web,
    local: {
      status: "loading",
      payload: payload.local.payload
    }
  };
};

export const buildStandardSearchCacheKey = (
  tabId: string,
  query: string,
  settingsCacheKey: string
): string => `${tabId}:standard:${query}:${settingsCacheKey}`;

export const resolveActiveBrowserSearchCacheKeys = (options: {
  readonly activeTabId: string;
  readonly activeTabPageKind: WorkspaceTabPageKind;
  readonly activeTabQuery: string;
  readonly settingsCacheKey: string;
}): {
  readonly activeStandardCacheKey: string | null;
} => {
  const query = options.activeTabQuery.trim();
  if (options.activeTabPageKind !== "results" || query.length === 0) {
    return {
      activeStandardCacheKey: null
    };
  }

  return {
    activeStandardCacheKey: buildStandardSearchCacheKey(
      options.activeTabId,
      query,
      options.settingsCacheKey
    )
  };
};

export const createRequestId = (): string =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;
