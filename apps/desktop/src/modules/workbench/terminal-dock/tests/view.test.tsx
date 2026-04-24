import { render, screen } from "@testing-library/react";
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
    closeTab: "close",
    emptyDock: "empty",
    unavailable: "unavailable"
  },
  themeSignature: "lyra-dark:dark:follow-app",
  themePresetId: "follow-app",
  uiThemeId: "lyra-dark",
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
    closeTab: vi.fn(),
    moveTabToWorkspace: vi.fn(),
    moveTabToDock: vi.fn(),
    reorderDockTab: vi.fn(),
    splitActivePane: vi.fn(),
    splitTab: vi.fn(),
    focusPane: vi.fn(),
    closePane: vi.fn(),
    syncRestoredSessions: vi.fn()
  },
  onRequestCloseTab: vi.fn(),
  onRequestTabContextMenu: vi.fn(),
  onDropWorkspaceTerminalTab: vi.fn()
});

describe("terminal dock view", () => {
  test("does not reload existing sessions when terminal theme changes", () => {
    const reloadPrompt = vi.fn(async () => ({ applied: true, deferred: false }));
    const props = createProps(reloadPrompt);
    const { rerender } = render(<TerminalDock {...props} />);

    expect(screen.getByLabelText("pane-pane-1")).toBeInTheDocument();

    rerender(
      <TerminalDock
        {...props}
        themeSignature="lyra-dark:dark:lyra-rich"
        themePresetId="lyra-rich"
        uiThemeId="lyra-dark"
      />
    );

    expect(reloadPrompt).not.toHaveBeenCalled();
  });
});
