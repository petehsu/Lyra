import { describe, expect, test } from "vitest";

import type { WorkspaceTab } from "../../workspace-tabs/types";
import { createBrowserTabStripRenderModel } from "../tab-strip-render-model";

const createTab = (
  id: string,
  title: string,
  pageKind: WorkspaceTab["pageKind"] = "page"
): WorkspaceTab => ({
  id,
  title,
  pageKind,
  inputValue: "",
  displayAddress: "",
  faviconUrl: undefined,
  query: undefined
});

describe("browser tab strip render model", () => {
  test("marks active and stacked collapsed tabs", () => {
    const model = createBrowserTabStripRenderModel({
      tabs: [
        createTab("home", "Home", "search"),
        createTab("docs", "Docs")
      ],
      activeTabId: "home",
      splitGroupTabIds: [],
      stackedMode: true,
      closeTabLabel: "Close",
      isTerminalDropActive: false,
      dropIndicatorX: null,
      isSplitDropActive: false,
      splitDropTargetTabId: null,
      workspaceDragTabId: null,
      rightDragPreview: null
    });

    expect(model.stripClassName).toContain("lyra-browser-tab-strip-stacked");
    expect(model.tabs[0]?.tabClassName).toContain("lyra-browser-tab-item-active");
    expect(model.tabs[0]?.isCollapsed).toBe(false);
    expect(model.tabs[1]?.tabClassName).toContain("lyra-browser-tab-item-collapsed");
    expect(model.tabs[1]?.tabMainClassName).toContain("lyra-browser-tab-main-collapsed");
    expect(model.tabs[1]?.closeLabel).toBe("Close-Docs");
  });

  test("marks split group classes and active split focus", () => {
    const model = createBrowserTabStripRenderModel({
      tabs: [
        createTab("a", "A"),
        createTab("b", "B"),
        createTab("c", "C")
      ],
      activeTabId: "b",
      splitGroupTabIds: ["b", "c"],
      stackedMode: false,
      closeTabLabel: "Close",
      isTerminalDropActive: false,
      dropIndicatorX: null,
      isSplitDropActive: false,
      splitDropTargetTabId: null,
      workspaceDragTabId: null,
      rightDragPreview: null
    });

    expect(model.tabs[1]?.tabClassName).toContain("lyra-browser-tab-item-split-group-active");
    expect(model.tabs[1]?.tabClassName).toContain("lyra-browser-tab-item-split-joined-next");
    expect(model.tabs[1]?.tabMainClassName).toContain("lyra-browser-tab-main-split-focused");
    expect(model.tabs[2]?.tabClassName).toContain("lyra-browser-tab-item-split-group-active");
  });

  test("marks responsive density on the strip", () => {
    const model = createBrowserTabStripRenderModel({
      tabs: [
        createTab("a", "A"),
        createTab("b", "B")
      ],
      activeTabId: "a",
      splitGroupTabIds: [],
      stackedMode: false,
      closeTabLabel: "Close",
      isTerminalDropActive: false,
      dropIndicatorX: null,
      isSplitDropActive: false,
      splitDropTargetTabId: null,
      workspaceDragTabId: null,
      rightDragPreview: null,
      density: "smaller"
    });

    expect(model.stripClassName).toContain("lyra-browser-tab-strip-density-smaller");
  });

  test("marks close lock width on the strip", () => {
    const model = createBrowserTabStripRenderModel({
      tabs: [
        createTab("a", "A"),
        createTab("b", "B")
      ],
      activeTabId: "a",
      splitGroupTabIds: [],
      stackedMode: false,
      closeTabLabel: "Close",
      isTerminalDropActive: false,
      dropIndicatorX: null,
      isSplitDropActive: false,
      splitDropTargetTabId: null,
      workspaceDragTabId: null,
      rightDragPreview: null,
      closeLockedTabWidth: 88.4
    });

    expect(model.stripClassName).toContain("lyra-browser-tab-strip-close-lock");
    expect(model.navStyle).toEqual({
      "--lyra-browser-tab-close-lock-w": "88px"
    });
  });

  test("models drop and right-drag preview presentation", () => {
    const model = createBrowserTabStripRenderModel({
      tabs: [
        createTab("a", "A"),
        createTab("b", "B")
      ],
      activeTabId: "a",
      splitGroupTabIds: ["a", "b"],
      stackedMode: false,
      closeTabLabel: "Close",
      isTerminalDropActive: true,
      dropIndicatorX: 42,
      isSplitDropActive: true,
      splitDropTargetTabId: "b",
      workspaceDragTabId: "a",
      rightDragPreview: {
        tabId: "a",
        x: 100,
        y: 200,
        tabClassName: "lyra-browser-tab-item",
        tabMainClassName: "lyra-browser-tab-main",
        isCollapsed: false,
        width: 155.6
      }
    });

    expect(model.navClassName).toContain("lyra-browser-tabs-terminal-drop-target");
    expect(model.navClassName).toContain("lyra-browser-tabs-reorder-active");
    expect(model.navClassName).toContain("lyra-browser-tabs-split-drop-active");
    expect(model.navStyle).toEqual({ "--lyra-browser-drop-indicator-x": "42px" });
    expect(model.tabs[0]?.tabClassName).toContain("lyra-browser-tab-item-dragging");
    expect(model.tabs[0]?.tabClassName).toContain("lyra-browser-tab-item-split-group-dragging");
    expect(model.tabs[1]?.tabClassName).toContain("lyra-browser-tab-item-split-target");
    expect(model.preview).toMatchObject({
      tab: expect.objectContaining({ id: "a" }),
      shellStyle: { transform: "translate(114px, 210px)" },
      tabStyle: {
        width: "156px",
        minWidth: "156px",
        maxWidth: "156px"
      },
      isCollapsed: false
    });
  });
});
