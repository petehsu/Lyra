import { describe, expect, test } from "vitest";

import {
  buildBrowserSearchSettingsCacheKey,
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
  resultsPerEngine: 5
};

describe("browser search runtime model", () => {
  test("builds a stable settings cache key from web settings", () => {
    const parsed = JSON.parse(buildBrowserSearchSettingsCacheKey(searchSettings)) as {
      readonly engines: readonly { readonly id: string; readonly endpoint: string | null }[];
      readonly limitPerEngine: number;
    };

    expect(parsed.engines).toEqual([
      { id: "bing", endpoint: null },
      { id: "searxng", endpoint: "https://search.example.com" }
    ]);
    expect(parsed.limitPerEngine).toBe(5);
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
});