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
  splitTriggerMode: "ctrl_left_drag",
  splitThreePaneLayout: "adaptive",
  splitOverflowPolicy: "block_with_notice",
  aiRichRenderingEnabled: true,
  aiStopBehavior: "turn_only",
  preventSleepEnabled: true,
  editorGpuAcceleration: "off",
  searchWebEngineIds: ["bing", "brave", "duckduckgo"],
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
      theme: "lyra-system",
      uiPackId: "classic",
      splitTriggerMode: "ctrl_left_drag",
      splitThreePaneLayout: "top_two_bottom_one",
      splitOverflowPolicy: "replace_oldest",
      aiRichRenderingEnabled: true
    });

    expect(readWorkbenchPreferences(defaults)).toEqual({
      ...defaults,
      locale: "zh-CN",
      theme: "lyra-system",
      uiPackId: "classic",
      splitTriggerMode: "ctrl_left_drag",
      splitThreePaneLayout: "top_two_bottom_one",
      splitOverflowPolicy: "replace_oldest",
      aiRichRenderingEnabled: true
    });
  });

  test("migrates legacy theme family values into Lyra theme ids", () => {
    writeWorkbenchStateSync("preferences", JSON.stringify({
      ...defaults,
      theme: "terra-dark"
    }));

    expect(readWorkbenchPreferences(defaults).theme).toBe("lyra-dark");
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

  test("ignores legacy AI tool display mode preference", () => {
    writeWorkbenchStateSync("preferences", JSON.stringify({
      ...defaults,
      aiToolDisplayMode: "inner_scroll"
    }));

    expect(readWorkbenchPreferences(defaults)).toEqual(defaults);
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
      result.current.setSplitTriggerMode("right_drag");
      result.current.setSplitThreePaneLayout("left_two_right_one");
      result.current.setSplitOverflowPolicy("replace_target");
      result.current.setAiRichRenderingEnabled(false);
      result.current.setAiStopBehavior("turn_and_background");
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
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target",
      aiRichRenderingEnabled: false,
      aiStopBehavior: "turn_and_background",
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
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target",
      aiRichRenderingEnabled: false,
      aiStopBehavior: "turn_and_background",
      preventSleepEnabled: false,
      systemNotificationMode: "all",
      systemNotificationClickBehavior: "open_source",
      systemNotificationActionsEnabled: false
    });
  });

  test("updates web search preferences via model and persists", () => {
    const { result } = renderHook(() => useWorkbenchPreferencesModel(defaults));

    act(() => {
      result.current.setSearchWebEngineIds(["bing", "searxng"]);
      result.current.setSearchSearxngEndpoint("https://searx.example/search");
    });

    expect(result.current.preferences).toEqual({
      ...defaults,
      searchWebEngineIds: ["bing", "searxng"],
      searchSearxngEndpoint: "https://searx.example/search"
    });
  });

  test("ignores legacy local search settings from persisted storage", () => {
    writeWorkbenchStateSync("preferences", JSON.stringify({
      ...defaults,
      searchScopePreset: "custom",
      searchCustomRoots: ["/Users/petehsu/Documents", "/tmp"],
      searchEnableFuzzy: false,
      searchEnableContent: false,
      searchIncludeHidden: true,
      searchAutoIndexEnabled: false
    }));

    expect(readWorkbenchPreferences(defaults)).toEqual(defaults);
  });

  test("reset restores defaults", () => {
    const { result } = renderHook(() => useWorkbenchPreferencesModel(defaults));

    act(() => {
      result.current.setLocale("en-US");
      result.current.setTheme("lyra-dark");
    });

    expect(result.current.preferences.locale).toBe("en-US");

    act(() => {
      result.current.reset();
    });

    expect(result.current.preferences).toEqual(defaults);
  });
});
