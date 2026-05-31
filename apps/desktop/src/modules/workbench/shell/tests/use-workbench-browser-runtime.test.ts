import { describe, expect, test } from "vitest";

import type {
  WorkbenchBrowserPageRuntimeState
} from "../../../../shared/desktop-bridge";
import type { WorkspaceTab, WorkspaceVisibleLayout } from "../../workspace-tabs";
import { browserAgentVisualStateLabel } from "../agent-browser-activity-overlay";
import {
  arePageRuntimeStatesEquivalentForTests,
  resolveBrowserAgentCursorViewportPoint,
  resolveVisibleBrowserPageDescriptors
} from "../use-workbench-browser-runtime";

const createPageTab = (id: string): WorkspaceTab => ({
  id,
  title: id,
  pageKind: "page",
  inputValue: `https://example.com/${id}`,
  displayAddress: `https://example.com/${id}`,
  faviconUrl: undefined,
  query: undefined
});

const createSearchTab = (id: string): WorkspaceTab => ({
  id,
  title: id,
  pageKind: "search",
  inputValue: "",
  displayAddress: "",
  faviconUrl: undefined,
  query: undefined
});

const createRuntimeState = (
  overrides: Partial<WorkbenchBrowserPageRuntimeState> = {}
): WorkbenchBrowserPageRuntimeState => ({
  tabId: "page-1",
  address: "https://example.com",
  title: "Example",
  isActive: true,
  isVisible: true,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  isHtmlFullscreen: false,
  updatedAt: 100,
  ...overrides
});

describe("resolveVisibleBrowserPageDescriptors", () => {
  test("keeps only visible browser pages and marks the focused split pane", () => {
    const tabs = [
      createPageTab("page-1"),
      createSearchTab("search-1"),
      createPageTab("page-2")
    ];
    const layout: WorkspaceVisibleLayout = {
      mode: "split",
      activeTabId: "page-1",
      visibleTabIds: ["page-1", "search-1", "page-2"],
      splitGroupTabIds: ["page-1", "page-2"],
      focusedSplitTabId: "page-2"
    };

    expect(resolveVisibleBrowserPageDescriptors(tabs, layout)).toEqual([
      {
        tabId: "page-1",
        zIndex: 0,
        isFocusedPane: false
      },
      {
        tabId: "page-2",
        zIndex: 2,
        isFocusedPane: true
      }
    ]);
  });
});

describe("arePageRuntimeStatesEquivalentForTests", () => {
  test("ignores timestamp-only changes", () => {
    expect(
      arePageRuntimeStatesEquivalentForTests(
        createRuntimeState({ updatedAt: 100 }),
        createRuntimeState({ updatedAt: 200 })
      )
    ).toBe(true);
  });

  test("detects navigation state changes", () => {
    expect(
      arePageRuntimeStatesEquivalentForTests(
        createRuntimeState({ canGoBack: false }),
        createRuntimeState({ canGoBack: true })
      )
    ).toBe(false);
  });
});

describe("resolveBrowserAgentCursorViewportPoint", () => {
  test("maps page-relative Agent cursor points into viewport coordinates", () => {
    expect(
      resolveBrowserAgentCursorViewportPoint(
        { left: 120, top: 80, width: 640, height: 360 },
        { x: 32, y: 44 }
      )
    ).toEqual({ x: 152, y: 124 });
  });

  test("does not render a cursor when the page host is unavailable", () => {
    expect(
      resolveBrowserAgentCursorViewportPoint(
        { left: 120, top: 80, width: 0, height: 360 },
        { x: 32, y: 44 }
      )
    ).toBeNull();
  });
});

describe("browserAgentVisualStateLabel", () => {
  test("names visible Agent activity states for hover click typing focus and wait", () => {
    expect(browserAgentVisualStateLabel({ action: "act", interaction: "hover" })).toBe("Hover");
    expect(browserAgentVisualStateLabel({ action: "act", interaction: "click" })).toBe("Click");
    expect(browserAgentVisualStateLabel({ action: "type", interaction: null })).toBe("Typing");
    expect(browserAgentVisualStateLabel({ action: "focus", interaction: null })).toBe("Focus");
    expect(browserAgentVisualStateLabel({ action: "wait", interaction: null })).toBe("Wait");
  });
});
