import { describe, expect, test, vi } from "vitest";

import {
  createWorkbenchShellLayoutActions,
  createWorkbenchShellLayoutState
} from "../use-workbench-shell-adapter-props";
import type { PanelLayoutModel } from "../use-panel-layout";

const createPanelLayoutModel = (): PanelLayoutModel => ({
  aiPanelSide: "right",
  terminalPanelSide: "top",
  isLeftPanelVisible: true,
  isBottomPanelVisible: false,
  leftWidth: 320,
  bottomHeight: 260,
  appSidebarWidth: 220,
  cssVars: {
    "--left-width": "320px",
    "--left-panel-content-width": "320px",
    "--left-panel-mobile-height": "220px",
    "--left-panel-content-mobile-height": "220px",
    "--bottom-height": "260px",
    "--bottom-panel-content-height": "260px",
    "--lyra-app-sidebar-rail-w": "220px"
  },
  toggleLeftPanel: vi.fn(),
  toggleBottomPanel: vi.fn(),
  toggleAiPanelSide: vi.fn(),
  toggleTerminalPanelSide: vi.fn(),
  onLeftResizeMouseDown: vi.fn(),
  onBottomResizeMouseDown: vi.fn()
});

describe("workbench shell adapter props helpers", () => {
  test("extracts the shell layout state from the panel layout model", () => {
    expect(createWorkbenchShellLayoutState(createPanelLayoutModel())).toEqual({
      aiPanelSide: "right",
      terminalPanelSide: "top",
      isLeftPanelVisible: true,
      isBottomPanelVisible: false
    });
  });

  test("keeps resize actions stable as adapter actions", () => {
    const panelLayoutModel = createPanelLayoutModel();

    expect(createWorkbenchShellLayoutActions(panelLayoutModel)).toEqual({
      onLeftResizeMouseDown: panelLayoutModel.onLeftResizeMouseDown,
      onBottomResizeMouseDown: panelLayoutModel.onBottomResizeMouseDown
    });
  });
});
