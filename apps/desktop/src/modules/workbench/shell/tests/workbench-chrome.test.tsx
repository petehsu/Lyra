import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { WorkbenchChrome } from "../workbench-chrome";
import type {
  WorkbenchActionApi,
  WorkbenchChromeLabels,
  WorkbenchPresentationState
} from "../use-workbench-action-api";

const labels: WorkbenchChromeLabels = {
  toggleAiPanel: "Toggle AI",
  toggleTerminalPanel: "Toggle terminal",
  moveTerminalToTop: "Move terminal top",
  moveTerminalToBottom: "Move terminal bottom",
  openSettings: "Open settings",
  openSoftwareStore: "Open Software Store",
  openLoginManager: "Open Login Manager",
  openFiles: "Open files",
  openAgentSessionHistory: "Open Agent History",
  openDocs: "Open docs",
  minimizeWindow: "Minimize",
  toggleMaximizeWindow: "Maximize",
  closeWindow: "Close"
};

const createActions = (): WorkbenchActionApi => ({
  openNewTab: vi.fn(),
  openSettings: vi.fn(),
  openSoftwareStore: vi.fn(),
  openLoginManager: vi.fn(),
  openFileManager: vi.fn(),
  openAgentSessionHistory: vi.fn(),
  openDocs: vi.fn(),
  toggleAiPanel: vi.fn(),
  toggleTerminalPanel: vi.fn(),
  toggleTerminalPanelSide: vi.fn(),
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  closeWindow: vi.fn()
});

const presentationState: WorkbenchPresentationState = {
  isMac: false,
  isMaximized: false,
  isAiPanelVisible: true,
  isTerminalPanelVisible: true,
  terminalPanelSide: "top"
};

describe("WorkbenchChrome", () => {
  test("renders titlebar actions without settings-owned shortcuts", () => {
    const actions = createActions();

    render(
      <WorkbenchChrome
        rootRef={createRef<HTMLElement>()}
        rootClassName="lyra-root"
        rootStyle={{}}
        uiRuntime={{ rootAttributes: {} } as never}
        actions={actions}
        labels={labels}
        presentationState={presentationState}
        isMac={false}
        layout={{
          aiPanelSide: "left",
          terminalPanelSide: "top",
          isLeftPanelVisible: true,
          isBottomPanelVisible: true
        }}
        layoutActions={{
          onLeftResizeMouseDown: vi.fn(),
          onBottomResizeMouseDown: vi.fn()
        }}
        slots={{
          titlebarNavigation: null,
          titlebarContext: null,
          leftPanel: null,
          workspace: null,
          browserTabs: null,
          terminalPanel: null,
          overlays: null
        }}
        notificationTopbar={{
          labels: {
            openCenter: "Open notification center",
            openPreview: "Open notification preview"
          },
          notificationCount: 0,
          unreadCount: 0,
          preview: null,
          onOpenCenter: vi.fn(),
          onOpenPreview: vi.fn()
        }}
        aiLaunch={{
          logoUrl: "",
          prefix: "AI",
          verbs: ["Chat"]
        }}
        onRootDragStartCapture={vi.fn()}
      />
    );

    const notificationButton = screen.getByRole("button", {
      name: "Open notification center"
    });
    const historyButton = screen.getByRole("button", { name: "Open Agent History" });
    expect(screen.queryByRole("button", { name: "Open Login Manager" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open docs" })).toBeNull();
    expect(
      notificationButton.compareDocumentPosition(historyButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(historyButton);
    expect(actions.openAgentSessionHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open Software Store" }));
    expect(actions.openSoftwareStore).toHaveBeenCalledTimes(1);
  });
});
