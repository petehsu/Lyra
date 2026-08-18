import { describe, expect, test } from "vitest";

import {
  applyTerminalCwdChangedState,
  closeTerminalPaneState,
  closeTerminalTabState,
  createDefaultTerminalDockState,
  moveTerminalTabToDockState,
  moveTerminalTabToWorkspaceState,
  openTerminalTabWithProfileState,
  openTerminalTabWithPlacementState,
  openTerminalTabState,
  renameTerminalTabState,
  reorderDockTerminalTabState,
  setTerminalPaneFollowModeState,
  splitActivePaneState,
  splitTerminalTabWithOptionsState,
  syncTerminalSnapshotsState,
  toggleTerminalTabFavoriteState,
  toggleTerminalTabPinnedState
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

  test("splits with explicit shell options without copying the source startup command", () => {
    const state = openTerminalTabWithProfileState(createDefaultTerminalDockState(), {
      id: "task",
      name: "Task",
      startupCommand: "npm test",
      mode: "command"
    }).state;
    const tab = state.tabs[state.tabs.length - 1]!;

    const result = splitTerminalTabWithOptionsState(state, tab.id, "horizontal", {
      title: "Agent Terminal",
      profileId: "shell",
      mode: "shell"
    });

    expect(result?.pane).toMatchObject({
      title: "Agent Terminal",
      profileId: "shell",
      mode: "shell"
    });
    expect(result?.pane).not.toHaveProperty("startupCommand");
    expect(result?.pane).not.toHaveProperty("command");
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

    expect(next.panes[pane.id]?.title).toBe("tmp");
    expect(next.panes[pane.id]?.autoTitle).toBe("tmp");
    expect(next.panes[pane.id]?.cwd).toBe("/tmp");
  });

  test("moves dock tab to workspace placement", () => {
    const state = createDefaultTerminalDockState();
    const tabId = state.tabs[0]!.id;

    const next = moveTerminalTabToWorkspaceState(state, tabId);
    expect(next.tabs[0]?.placement).toBe("workspace");
  });

  test("auto-creates a new dock tab when moving the last dock tab to workspace", () => {
    const state = createDefaultTerminalDockState();
    const tabId = state.tabs[0]!.id;

    const next = moveTerminalTabToWorkspaceState(state, tabId);

    expect(next.tabs.length).toBe(2);
    expect(next.tabs.find((tab) => tab.id === tabId)?.placement).toBe("workspace");
    expect(next.tabs.find((tab) => tab.id !== tabId)?.placement).toBe("dock");
    expect(next.activeTabId).not.toBe(tabId);
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

  test("creates a terminal tab from profile metadata", () => {
    const state = createDefaultTerminalDockState();
    const result = openTerminalTabWithProfileState(state, {
      id: "developer",
      name: "Developer",
      shell: "zsh",
      cwd: "/workspace",
      env: [{ key: "NODE_ENV", value: "test" }],
      startupCommand: "npm test",
      mode: "command"
    });

    expect(result.tab.profileId).toBe("developer");
    expect(result.pane).toMatchObject({
      profileId: "developer",
      title: "Developer",
      shell: "zsh",
      cwd: "/workspace",
      command: "npm test",
      startupCommand: "npm test",
      mode: "command"
    });
    expect(result.pane.env).toEqual([{ key: "NODE_ENV", value: "test" }]);
  });

  test("renames tab and active pane together", () => {
    const state = createDefaultTerminalDockState();
    const tab = state.tabs[0]!;
    const next = renameTerminalTabState(state, tab.id, "Build Shell");

    expect(next.tabs[0]?.title).toBe("Build Shell");
    expect(next.tabs[0]?.titleLocked).toBe(true);
    expect(next.panes[tab.activePaneId]?.title).toBe("Build Shell");
    expect(next.panes[tab.activePaneId]?.titleLocked).toBe(true);
  });

  test("updates current cwd and auto title from cwdChanged events", () => {
    const result = openTerminalTabWithPlacementState(createDefaultTerminalDockState(), {
      mode: "shell",
      cwd: "/Users/petehsu/Documents/Lyra"
    });
    const pane = result.pane;

    const next = applyTerminalCwdChangedState(result.state, {
      kind: "cwdChanged",
      sessionId: pane.sessionId,
      cwd: "/Users/petehsu/Documents/Lyra/apps/desktop",
      currentCwd: "/Users/petehsu/Documents/Lyra/apps/desktop"
    });

    expect(next.panes[pane.id]?.currentCwd).toBe("/Users/petehsu/Documents/Lyra/apps/desktop");
    expect(next.panes[pane.id]?.autoTitle).toBe("desktop");
    expect(next.tabs.find((tab) => tab.id === result.tab.id)?.title).toBe("desktop");
  });

  test("does not overwrite a manually locked title on cwd changes", () => {
    const result = openTerminalTabWithPlacementState(createDefaultTerminalDockState(), {
      mode: "shell",
      cwd: "/Users/petehsu/Documents/Lyra"
    });
    const renamed = renameTerminalTabState(result.state, result.tab.id, "Pinned Name");

    const next = applyTerminalCwdChangedState(renamed, {
      kind: "cwdChanged",
      sessionId: result.pane.sessionId,
      cwd: "/tmp/project",
      currentCwd: "/tmp/project"
    });

    expect(next.tabs.find((tab) => tab.id === result.tab.id)?.title).toBe("Pinned Name");
    expect(next.panes[result.pane.id]?.title).toBe("Pinned Name");
    expect(next.panes[result.pane.id]?.autoTitle).toBe("project");
  });

  test("stores source agent session metadata for UI terminal panes", () => {
    const result = openTerminalTabWithPlacementState(createDefaultTerminalDockState(), {
      sourceAgentSessionId: "agent-session-1",
      cwd: "/Users/petehsu/Documents/Lyra"
    });

    expect(result.pane.sourceAgentSessionId).toBe("agent-session-1");
    expect(result.state.panes[result.pane.id]?.sourceAgentSessionId).toBe("agent-session-1");
  });

  test("stores pane follow mode", () => {
    const state = createDefaultTerminalDockState();
    const tab = state.tabs[0]!;
    const next = setTerminalPaneFollowModeState(state, tab.id, tab.activePaneId, "takeover");

    expect(next.panes[tab.activePaneId]?.followMode).toBe("takeover");
  });

  test("toggles pinned and favorite tab metadata", () => {
    const state = createDefaultTerminalDockState();
    const tab = state.tabs[0]!;
    const pinned = toggleTerminalTabPinnedState(state, tab.id);
    const favorite = toggleTerminalTabFavoriteState(pinned, tab.id);

    expect(favorite.tabs[0]?.pinned).toBe(true);
    expect(favorite.tabs[0]?.favorite).toBe(true);
  });

  test("auto-creates a new terminal when closing the last tab", () => {
    const state = createDefaultTerminalDockState();
    const tabId = state.tabs[0]!.id;

    const next = closeTerminalTabState(state, tabId);

    expect(next.tabs.length).toBe(1);
    expect(next.tabs[0]?.id).not.toBe(tabId);
    expect(next.activeTabId).toBe(next.tabs[0]?.id);
  });
});
