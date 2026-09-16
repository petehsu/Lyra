import { describe, expect, test, vi } from "vitest";
import type { LyraAppModule } from "@lyra/app-runtime";

import type { WorkspaceTab } from "../../workspace-tabs";
import { registerWorkspaceAppModule } from "../../workspace-apps/registry";
import { createAppSurfaceRenderModel } from "../workspace-app-surface-models";
import type { WorkspaceSurfaceRenderContext } from "../workspace-surface-types";

const notificationTab = (
  overrides: Partial<WorkspaceTab> = {}
): WorkspaceTab => ({
  id: "notifications-surface",
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
  appOpaqueState: {},
  ...overrides
});

const softwareStoreContext = {
  tabsModel: { openAppTab: vi.fn() },
  softwareStore: {
    labels: {
      moduleUnavailableDescription: "This module is unavailable.",
      moduleStartFailed: "This module failed to start.",
      repairModule: "Repair module",
      tabTitle: "Lyra Software"
    }
  }
} as unknown as WorkspaceSurfaceRenderContext;

describe("createAppSurfaceRenderModel", () => {
  test("keeps a known app repairable when its exact saved module version is unavailable", () => {
    expect(createAppSurfaceRenderModel({
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
    }, softwareStoreContext)).toMatchObject({
      kind: "unavailableApp",
      appId: "image-viewer",
      appVersion: "9.0.0"
    });
  });

  test("keeps a missing Notifications version repairable instead of silently changing its pin", () => {
    expect(createAppSurfaceRenderModel(
      notificationTab({
        id: "notifications-missing-version",
        appVersion: "9.0.0",
        appOpaqueState: { selectedNotificationId: "notice-1" }
      }),
      softwareStoreContext
    )).toMatchObject({
      kind: "unavailableApp",
      appId: "notification-center",
      appVersion: "9.0.0",
      repairLabel: "Repair module"
    });
  });

  test("shows the generic unavailable surface when Notifications has no mountable module", async () => {
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
    try {
      expect(createAppSurfaceRenderModel(
        notificationTab({ id: "notifications-missing-surface" }),
        softwareStoreContext
      )).toMatchObject({
        kind: "unavailableApp",
        appId: "notification-center",
        appVersion: "1.0.0",
        repairLabel: "Repair module"
      });
    } finally {
      await unregister();
    }
  });

  test("routes Notification Center to the independent surface when the module can mount", async () => {
    const surfaceModule: LyraAppModule = {
      id: "lyra.notifications",
      version: "1.0.0",
      activate: () => undefined,
      create: ({ instanceId }) => ({ instanceId }),
      restore: ({ instanceId }) => ({ instanceId }),
      snapshot: () => ({}),
      mount: () => undefined,
      unmount: () => undefined,
      close: () => undefined,
      deactivate: () => undefined
    };
    const unregister = registerWorkspaceAppModule(surfaceModule, { replaceFallback: true });
    try {
      expect(createAppSurfaceRenderModel(
        notificationTab({ id: "notifications-dynamic-surface" }),
        softwareStoreContext
      )).toMatchObject({
        kind: "dynamicApp",
        instanceId: "notification-center",
        title: "Notifications"
      });
    } finally {
      await unregister();
    }
  });
});
