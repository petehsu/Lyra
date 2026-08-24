import type { WorkspaceTabPageKind } from "../workspace-tabs/types";
import { createEmptySearchPayload } from "./service";
import type { BrowserSearchSettings } from "./runtime-types";
import type {
  BrowserSearchPayload,
} from "./types";

export const buildBrowserSearchSettingsCacheKey = (
  settings: BrowserSearchSettings
): string =>
  JSON.stringify({
    mode: settings.mode,
    engines: settings.searchEngines.map((engine) => engine.id),
    limitPerEngine: settings.resultsPerEngine
  });

export const createLoadingSearchPayload = (options: {
  readonly query: string;
  readonly requestId: string;
}): BrowserSearchPayload => {
  const payload = createEmptySearchPayload({
    query: options.query
  });
  return {
    ...payload,
    queryRequestId: options.requestId,
    web: {
      ...payload.web,
      status: "loading"
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
