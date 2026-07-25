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
      container.querySelector(".lyra-workspace-surface-keepalive:not([style])")
    ).toHaveTextContent("Settings surface");
  });
});
