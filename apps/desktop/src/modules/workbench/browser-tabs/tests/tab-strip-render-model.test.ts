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

const baseInput = {
  splitGroupTabIds: [] as readonly string[],
  closeTabLabel: "Close",
  isTerminalDropActive: false,
  dropIndicatorX: null as number | null,
  isSplitDropActive: false,
  splitDropTargetTabId: null as string | null,
  workspaceDragTabId: null as string | null,
  rightDragPreview: null
};

describe("browser tab strip render model", () => {
  test("marks the active tab and shows close when more than one tab is open", () => {
    const model = createBrowserTabStripRenderModel({
      ...baseInput,
      tabs: [
        createTab("home", "Home", "search"),
        createTab("docs", "Docs")
      ],
      activeTabId: "home"
    });

    expect(model.stripClassName).toContain("lyra-tab-strip");
    expect(model.stripClassName).not.toContain("lyra-browser-tab-strip-stacked");
    expect(model.stripClassName).not.toContain("lyra-browser-tab-strip-density");
    expect(model.tabs[0]?.tabClassName).toContain("lyra-tab-item-active");
    expect(model.tabs[0]?.tabClassName).toContain("lyra-browser-tab-item-active");
    expect(model.tabs[0]?.showClose).toBe(true);
    expect(model.tabs[1]?.showClose).toBe(true);
    expect(model.tabs[1]?.closeLabel).toBe("Close-Docs");
  });

  test("hides close on the last remaining tab", () => {
    const model = createBrowserTabStripRenderModel({
      ...baseInput,
      tabs: [createTab("home", "Home", "search")],
      activeTabId: "home"
    });

    expect(model.tabs[0]?.showClose).toBe(false);
  });

  test("marks split group classes and active split focus", () => {
    const model = createBrowserTabStripRenderModel({
      ...baseInput,
      tabs: [
        createTab("a", "A"),
        createTab("b", "B"),
        createTab("c", "C")
      ],
      activeTabId: "b",
      splitGroupTabIds: ["b", "c"]
    });

    expect(model.tabs[1]?.tabClassName).toContain("lyra-browser-tab-item-split-group-active");
    expect(model.tabs[1]?.tabClassName).toContain("lyra-browser-tab-item-split-joined-next");
    expect(model.tabs[1]?.tabClassName).toContain("lyra-tab-item-active");
    expect(model.tabs[1]?.tabMainClassName).toContain("lyra-browser-tab-main-split-focused");
    expect(model.tabs[2]?.tabClassName).toContain("lyra-browser-tab-item-split-group-active");
    expect(model.tabs[2]?.tabClassName).not.toContain("lyra-tab-item-active");
    expect(model.tabs[2]?.tabMainClassName).not.toContain("lyra-browser-tab-main-split-focused");
  });

  test("marks close lock width on the strip", () => {
    const model = createBrowserTabStripRenderModel({
      ...baseInput,
      tabs: [
        createTab("a", "A"),
        createTab("b", "B")
      ],
      activeTabId: "a",
      closeLockedTabWidth: 88.4
    });

    expect(model.stripClassName).toContain("lyra-tab-strip-close-lock");
    expect(model.navStyle).toEqual({
      "--lyra-browser-tab-close-lock-w": "88px"
    });
  });

  test("models drop and right-drag preview presentation", () => {
    const model = createBrowserTabStripRenderModel({
      ...baseInput,
      tabs: [
        createTab("a", "A"),
        createTab("b", "B")
      ],
      activeTabId: "a",
      splitGroupTabIds: ["a", "b"],
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
      }
    });
  });

  test("clips overflowing tabs instead of widening the strip into a scroller", () => {
    const model = createBrowserTabStripRenderModel({
      ...baseInput,
      tabs: [
        createTab("a", "A"),
        createTab("b", "Very long page title")
      ],
      activeTabId: "a",
      layout: {
        density: "regular",
        contentWidth: 180,
        totalTabsWidth: 260,
        addButtonX: 180,
        items: [
          { width: 90, x: 0, contentWidth: 72 },
          { width: 170, x: 90, contentWidth: 152 }
        ]
      }
    });

    expect(model.listSpacerStyle).toEqual({ width: "180px" });
  });
});
