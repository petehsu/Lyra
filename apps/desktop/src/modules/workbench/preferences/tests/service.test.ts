import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import {
  readWorkbenchPreferences,
  useWorkbenchPreferencesModel,
  writeWorkbenchPreferences
} from "../service";
import {
  resetWorkbenchStateStorageForTests,
  writeWorkbenchStateSync
} from "../../state-storage";
import type { WorkbenchPreferences } from "../types";

const defaults: WorkbenchPreferences = {
  locale: "zh-CN",
  theme: "lyra-light",
  uiPackId: "classic",
  terminalThemePreset: "follow-app",
  splitTriggerMode: "ctrl_left_drag",
  splitThreePaneLayout: "adaptive",
  splitOverflowPolicy: "block_with_notice",
  aiRichRenderingEnabled: true,
  aiStopBehavior: "turn_only",
  aiToolDisplayMode: "inner_scroll",
  preventSleepEnabled: true,
  forceWebPageThemingEnabled: true,
  searchScopePreset: "home",
  searchCustomRoots: [],
  searchEnableFuzzy: true,
  searchEnableContent: true,
  searchIncludeHidden: false,
  searchWebEngineIds: ["bing", "brave", "duckduckgo"],
  searchAutoIndexEnabled: true,
  deepSearchDefaultBudget: "medium",
  deepSearchRestoreViewport: false,
  deepSearchLocalOpenBehavior: "open_file",
  deepSearchSiteExpansionEnabled: true,
  deepSearchProactiveDomainGuessingEnabled: true,
  deepSearchCrawlPolicy: "accessibility_only",
  searchResultsSourceFilter: "all",
  omniboxNonBrowserSubmitTarget: "new_tab",
  systemNotificationMode: "background",
  systemNotificationClickBehavior: "open_center",
  systemNotificationActionsEnabled: true
};

