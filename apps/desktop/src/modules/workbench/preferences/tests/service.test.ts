import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import {
  readWorkbenchPreferences,
  useWorkbenchPreferencesModel,
  writeWorkbenchPreferences
} from "../service";
import { resetWorkbenchStateStorageForTests } from "../../state-storage";

const defaults = {
  locale: "zh-CN",
  theme: "one-light",
  terminalThemePreset: "glacier-blocks",
  splitTriggerMode: "ctrl_left_drag",
  splitThreePaneLayout: "adaptive",
  splitOverflowPolicy: "block_with_notice"
} as const;

describe("workbench preferences", () => {
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
  });

  test("falls back to defaults when storage is empty", () => {
    expect(readWorkbenchPreferences(defaults)).toEqual(defaults);
  });

  test("persists and restores locale/theme", () => {
    writeWorkbenchPreferences({
      locale: "en-US",
      theme: "one-dark",
      terminalThemePreset: "ocean-matrix",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target"
    });

    expect(readWorkbenchPreferences(defaults)).toEqual({
      locale: "en-US",
      theme: "one-dark",
      terminalThemePreset: "ocean-matrix",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target"
    });
  });

  test("accepts system-follow theme value", () => {
    writeWorkbenchPreferences({
      locale: "zh-CN",
      theme: "gruvbox-system",
      terminalThemePreset: "mono-signal",
      splitTriggerMode: "ctrl_left_drag",
      splitThreePaneLayout: "top_two_bottom_one",
      splitOverflowPolicy: "replace_oldest"
    });

    expect(readWorkbenchPreferences(defaults)).toEqual({
      locale: "zh-CN",
      theme: "gruvbox-system",
      terminalThemePreset: "mono-signal",
      splitTriggerMode: "ctrl_left_drag",
      splitThreePaneLayout: "top_two_bottom_one",
      splitOverflowPolicy: "replace_oldest"
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
    });

    expect(result.current.preferences).toEqual({
      locale: "en-US",
      theme: "one-dark",
      terminalThemePreset: "amber-forge",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target"
    });

    expect(readWorkbenchPreferences(defaults)).toEqual({
      locale: "en-US",
      theme: "one-dark",
      terminalThemePreset: "amber-forge",
      splitTriggerMode: "right_drag",
      splitThreePaneLayout: "left_two_right_one",
      splitOverflowPolicy: "replace_target"
    });
  });
});
