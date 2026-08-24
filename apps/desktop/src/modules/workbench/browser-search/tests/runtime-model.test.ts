import { describe, expect, test } from "vitest";

import {
  buildBrowserSearchSettingsCacheKey,
  resolveActiveBrowserSearchCacheKeys
} from "../runtime-model";
import type { BrowserSearchSettings } from "../runtime-types";

const searchSettings: BrowserSearchSettings = {
  mode: "dynamic",
  searchEngines: [
    { id: "bing", label: "Bing", accentColor: "#008373" },
    {
      id: "google",
      label: "Google",
      accentColor: "#4285F4"
    }
  ],
  resultsPerEngine: 5
};

describe("browser search runtime model", () => {
  test("builds a stable settings cache key from web settings", () => {
    const parsed = JSON.parse(buildBrowserSearchSettingsCacheKey(searchSettings)) as {
      readonly mode: string;
      readonly engines: readonly string[];
      readonly limitPerEngine: number;
    };

    expect(parsed.mode).toBe("dynamic");
    expect(parsed.engines).toEqual(["bing", "google"]);
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
