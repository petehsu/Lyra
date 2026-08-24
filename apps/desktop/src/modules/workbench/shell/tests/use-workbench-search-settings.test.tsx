import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { WorkbenchPreferences } from "../../preferences";
import { useWorkbenchSearchSettings } from "../use-workbench-search-settings";

const preferences: WorkbenchPreferences = {
  locale: "zh-CN",
  theme: "lyra-light",
  windowMaterialEnabled: true,
  uiPackId: "classic",
  splitTriggerMode: "ctrl_left_drag",
  splitThreePaneLayout: "adaptive",
  splitOverflowPolicy: "block_with_notice",
  aiRichRenderingEnabled: true,
  aiStopBehavior: "turn_only",
  preventSleepEnabled: true,
  editorGpuAcceleration: "off",
  searchEngineMode: "fixed",
  searchWebEngineIds: ["bing"],
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
      "bing",
      "google"
    ]);
    expect(result.current.activeSearchEngines.map((engine) => engine.id)).toEqual(["bing"]);
    expect(result.current.browserSearchSettings.mode).toBe("fixed");
    expect(result.current.browserSearchSettings.searchEngines.map((engine) => engine.id)).toEqual(["bing"]);
    expect(result.current.allSearchEngines.map((engine) => engine.id)).toEqual(["bing", "google"]);
    expect(result.current.engineById.get("bing")?.searchUrlTemplate).toContain("ensearch=1");
  });

  test("uses both built-in engines in dynamic mode", () => {
    const { result } = renderHook(() => useWorkbenchSearchSettings({
      ...preferences,
      searchEngineMode: "dynamic"
    }));

    expect(result.current.activeSearchEngines.map((engine) => engine.id)).toEqual([
      "bing",
      "google"
    ]);
    expect(result.current.browserSearchSettings.mode).toBe("dynamic");
  });
});
