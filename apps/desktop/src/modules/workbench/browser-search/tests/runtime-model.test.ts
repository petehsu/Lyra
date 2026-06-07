import { describe, expect, test } from "vitest";

import {
  buildBrowserSearchSettingsCacheKey,
  createLoadingSearchPayload,
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
  localProjectRoot: "/tmp/project"
};

describe("browser search runtime model", () => {
  test("builds a stable settings cache key from web and context settings", () => {
    const parsed = JSON.parse(buildBrowserSearchSettingsCacheKey(searchSettings)) as {
      readonly engines: readonly { readonly id: string; readonly endpoint: string | null }[];
      readonly localLimit: number;
      readonly localProjectRoot: string | null;
    };

    expect(parsed.engines).toEqual([
      { id: "bing", endpoint: null },
      { id: "searxng", endpoint: "https://search.example.com" }
    ]);
    expect(parsed.localLimit).toBe(60);
    expect(parsed.localProjectRoot).toBe("/tmp/project");
  });

  test("resolves active cache keys only for non-empty result tabs", () => {
    expect(
      resolveActiveBrowserSearchCacheKeys({
        activeTabId: "tab-1",
        activeTabPageKind: "search",
        activeTabQuery: "lyra",
        settingsCacheKey: "settings"
      })
    ).toEqual({
      activeStandardCacheKey: null
    });

    expect(
      resolveActiveBrowserSearchCacheKeys({
        activeTabId: "tab-1",
        activeTabPageKind: "results",
        activeTabQuery: " lyra ",
        settingsCacheKey: "settings"
      }).activeStandardCacheKey
    ).toBe("tab-1:standard:lyra:settings");
  });

  test("creates loading states with request id and scope metadata", () => {
    const standard = createLoadingSearchPayload({
      query: " lyra ",
      requestId: "request-1",
      scopePreset: "home"
    });

    expect(standard.query).toBe("lyra");
    expect(standard.queryRequestId).toBe("request-1");
    expect(standard.web.status).toBe("idle");
    expect(standard.local.status).toBe("loading");
    expect(standard.local.payload.scopePreset).toBe("home");
  });
});
