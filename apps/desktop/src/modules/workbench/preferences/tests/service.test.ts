import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import {
  readWorkbenchPreferences,
  useWorkbenchPreferencesModel,
  writeWorkbenchPreferences
} from "../service";
import { resetWorkbenchStateStorageForTests } from "../../state-storage";
import type { WorkbenchPreferences } from "../types";

const defaults: WorkbenchPreferences = {
  locale: "zh-CN",
  theme: "one-light",
  terminalThemePreset: "glacier-blocks",
  splitTriggerMode: "ctrl_left_drag",
  splitThreePaneLayout: "adaptive",
  splitOverflowPolicy: "block_with_notice",
  aiRichRenderingEnabled: true,
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
  omniboxNonBrowserSubmitTarget: "new_tab"
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
      theme: "one-dark",
      terminalThemePreset: "ocean-matrix",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target",
      aiRichRenderingEnabled: false
    });

    expect(readWorkbenchPreferences(defaults)).toEqual({
      ...defaults,
      locale: "en-US",
      theme: "one-dark",
      terminalThemePreset: "ocean-matrix",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target",
      aiRichRenderingEnabled: false
    });
  });

  test("accepts system-follow theme value", () => {
    writeWorkbenchPreferences({
      ...defaults,
      locale: "zh-CN",
      theme: "gruvbox-system",
      terminalThemePreset: "mono-signal",
      splitTriggerMode: "ctrl_left_drag",
      splitThreePaneLayout: "top_two_bottom_one",
      splitOverflowPolicy: "replace_oldest",
      aiRichRenderingEnabled: true
    });

    expect(readWorkbenchPreferences(defaults)).toEqual({
      ...defaults,
      locale: "zh-CN",
      theme: "gruvbox-system",
      terminalThemePreset: "mono-signal",
      splitTriggerMode: "ctrl_left_drag",
      splitThreePaneLayout: "top_two_bottom_one",
      splitOverflowPolicy: "replace_oldest",
      aiRichRenderingEnabled: true
    });
  });

  test("updates via model and writes to storage", () => {
    const { result } = renderHook(() => useWorkbenchPreferencesModel(defaults));

    act(() => {
      result.current.setLocale("en-US");
      result.current.setTheme("one-dark");
      result.current.setTerminalThemePreset("amber-forge");
      result.current.setSplitTriggerMode("right_drag");
      result.current.setSplitThreePaneLayout("left_two_right_one");
      result.current.setSplitOverflowPolicy("replace_target");
      result.current.setAiRichRenderingEnabled(false);
    });

    expect(result.current.preferences).toEqual({
      ...defaults,
      locale: "en-US",
      theme: "one-dark",
      terminalThemePreset: "amber-forge",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target",
      aiRichRenderingEnabled: false
    });

    expect(readWorkbenchPreferences(defaults)).toEqual({
      ...defaults,
      locale: "en-US",
      theme: "one-dark",
      terminalThemePreset: "amber-forge",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target",
      aiRichRenderingEnabled: false
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
