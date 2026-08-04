import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { LyraAppModule } from "@lyra/app-runtime";

import type { WorkspaceTab, WorkspaceTabsModel } from "../../workspace-tabs";
import type { WorkbenchSurfaceAdapters } from "../../ui-platform/surface-types";
import { registerWorkspaceAppModule } from "../../workspace-apps";
import {
  WorkspaceSurfaceRouter,
  type WorkspaceSurfaceRouterProps
} from "../workspace-surface-router";
import { createAppSurfaceRenderModel } from "../workspace-app-surface-models";
import type { WorkspaceSurfaceRenderContext } from "../workspace-surface-types";

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

  test("keeps a known app repairable when its exact saved module version is unavailable", () => {
    const tab: WorkspaceTab = {
      id: "image-viewer-missing-version",
      title: "Saved image",
      pageKind: "app",
      inputValue: "",
      displayAddress: "lyra://app/image-viewer/saved-image",
      faviconUrl: undefined,
      query: undefined,
      appId: "image-viewer",
      appVersion: "9.0.0",
      appInstanceId: "saved-image",
      appIconKey: "image-viewer-default",
      appRoute: "/saved",
      appOpaqueState: { filePath: "/tmp/saved.png" }
    };

    expect(createAppSurfaceRenderModel(tab, {
      tabsModel: { openAppTab: vi.fn() },
      softwareStore: {
        labels: {
          moduleUnavailableDescription: "This module is unavailable.",
          repairModule: "Repair module",
          tabTitle: "Lyra Software"
        }
      }
    } as unknown as WorkspaceSurfaceRenderContext)).toMatchObject({
      kind: "unavailableApp",
      appId: "image-viewer",
      appVersion: "9.0.0"
    });
  });

  test("keeps a missing Notifications version repairable instead of silently changing its pin", () => {
    const tab: WorkspaceTab = {
      id: "notifications-missing-version",
      title: "Notifications",
      pageKind: "app",
      inputValue: "",
      displayAddress: "lyra://app/notification-center/notification-center",
      faviconUrl: undefined,
      query: undefined,
      appId: "notification-center",
      appVersion: "9.0.0",
      appInstanceId: "notification-center",
      appIconKey: "notification-center-default",
      appRoute: "/",
      appOpaqueState: { selectedNotificationId: "notice-1" }
    };

    expect(createAppSurfaceRenderModel(tab, {
      tabsModel: { openAppTab: vi.fn() },
      softwareStore: {
        labels: {
          moduleUnavailableDescription: "This module is unavailable.",
          repairModule: "Repair module",
          tabTitle: "Lyra Software"
        }
      }
    } as unknown as WorkspaceSurfaceRenderContext)).toMatchObject({
      kind: "unavailableApp",
      appId: "notification-center",
      appVersion: "9.0.0",
      repairLabel: "Repair module"
    });
  });

  test("retains the static Notification Center when the installed module has no compatible surface", async () => {
    const incompatibleModule: LyraAppModule = {
      id: "lyra.notifications",
      version: "1.0.0",
      activate: () => undefined,
      create: ({ instanceId }) => ({ instanceId }),
      restore: ({ instanceId }) => ({ instanceId }),
      snapshot: () => ({}),
      close: () => undefined,
      deactivate: () => undefined
    };
    const unregister = registerWorkspaceAppModule(incompatibleModule, { replaceFallback: true });
    const tab: WorkspaceTab = {
      id: "notifications-static-safety",
      title: "Notifications",
      pageKind: "app",
      inputValue: "",
      displayAddress: "lyra://app/notification-center/notification-center",
      faviconUrl: undefined,
      query: undefined,
      appId: "notification-center",
      appVersion: "1.0.0",
      appInstanceId: "notification-center",
      appIconKey: "notification-center-default",
      appRoute: "/",
      appOpaqueState: {}
    };
    try {
      expect(createAppSurfaceRenderModel(tab, {
        tabsModel: { openAppTab: vi.fn() },
        notifications: {
          labels: {},
          model: {
            notifications: [],
            selectedNotificationId: null
          },
          onRequestClearAll: vi.fn(),
          onOpenNotificationSource: vi.fn()
        },
        softwareStore: { labels: {} }
      } as unknown as WorkspaceSurfaceRenderContext)).toMatchObject({
        kind: "notificationCenter"
      });
    } finally {
      await unregister();
    }
  });
});
