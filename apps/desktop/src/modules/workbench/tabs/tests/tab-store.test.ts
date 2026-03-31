import { beforeEach, describe, expect, test } from "vitest";

import { useTabStore } from "../service";

describe("tab store", () => {
  beforeEach(() => {
    useTabStore.setState(useTabStore.getInitialState());
  });

  test("creates plugin tab and activates it", () => {
    useTabStore.getState().createPluginTab();

    const state = useTabStore.getState();
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);

    expect(activeTab?.type).toBe("plugin");
    expect(state.tabs.length).toBeGreaterThan(3);
  });

  test("closes and restores tab", () => {
    const firstTab = useTabStore.getState().tabs[0];
    if (firstTab === undefined) {
      throw new Error("missing seed tab");
    }

    useTabStore.getState().closeTab(firstTab.id);
    expect(useTabStore.getState().tabs.some((tab) => tab.id === firstTab.id)).toBe(false);

    useTabStore.getState().restoreClosedTab();
    expect(useTabStore.getState().tabs.some((tab) => tab.id === firstTab.id)).toBe(true);
  });
});
