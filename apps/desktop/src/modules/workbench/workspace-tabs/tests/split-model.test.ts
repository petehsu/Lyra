import { describe, expect, test } from "vitest";

import type { WorkspaceTabsRuntimeState } from "../runtime-state";
import {
  composeSplitGroup,
  createVisibleWorkspaceLayout,
  keepSplitGroupContiguous,
  reorderSplitGroupByTabId,
  resolveRuntimeState
} from "../split-model";
import { createSearchTabWithId } from "../tab-factory";
import type { WorkspaceTab, WorkspaceTabsConfig } from "../types";

const testConfig: WorkspaceTabsConfig = {
  homeTabTitle: "Home",
  settingsTabTitle: "Settings",
  homeSearchAddress: "lyra://search",
  maxSearchTitleLength: 12
};

const createTab = (id: string): WorkspaceTab => createSearchTabWithId(id, testConfig);

describe("workspace tab split model", () => {
  test("applies configured overflow policy when composing split groups", () => {
    const current = ["tab-a", "tab-b", "tab-c", "tab-d"];

    expect(
      composeSplitGroup(current, "tab-e", "tab-b", {
        splitOverflowPolicy: "block_with_notice"
      })
    ).toBeNull();

    expect(
      composeSplitGroup(current, "tab-e", "tab-b", {
        splitOverflowPolicy: "replace_target"
      })
    ).toEqual(["tab-a", "tab-c", "tab-d", "tab-e"]);

    expect(
      composeSplitGroup(current, "tab-e", "tab-b", {
        splitOverflowPolicy: "replace_oldest"
      })
    ).toEqual(["tab-b", "tab-c", "tab-d", "tab-e"]);
  });

  test("moves split tabs as one block when a member is reordered", () => {
    const tabs = ["tab-a", "tab-b", "tab-c", "tab-d", "tab-e"].map(createTab);

    expect(
      reorderSplitGroupByTabId(tabs, ["tab-c", "tab-d"], "tab-d", 0).map(
        (tab) => tab.id
      )
    ).toEqual(["tab-c", "tab-d", "tab-a", "tab-b", "tab-e"]);
  });

  test("keeps split tabs contiguous after outside tab insertions", () => {
    const tabs = ["tab-a", "tab-c", "tab-b", "tab-d", "tab-e"].map(createTab);

    expect(keepSplitGroupContiguous(tabs, ["tab-c", "tab-d"]).map((tab) => tab.id)).toEqual([
      "tab-a",
      "tab-c",
      "tab-d",
      "tab-b",
      "tab-e"
    ]);
  });

  test("normalizes invalid active and split references before creating layout", () => {
    const state: WorkspaceTabsRuntimeState = {
      tabs: ["tab-a", "tab-b", "tab-c"].map(createTab),
      activeTabId: "missing-tab",
      splitGroupTabIds: ["tab-b", "missing-tab", "tab-b", "tab-c"],
      focusedSplitTabId: "missing-tab"
    };

    const normalized = resolveRuntimeState(state, testConfig);

    expect(normalized).toMatchObject({
      activeTabId: "tab-a",
      splitGroupTabIds: ["tab-b", "tab-c"],
      focusedSplitTabId: "tab-b"
    });
    expect(createVisibleWorkspaceLayout(normalized)).toEqual({
      mode: "single",
      activeTabId: "tab-a",
      visibleTabIds: ["tab-a"],
      splitGroupTabIds: ["tab-b", "tab-c"],
      focusedSplitTabId: "tab-b"
    });
  });
});
