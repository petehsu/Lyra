import { useState } from "react";
import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { WorkspaceTab, WorkspaceTabsModel } from "../../workspace-tabs";
import type { WorkbenchSurfaceAdapters } from "../../ui-platform/surface-types";
import {
  WorkspaceSurfaceRouter,
  type WorkspaceSurfaceRouterProps
} from "../workspace-surface-router";

const tabs: readonly WorkspaceTab[] = [
  {
    id: "settings-1",
    title: "Settings one",
    pageKind: "settings",
    inputValue: "",
    displayAddress: "lyra://settings/one",
    faviconUrl: undefined,
    query: undefined
  },
  {
    id: "settings-2",
    title: "Settings two",
    pageKind: "settings",
    inputValue: "",
    displayAddress: "lyra://settings/two",
    faviconUrl: undefined,
    query: undefined
  }
];

const createTabsModel = (activeTabId: string): WorkspaceTabsModel => ({
  tabs,
  activeTabId,
  activeTab: tabs.find((tab) => tab.id === activeTabId),
  splitGroupTabIds: [],
  focusedSplitTabId: null,
  getVisibleWorkspaceLayout: () => ({
    mode: "single",
    activeTabId,
    visibleTabIds: [activeTabId],
    splitGroupTabIds: [],
    focusedSplitTabId: null
  }),
  setActiveTab: vi.fn()
} as unknown as WorkspaceTabsModel);

const surfaceAdapters = {
  settings: () => <div>Settings surface</div>
} as unknown as WorkbenchSurfaceAdapters;

const createProps = (activeTabId: string): WorkspaceSurfaceRouterProps => ({
  surfaceAdapters,
  activeTab: tabs.find((tab) => tab.id === activeTabId),
  tabsModel: createTabsModel(activeTabId),
  splitThreePaneLayout: "adaptive",
  settings: {}
} as unknown as WorkspaceSurfaceRouterProps);

describe("WorkspaceSurfaceRouter", () => {
  test("renders an existing restored tab when only the active tab changes", () => {
    const { container, rerender } = render(
      <WorkspaceSurfaceRouter {...createProps("settings-1")} />
    );

    rerender(<WorkspaceSurfaceRouter {...createProps("settings-2")} />);

    const surfaces = container.querySelectorAll(".lyra-workspace-surface-keepalive");
    expect(surfaces).toHaveLength(2);
    expect(
      container.querySelector(".lyra-workspace-surface-keepalive:not([data-lyra-surface-hidden])")
    ).toHaveTextContent("Settings surface");
    expect(
      container.querySelector(".lyra-workspace-surface-keepalive[data-lyra-surface-hidden]")
    ).toHaveProperty("style.display", "");
  });

  test("always paints the active tab even when keepalive LRU is full", () => {
    const manyTabs: WorkspaceTab[] = Array.from({ length: 8 }, (_, index) => ({
      id: `settings-${index + 1}`,
      title: `Settings ${index + 1}`,
      pageKind: "settings",
      inputValue: "",
      displayAddress: `lyra://settings/${index + 1}`,
      faviconUrl: undefined,
      query: undefined
    }));
    const createManyTabsModel = (activeTabId: string): WorkspaceTabsModel => ({
      tabs: manyTabs,
      activeTabId,
      activeTab: manyTabs.find((tab) => tab.id === activeTabId),
      splitGroupTabIds: [],
      focusedSplitTabId: null,
      getVisibleWorkspaceLayout: () => ({
        mode: "single",
        activeTabId,
        visibleTabIds: [activeTabId],
        splitGroupTabIds: [],
        focusedSplitTabId: null
      }),
      setActiveTab: vi.fn()
    } as unknown as WorkspaceTabsModel);
    const createManyProps = (activeTabId: string): WorkspaceSurfaceRouterProps => ({
      surfaceAdapters,
      activeTab: manyTabs.find((tab) => tab.id === activeTabId),
      tabsModel: createManyTabsModel(activeTabId),
      splitThreePaneLayout: "adaptive",
      settings: {}
    } as unknown as WorkspaceSurfaceRouterProps);

    const { container, rerender } = render(
      <WorkspaceSurfaceRouter {...createManyProps("settings-1")} />
    );
    for (let index = 2; index <= 8; index += 1) {
      rerender(<WorkspaceSurfaceRouter {...createManyProps(`settings-${index}`)} />);
    }

    const visible = container.querySelector(
      ".lyra-workspace-surface-keepalive:not([data-lyra-surface-hidden])"
    );
    expect(visible).not.toBeNull();
    expect(visible).toHaveTextContent("Settings surface");
  });

  test("keeps a hidden tab's surface instance when the workspace tab is shown again", () => {
    let nextMark = 0;
    const rememberingAdapters = {
      settings: () => {
        const [mark] = useState(() => {
          nextMark += 1;
          return nextMark;
        });
        return <div data-surface-mark={mark}>Settings surface</div>;
      }
    } as unknown as WorkbenchSurfaceAdapters;
    const props = (activeTabId: string): WorkspaceSurfaceRouterProps => ({
      ...createProps(activeTabId),
      surfaceAdapters: rememberingAdapters
    });
    const { container, rerender } = render(
      <WorkspaceSurfaceRouter {...props("settings-1")} />
    );
    const markOf = (tabHidden: boolean): string | null => {
      const slot = [...container.querySelectorAll(".lyra-workspace-surface-keepalive")].find((node) => {
        const hidden = node.getAttribute("data-lyra-surface-hidden") === "true";
        return hidden === tabHidden;
      });
      return slot?.querySelector("[data-surface-mark]")?.getAttribute("data-surface-mark") ?? null;
    };

    const firstMark = markOf(false);
    rerender(<WorkspaceSurfaceRouter {...props("settings-2")} />);
    rerender(<WorkspaceSurfaceRouter {...props("settings-1")} />);

    expect(markOf(false)).toBe(firstMark);
    expect(nextMark).toBe(2);
  });

  test("restores a hidden tab's scroll offset instead of a page index", () => {
    const rememberingAdapters = {
      settings: () => (
        <div data-scroller="">
          <span>Settings surface</span>
        </div>
      )
    } as unknown as WorkbenchSurfaceAdapters;
    const props = (activeTabId: string): WorkspaceSurfaceRouterProps => ({
      ...createProps(activeTabId),
      surfaceAdapters: rememberingAdapters
    });
    const { container, rerender } = render(
      <WorkspaceSurfaceRouter {...props("settings-1")} />
    );
    const scroller = container.querySelector("[data-scroller]") as HTMLElement;
    scroller.scrollTop = 180;
    rerender(<WorkspaceSurfaceRouter {...props("settings-2")} />);
    const hidden = container.querySelector(
      "[data-lyra-surface-hidden] [data-scroller]"
    ) as HTMLElement;
    hidden.scrollTop = 0;
    rerender(<WorkspaceSurfaceRouter {...props("settings-1")} />);
    expect((container.querySelector(
      ".lyra-workspace-surface-keepalive:not([data-lyra-surface-hidden]) [data-scroller]"
    ) as HTMLElement).scrollTop).toBe(180);
  });
});
