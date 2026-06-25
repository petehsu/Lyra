import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { WorkbenchPreferences } from "../../preferences";
import { useWorkbenchSearchSettings } from "../use-workbench-search-settings";

const preferences: WorkbenchPreferences = {
  locale: "zh-CN",
  theme: "lyra-light",
  uiPackId: "classic",
  splitTriggerMode: "ctrl_left_drag",
  splitThreePaneLayout: "adaptive",
  splitOverflowPolicy: "block_with_notice",
  aiRichRenderingEnabled: true,
  aiStopBehavior: "turn_only",
  preventSleepEnabled: true,
  searchWebEngineIds: ["bing"],
  searchSearxngEndpoint: "https://search.example.com/search?q={searchTerms}",
  searchResultsSourceFilter: "all",
  omniboxNonBrowserSubmitTarget: "new_tab",
  systemNotificationMode: "background",
  systemNotificationClickBehavior: "open_center",
  systemNotificationActionsEnabled: true
};

describe("useWorkbenchSearchSettings", () => {
  test("keeps address-bar search engine controls on the built-in integrated engines", () => {
    const { result } = renderHook(() => useWorkbenchSearchSettings(preferences));

    expect(result.current.integratedSearchEngines.map((engine) => engine.id)).toEqual([
      "google",
      "bing",
      "duckduckgo",
      "brave",
      "startpage",
      "qwant",
      "mojeek",
      "yahoo",
      "naver"
    ]);
    expect(result.current.registeredSearchEngines.map((engine) => engine.id)).toEqual(["bing"]);
    expect(result.current.activeSearchEngines.map((engine) => engine.id)).toEqual(["bing"]);
    expect(result.current.browserSearchSettings.searchEngines.map((engine) => engine.id)).toEqual(
      result.current.integratedSearchEngines.map((engine) => engine.id)
    );
    expect(result.current.allSearchEngines.some((engine) => engine.id === "searxng")).toBe(true);
  });
});
