import { describe, expect, test } from "vitest";

import {
  closeTerminalPaneState,
  createDefaultTerminalDockState,
  moveTerminalTabToDockState,
  moveTerminalTabToWorkspaceState,
  openTerminalTabState,
  reorderDockTerminalTabState,
  splitActivePaneState,
  syncTerminalSnapshotsState
} from "../service";

describe("terminal dock service", () => {
  test("opens a new terminal tab", () => {
    const state = createDefaultTerminalDockState();
    const next = openTerminalTabState(state);

    expect(next.tabs.length).toBe(2);
    expect(next.activeTabId).toBe(next.tabs[1]?.id);
  });

  test("splits active pane vertically", () => {
    const state = createDefaultTerminalDockState();
    const next = splitActivePaneState(state, "vertical");

    expect(next.tabs[0]?.orientation).toBe("vertical");
    expect(next.tabs[0]?.paneIds.length).toBe(2);
  });

  test("closes non-last pane", () => {
    const state = splitActivePaneState(createDefaultTerminalDockState(), "horizontal");
    const activeTab = state.tabs[0]!;
    const paneToClose = activeTab.paneIds[0]!;

    const next = closeTerminalPaneState(state, paneToClose);
    expect(next.tabs[0]?.paneIds.length).toBe(1);
  });

  test("syncs restored session snapshot metadata", () => {
    const state = createDefaultTerminalDockState();
    const pane = Object.values(state.panes)[0]!;

    const next = syncTerminalSnapshotsState(state, [
      {
        sessionId: pane.sessionId,
        title: "Restored Shell",
        cwd: "/tmp",
        shell: "/bin/zsh",
        cols: 80,
        rows: 24,
        createdAt: "1000"
      }
    ]);

    expect(next.panes[pane.id]?.title).toBe("Restored Shell");
    expect(next.panes[pane.id]?.cwd).toBe("/tmp");
  });

  test("moves dock tab to workspace placement", () => {
    const state = createDefaultTerminalDockState();
    const tabId = state.tabs[0]!.id;

    const next = moveTerminalTabToWorkspaceState(state, tabId);
    expect(next.tabs[0]?.placement).toBe("workspace");
  });

  test("moves workspace tab back to dock placement", () => {
    const state = createDefaultTerminalDockState();
    const tabId = state.tabs[0]!.id;

    const moved = moveTerminalTabToWorkspaceState(state, tabId);
    const restored = moveTerminalTabToDockState(moved, tabId);

    expect(restored.tabs[0]?.placement).toBe("dock");
    expect(restored.activeTabId).toBe(tabId);
  });

  test("reorders dock tabs by target index", () => {
    const withSecondTab = openTerminalTabState(createDefaultTerminalDockState());
    const withThirdTab = openTerminalTabState(withSecondTab);
    const movingTabId = withThirdTab.tabs[2]!.id;

    const reordered = reorderDockTerminalTabState(withThirdTab, movingTabId, 0);

    expect(reordered.tabs[0]?.id).toBe(movingTabId);
    expect(reordered.tabs.map((tab) => tab.placement)).toEqual([
      "dock",
      "dock",
      "dock"
    ]);
  });
});