describe("workbench preferences", () => {
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
  });

  test("falls back to defaults when storage is empty", () => {
    expect(readWorkbenchPreferences(defaults)).toEqual(defaults);
  });

  test("persists and restores locale/theme", () => {
    writeWorkbenchPreferences({
      ...defaults,
      locale: "en-US",
      theme: "lyra-dark",
      uiPackId: "classic",
      terminalThemePreset: "lyra-rich",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target",
      aiRichRenderingEnabled: false,
      preventSleepEnabled: false
    });

    expect(readWorkbenchPreferences(defaults)).toEqual({
      ...defaults,
      locale: "en-US",
      theme: "lyra-dark",
      uiPackId: "classic",
      terminalThemePreset: "lyra-rich",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target",
      aiRichRenderingEnabled: false,
      preventSleepEnabled: false
    });
  });

  test("accepts system-follow theme value", () => {
    writeWorkbenchPreferences({
      ...defaults,
      locale: "zh-CN",
      theme: "terra-system",
      uiPackId: "classic",
      terminalThemePreset: "lyra-standard",
      splitTriggerMode: "ctrl_left_drag",
      splitThreePaneLayout: "top_two_bottom_one",
      splitOverflowPolicy: "replace_oldest",
      aiRichRenderingEnabled: true
    });

    expect(readWorkbenchPreferences(defaults)).toEqual({
      ...defaults,
      locale: "zh-CN",
      theme: "terra-system",
      uiPackId: "classic",
      terminalThemePreset: "lyra-standard",
      splitTriggerMode: "ctrl_left_drag",
      splitThreePaneLayout: "top_two_bottom_one",
      splitOverflowPolicy: "replace_oldest",
      aiRichRenderingEnabled: true
    });
  });

  test("migrates legacy terminal preset values to lyra-rich", () => {
    writeWorkbenchPreferences({
      ...defaults,
      terminalThemePreset: "ocean-matrix" as unknown as WorkbenchPreferences["terminalThemePreset"]
    });

    expect(readWorkbenchPreferences(defaults).terminalThemePreset).toBe("lyra-rich");
  });

  test("falls back to classic when stored UI pack is unknown", () => {
    writeWorkbenchPreferences({
      ...defaults,
      uiPackId: "unknown-style" as unknown as WorkbenchPreferences["uiPackId"]
    });

    expect(readWorkbenchPreferences(defaults).uiPackId).toBe("classic");
  });

  test("migrates legacy UI style id to UI pack id", () => {
    writeWorkbenchStateSync("preferences", JSON.stringify({
      ...defaults,
      uiPackId: undefined,
      uiStyleId: "classic"
    }));

    expect(readWorkbenchPreferences(defaults).uiPackId).toBe("classic");
  });

  test("preserves external UIUX pack ids after activation", () => {
    writeWorkbenchPreferences({
      ...defaults,
      uiPackId: "external:acme.theme"
    });

    expect(readWorkbenchPreferences(defaults).uiPackId).toBe("external:acme.theme");
  });

  test("updates via model and writes to storage", () => {
    const { result } = renderHook(() => useWorkbenchPreferencesModel(defaults));

    act(() => {
      result.current.setLocale("en-US");
      result.current.setTheme("lyra-dark");
      result.current.setUiPackId("classic");
      result.current.setTerminalThemePreset("lyra-developer");
      result.current.setSplitTriggerMode("right_drag");
      result.current.setSplitThreePaneLayout("left_two_right_one");
      result.current.setSplitOverflowPolicy("replace_target");
      result.current.setAiRichRenderingEnabled(false);
      result.current.setAiStopBehavior("turn_and_background");
      result.current.setAiToolDisplayMode("collapsed");
      result.current.setPreventSleepEnabled(false);
      result.current.setSystemNotificationMode("all");
      result.current.setSystemNotificationClickBehavior("open_source");
      result.current.setSystemNotificationActionsEnabled(false);
    });

    expect(result.current.preferences).toEqual({
      ...defaults,
      locale: "en-US",
      theme: "lyra-dark",
      uiPackId: "classic",
      terminalThemePreset: "lyra-developer",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target",
      aiRichRenderingEnabled: false,
      aiStopBehavior: "turn_and_background",
      aiToolDisplayMode: "collapsed",
      preventSleepEnabled: false,
      systemNotificationMode: "all",
      systemNotificationClickBehavior: "open_source",
      systemNotificationActionsEnabled: false
    });

    expect(readWorkbenchPreferences(defaults)).toEqual({
      ...defaults,
      locale: "en-US",
      theme: "lyra-dark",
      uiPackId: "classic",
      terminalThemePreset: "lyra-developer",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target",
      aiRichRenderingEnabled: false,
      aiStopBehavior: "turn_and_background",
      aiToolDisplayMode: "collapsed",
      preventSleepEnabled: false,
      systemNotificationMode: "all",
      systemNotificationClickBehavior: "open_source",
      systemNotificationActionsEnabled: false
    });
  });

  test("updates search preferences via model and persists", () => {
    const { result } = renderHook(() => useWorkbenchPreferencesModel(defaults));

    act(() => {
      result.current.setSearchScopePreset("custom");
      result.current.setSearchCustomRoots(["/Users/petehsu/Documents", "  /tmp  "]);
      result.current.setSearchEnableFuzzy(false);
      result.current.setSearchEnableContent(false);
      result.current.setSearchIncludeHidden(true);
      result.current.setSearchWebEngineIds(["bing", "searxng"]);
      result.current.setSearchSearxngEndpoint("https://searx.example/search");
      result.current.setSearchAutoIndexEnabled(false);
      result.current.setDeepSearchDefaultBudget("high");
      result.current.setDeepSearchRestoreViewport(true);
      result.current.setDeepSearchLocalOpenBehavior("reveal_in_manager");
      result.current.setSearchResultsSourceFilter("local");
      result.current.setOmniboxNonBrowserSubmitTarget("replace_active_tab");
    });

    expect(result.current.preferences).toEqual({
      ...defaults,
      searchScopePreset: "custom",
      searchCustomRoots: ["/Users/petehsu/Documents", "/tmp"],
      searchEnableFuzzy: false,
      searchEnableContent: false,
      searchIncludeHidden: true,
      searchWebEngineIds: ["bing", "searxng"],
      searchSearxngEndpoint: "https://searx.example/search",
      searchAutoIndexEnabled: false,
      deepSearchDefaultBudget: "high",
      deepSearchRestoreViewport: true,
      deepSearchLocalOpenBehavior: "reveal_in_manager",
      searchResultsSourceFilter: "local",
      omniboxNonBrowserSubmitTarget: "replace_active_tab"
    });
    expect(readWorkbenchPreferences(defaults)).toEqual({
      ...defaults,
      searchScopePreset: "custom",
      searchCustomRoots: ["/Users/petehsu/Documents", "/tmp"],
      searchEnableFuzzy: false,
      searchEnableContent: false,
      searchIncludeHidden: true,
      searchWebEngineIds: ["bing", "searxng"],
      searchSearxngEndpoint: "https://searx.example/search",
      searchAutoIndexEnabled: false,
      deepSearchDefaultBudget: "high",
      deepSearchRestoreViewport: true,
      deepSearchLocalOpenBehavior: "reveal_in_manager",
      searchResultsSourceFilter: "local",
      omniboxNonBrowserSubmitTarget: "replace_active_tab"
    });
  });
});
