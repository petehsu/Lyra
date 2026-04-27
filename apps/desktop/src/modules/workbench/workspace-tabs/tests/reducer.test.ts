import { describe, expect, test } from "vitest";

import { reduceWorkspaceTabsState } from "../reducer";
import type { WorkspaceTabsRuntimeState } from "../runtime-state";
import {
  createAppTabWithId,
  createPageTabWithId,
  createSearchTabWithId,
  createSettingsTabWithId,
  createTerminalTabWithId
} from "../tab-factory";
import type {
  WorkspaceTab,
  WorkspaceTabsConfig,
  WorkspaceTabsOptions
} from "../types";

const testConfig: WorkspaceTabsConfig = {
  homeTabTitle: "Home",
  settingsTabTitle: "Settings",
  homeSearchAddress: "lyra://search",
  maxSearchTitleLength: 12
};

const defaultOptions: WorkspaceTabsOptions = {
  splitOverflowPolicy: "block_with_notice"
};

const createState = (
  tabs: readonly WorkspaceTab[],
  activeTabId = tabs[0]?.id ?? ""
): WorkspaceTabsRuntimeState => ({
  tabs,
  activeTabId,
  splitGroupTabIds: [],
  focusedSplitTabId: null
});

const reduce = (
  state: WorkspaceTabsRuntimeState,
  action: Parameters<typeof reduceWorkspaceTabsState>[1],
  options = defaultOptions
) => reduceWorkspaceTabsState(state, action, { config: testConfig, options });

