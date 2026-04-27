import { describe, expect, test } from "vitest";

import {
  applyCancelledDeepSearchState,
  buildBrowserSearchSettingsCacheKey,
  createLoadingDeepSearchState,
  createLoadingSearchPayload,
  markDeepSearchStateExpanding,
  resolveActiveBrowserSearchCacheKeys
} from "../runtime-model";
import type { BrowserSearchSettings } from "../runtime-types";

const searchSettings: BrowserSearchSettings = {
  searchEngines: [
    { id: "bing", label: "Bing", accentColor: "#008373" },
    {
      id: "searxng",
      label: "SearXNG",
      accentColor: "#4F8F5B",
      endpoint: "https://search.example.com"
    }
  ],
  resultsPerEngine: 5,
  localScopePreset: "workspace",
  localCustomRoots: ["/tmp/project"],
  localIncludeHidden: true,
  localEnableFuzzy: true,
  localEnableContent: true,
  localEnableExtensionMatch: true,
  deepBudgetPreset: "medium",
  deepSiteExpansionEnabled: true,
  deepProactiveDomainGuessingEnabled: false,
  deepCrawlPolicy: "accessibility_only"
};

describe("browser search runtime model", () => {
  test("builds a stable settings cache key from web, local, and deep settings", () => {
    const parsed = JSON.parse(buildBrowserSearchSettingsCacheKey(searchSettings)) as {
      readonly engines: readonly { readonly id: string; readonly endpoint: string | null }[];
      readonly localLimit: number;
      readonly localScopePreset: string;
      readonly deepBudgetPreset: string;
      readonly deepSiteExpansionEnabled: boolean;
    };

    expect(parsed.engines).toEqual([
      { id: "bing", endpoint: null },
      { id: "searxng", endpoint: "https://search.example.com" }
    ]);
    expect(parsed.localLimit).toBe(60);
    expect(parsed.localScopePreset).toBe("workspace");
    expect(parsed.deepBudgetPreset).toBe("medium");
    expect(parsed.deepSiteExpansionEnabled).toBe(true);
  });

  test("resolves active cache keys only for non-empty result tabs", () => {
    expect(
      resolveActiveBrowserSearchCacheKeys({
        activeTabId: "tab-1",
        activeTabPageKind: "search",
        currentResultMode: "standard",
        activeTabQuery: "lyra",
        settingsCacheKey: "settings"
      })
    ).toEqual({
      activeStandardCacheKey: null,
      activeDeepCacheKey: null
    });

    expect(
      resolveActiveBrowserSearchCacheKeys({
        activeTabId: "tab-1",
        activeTabPageKind: "results",
        currentResultMode: "standard",
        activeTabQuery: " lyra ",
        settingsCacheKey: "settings"
      }).activeStandardCacheKey
    ).toBe("tab-1:standard:lyra:settings");

    expect(
      resolveActiveBrowserSearchCacheKeys({
        activeTabId: "tab-1",
        activeTabPageKind: "results",
        currentResultMode: "deep",
        activeTabQuery: "lyra",
        settingsCacheKey: "settings"
      }).activeDeepCacheKey
    ).toBe("tab-1:deep:lyra:settings");
  });

  test("creates loading states with request id, scope, and budget metadata", () => {
    const standard = createLoadingSearchPayload({
      query: " lyra ",
      requestId: "request-1",
      scopePreset: "home"
    });
    const deep = createLoadingDeepSearchState({
      query: " lyra ",
      requestId: "request-2",
      scopePreset: "workspace",
      budgetPreset: "high"
    });

    expect(standard.query).toBe("lyra");
    expect(standard.queryRequestId).toBe("request-1");
    expect(standard.web.status).toBe("loading");
    expect(standard.local.status).toBe("loading");
    expect(standard.local.payload.scopePreset).toBe("home");

    expect(deep.query).toBe("lyra");
    expect(deep.queryRequestId).toBe("request-2");
    expect(deep.status).toBe("loading");
    expect(deep.budgetPreset).toBe("high");
    expect(deep.snapshot.local.scopePreset).toBe("workspace");
  });

  test("marks deep search state for expansion and cancellation", () => {
    const loading = createLoadingDeepSearchState({
      query: "lyra",
      requestId: "request-1",
      scopePreset: "home",
      budgetPreset: "medium"
    });

    const expanding = markDeepSearchStateExpanding({
      ...loading,
      status: "error",
      done: true,
      snapshot: {
        ...loading.snapshot,
        phase: "error"
      }
    });
    expect(expanding.status).toBe("loading");
    expect(expanding.done).toBe(false);
    expect(expanding.snapshot.phase).toBe("streaming");

    const cancelled = applyCancelledDeepSearchState(expanding);
    expect(cancelled.status).toBe("ready");
    expect(cancelled.done).toBe(true);
    expect(cancelled.snapshot.phase).toBe("completed");
  });
});
