import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { TerminalDock } from "../view";
import type { TerminalDockProps } from "../types";

vi.mock("../pane-surface", () => ({
  TerminalPaneSurface: ({ pane }: { readonly pane: { readonly id: string } }) => (
    <div aria-label={`pane-${pane.id}`} />
  )
}));

const createProps = (reloadPrompt = vi.fn(async () => ({ applied: true, deferred: false }))): TerminalDockProps => ({
  desktopApi: {
    terminal: {
      reloadPrompt
    }
  } as unknown as TerminalDockProps["desktopApi"],
  labels: {
    newTab: "new",
    splitHorizontal: "split-horizontal",
    splitVertical: "split-vertical",
    moveTerminalToTop: "move-top",
    moveTerminalToBottom: "move-bottom",
    closeTab: "close",
    newTabWithProfile: "new-profile",
    profile: "profile",
    renameTab: "rename",
    pinTab: "pin",
    unpinTab: "unpin",
    favoriteTab: "favorite",
    unfavoriteTab: "unfavorite",
    exited: "exited",
    emptyDock: "empty",
    unavailable: "unavailable"
  },
  themeSignature: "lyra-dark:dark",
  uiThemeId: "lyra-dark",
  terminalPanelSide: "top",
  model: {
    state: {
      activeTabId: "tab-1",
      tabs: [
        {
          id: "tab-1",
          title: "Terminal",
          orientation: "horizontal",
          paneIds: ["pane-1"],
          activePaneId: "pane-1",
          placement: "dock"
        }
      ],
      panes: {
        "pane-1": {
          id: "pane-1",
          sessionId: "session-1",
          title: "Terminal"
        }
      }
    },
    dockTabs: [
      {
        id: "tab-1",
        title: "Terminal",
        orientation: "horizontal",
        paneIds: ["pane-1"],
        activePaneId: "pane-1",
        placement: "dock"
      }
    ],
    workspaceTabs: [],
    activeDockTab: {
      id: "tab-1",
      title: "Terminal",
      orientation: "horizontal",
      paneIds: ["pane-1"],
      activePaneId: "pane-1",
      placement: "dock"
    },
    activeDockPanes: [
      {
        id: "pane-1",
        sessionId: "session-1",
        title: "Terminal"
      }
    ],
    restoreRequest: { sessions: [] },
    findTab: vi.fn(() => null),
    getTabPanes: vi.fn(() => []),
    setActiveTab: vi.fn(),
    openTab: vi.fn(),
    openTabWithProfile: vi.fn(),
    openTabWithPlacement: vi.fn(() => ({
      tab: {
        id: "tab-2",
        title: "Terminal 2",
        orientation: "horizontal" as const,
        paneIds: ["pane-2"],
        activePaneId: "pane-2",
        placement: "dock" as const
      },
      pane: {
        id: "pane-2",
        sessionId: "session-2",
        title: "Terminal 2"
      }
    })),
    renameTab: vi.fn(),
    toggleTabPinned: vi.fn(),
    toggleTabFavorite: vi.fn(),
    closeTab: vi.fn(),
    moveTabToWorkspace: vi.fn(),
    moveTabToDock: vi.fn(),
    reorderDockTab: vi.fn(),
    splitActivePane: vi.fn(),
    splitTab: vi.fn(),
    splitTabWithOptions: vi.fn(() => null),
    focusPane: vi.fn(),
    setPaneFollowMode: vi.fn(),
    closePane: vi.fn(),
    syncRestoredSessions: vi.fn(),
    applyCwdChanged: vi.fn()
  },
  onRequestCloseTab: vi.fn(),
  onRequestTabContextMenu: vi.fn(),
  onToggleTerminalPanelSide: vi.fn(),
  onDropWorkspaceTerminalTab: vi.fn()
});

describe("terminal dock view", () => {
  test("does not reload existing sessions when app theme changes", () => {
    const reloadPrompt = vi.fn(async () => ({ applied: true, deferred: false }));
    const props = createProps(reloadPrompt);
    const { rerender } = render(<TerminalDock {...props} />);

    expect(screen.getByLabelText("pane-pane-1")).toBeInTheDocument();

    rerender(
      <TerminalDock
        {...props}
        themeSignature="lyra-light:light"
        uiThemeId="lyra-dark"
      />
    );

    expect(reloadPrompt).not.toHaveBeenCalled();
  });

  test("renders terminal side placement control with toolbar actions", () => {
    const props = createProps();
    render(<TerminalDock {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "move-bottom" }));

    expect(props.onToggleTerminalPanelSide).toHaveBeenCalledTimes(1);
  });

  test("opens a normal terminal without exposing profile choices", () => {
    const props = createProps();
    render(<TerminalDock {...props} />);

    expect(screen.queryByRole("combobox", { name: "profile" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "new" }));

    expect(props.model.openTab).toHaveBeenCalledTimes(1);
    expect(props.model.openTabWithProfile).not.toHaveBeenCalled();
  });
});