describe("workspace tabs reducer", () => {
  test("opens and closes tabs while choosing the previous tab as active fallback", () => {
    const firstTab = createSearchTabWithId("browser-tab-1", testConfig);
    const secondTab = createSearchTabWithId("browser-tab-2", testConfig);

    const opened = reduce(createState([firstTab]), {
      type: "open-new-tab",
      tab: secondTab
    });

    expect(opened.consumedSerial).toBe(true);
    expect(opened.state.tabs.map((tab) => tab.id)).toEqual([
      "browser-tab-1",
      "browser-tab-2"
    ]);
    expect(opened.state.activeTabId).toBe("browser-tab-2");

    const closed = reduce(opened.state, {
      type: "close-tab",
      tabId: "browser-tab-2"
    });

    expect(closed.state.tabs.map((tab) => tab.id)).toEqual(["browser-tab-1"]);
    expect(closed.state.activeTabId).toBe("browser-tab-1");
  });

  test("keeps settings, terminal, and app tabs singleton by their identity keys", () => {
    const firstTab = createSearchTabWithId("browser-tab-1", testConfig);
    let state = createState([firstTab]);

    const settings = reduce(state, {
      type: "open-settings-tab",
      tab: createSettingsTabWithId("browser-tab-2", testConfig)
    });
    state = settings.state;
    const existingSettings = reduce(state, {
      type: "open-settings-tab",
      tab: createSettingsTabWithId("browser-tab-3", testConfig)
    });

    expect(existingSettings.consumedSerial).toBe(false);
    expect(existingSettings.state.tabs).toHaveLength(2);
    expect(existingSettings.state.activeTabId).toBe("browser-tab-2");

    state = reduce(existingSettings.state, {
      type: "open-terminal-tab",
      terminalTabId: "terminal-1",
      tab: createTerminalTabWithId("browser-tab-4", "terminal-1", "Terminal 1")
    }).state;
    const existingTerminal = reduce(state, {
      type: "open-terminal-tab",
      terminalTabId: "terminal-1",
      tab: createTerminalTabWithId("browser-tab-5", "terminal-1", "Terminal 1")
    });

    expect(existingTerminal.consumedSerial).toBe(false);
    expect(existingTerminal.state.tabs).toHaveLength(3);
    expect(existingTerminal.state.activeTabId).toBe("browser-tab-4");

    const appRequest = {
      appId: "file-manager" as const,
      appInstanceId: "file-manager-1",
      title: "Files",
      iconKey: "file-manager-home" as const
    };
    state = reduce(existingTerminal.state, {
      type: "open-app-tab",
      request: appRequest,
      tab: createAppTabWithId("browser-tab-6", appRequest)
    }).state;
    const existingApp = reduce(state, {
      type: "open-app-tab",
      request: appRequest,
      tab: createAppTabWithId("browser-tab-7", appRequest)
    });

    expect(existingApp.consumedSerial).toBe(false);
    expect(existingApp.state.tabs).toHaveLength(4);
    expect(existingApp.state.activeTabId).toBe("browser-tab-6");
  });

  test("keeps split groups contiguous through reorder and detach actions", () => {
    const tabs = ["tab-a", "tab-b", "tab-c", "tab-d"].map((id) =>
      createSearchTabWithId(id, testConfig)
    );
    let state = createState(tabs, "tab-d");

    state = reduce(state, {
      type: "split-tab-with-target",
      sourceTabId: "tab-c",
      targetTabId: "tab-b"
    }).state;
    state = reduce(state, {
      type: "reorder-tab",
      tabId: "tab-c",
      targetIndex: 0
    }).state;

    expect(state.tabs.map((tab) => tab.id)).toEqual([
      "tab-b",
      "tab-c",
      "tab-a",
      "tab-d"
    ]);

    state = reduce(state, {
      type: "detach-tab-from-split",
      tabId: "tab-c"
    }).state;

    expect(state.activeTabId).toBe("tab-c");
    expect(state.splitGroupTabIds).toEqual([]);
    expect(state.focusedSplitTabId).toBeNull();
  });

  test("blocks split overflow according to the configured policy", () => {
    const tabs = ["tab-a", "tab-b", "tab-c", "tab-d", "tab-e"].map((id) =>
      createSearchTabWithId(id, testConfig)
    );
    let state = createState(tabs, "tab-e");

    for (const tabId of ["tab-b", "tab-c", "tab-d", "tab-e"]) {
      state = reduce(state, {
        type: "split-tab-with-target",
        sourceTabId: tabId,
        targetTabId: "tab-a"
      }).state;
    }

    expect(state.splitGroupTabIds).toEqual(["tab-a", "tab-b", "tab-c", "tab-d"]);
  });

  test("restores snapshots with normalized active and split state", () => {
    const firstTab = createSearchTabWithId("browser-tab-4", testConfig);
    const pageTab = createPageTabWithId("browser-tab-9", "https://example.com");
    const restored = reduce(createState([firstTab]), {
      type: "restore-session",
      snapshot: {
        tabs: [firstTab, pageTab],
        activeTabId: "missing-tab",
        splitGroupTabIds: ["browser-tab-9", "browser-tab-4"],
        focusedSplitTabId: "missing-tab"
      }
    });

    expect(restored.nextSerial).toBe(10);
    expect(restored.latestInputValue).toBe("");
    expect(restored.state).toMatchObject({
      activeTabId: "browser-tab-4",
      splitGroupTabIds: ["browser-tab-9", "browser-tab-4"],
      focusedSplitTabId: "browser-tab-9"
    });
  });

  test("replacing an app tab with navigation clears app-specific metadata", () => {
    const appRequest = {
      appId: "file-editor" as const,
      appInstanceId: "file-editor-1",
      title: "notes.md",
      iconKey: "file-editor-code" as const,
      filePath: "/tmp/notes.md",
      fileSessionId: "session-1",
      isDirty: true
    };
    const appTab = createAppTabWithId("browser-tab-2", appRequest);

    const navigated = reduce(createState([appTab], appTab.id), {
      type: "navigate-active-tab",
      request: {
        kind: "page",
        address: "https://example.com/docs"
      }
    });

    expect(navigated.latestInputValue).toBe("https://example.com/docs");
    expect(navigated.state.tabs[0]).toMatchObject({
      id: "browser-tab-2",
      pageKind: "page",
      displayAddress: "https://example.com/docs"
    });
    expect(navigated.state.tabs[0]?.appId).toBeUndefined();
    expect(navigated.state.tabs[0]?.filePath).toBeUndefined();
    expect(navigated.state.tabs[0]?.isDirty).toBeUndefined();
  });
});
