import { describe, expect, test, vi } from "vitest";
import type { LyraAppModule } from "@lyra/app-runtime";

import type { WorkspaceTab } from "../../workspace-tabs";
import { registerWorkspaceAppModule } from "../../workspace-apps/registry";
import { createAppSurfaceRenderModel } from "../workspace-app-surface-models";
import type { WorkspaceSurfaceRenderContext } from "../workspace-surface-types";

const loginManagerTab = (
  overrides: Partial<WorkspaceTab> = {}
): WorkspaceTab => ({
  id: "login-manager-surface",
  title: "Logins",
  pageKind: "app",
  inputValue: "",
  displayAddress: "lyra://app/login-manager/login-manager",
  faviconUrl: undefined,
  query: undefined,
  appId: "login-manager",
  appVersion: "1.0.0",
  appInstanceId: "login-manager",
  appIconKey: "login-manager-default",
  appRoute: "/",
  appOpaqueState: {},
  ...overrides
});

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

  test("shows the generic unavailable surface when Logins has no mountable module", () => {
    expect(createAppSurfaceRenderModel(
      loginManagerTab(),
      softwareStoreContext
    )).toMatchObject({
      kind: "unavailableApp",
      appId: "login-manager",
      appVersion: "1.0.0",
      repairLabel: "Repair module"
    });
  });

  test("routes a Logins tab to the independent surface when the module can mount", async () => {
    const surfaceModule: LyraAppModule = {
      id: "lyra.credentials",
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
        loginManagerTab({ id: "login-manager-dynamic-surface" }),
        softwareStoreContext
      )).toMatchObject({
        kind: "dynamicApp",
        instanceId: "login-manager",
        title: "Logins"
      });
    } finally {
      await unregister();
    }
  });

  test("shows the generic unavailable surface when Downloads has no mountable module", () => {
    expect(createAppSurfaceRenderModel(
      {
        id: "downloads-surface",
        title: "Downloads",
        pageKind: "app",
        inputValue: "",
        displayAddress: "lyra://app/downloads/downloads",
        faviconUrl: undefined,
        query: undefined,
        appId: "downloads",
        appVersion: "1.0.0",
        appInstanceId: "downloads",
        appIconKey: "downloads-default",
        appRoute: "/",
        appOpaqueState: {}
      },
      softwareStoreContext
    )).toMatchObject({
      kind: "unavailableApp",
      appId: "downloads",
      appVersion: "1.0.0",
      repairLabel: "Repair module"
    });
  });

  test("keeps the Core Files chooser surface when a directory picker is active", () => {
    const context = {
      ...softwareStoreContext,
      fileManagerModel: {
        getState: () => ({ instanceId: "fm-1" })
      },
      fileManagerLabels: {
        downloadManagerTitle: "Download Manager"
      },
      onOpenFileFromManager: vi.fn(),
      resolveFileManagerChooser: () => ({
        kind: "downloads-directory",
        confirmLabel: "Choose",
        promptLabel: "Choose a folder",
        selectPlaceholder: "Select",
        onConfirm: vi.fn()
      })
    } as unknown as WorkspaceSurfaceRenderContext;
    expect(createAppSurfaceRenderModel({
      id: "files-chooser",
      title: "Files",
      pageKind: "app",
      inputValue: "",
      displayAddress: "lyra://app/file-manager/fm-1",
      faviconUrl: undefined,
      query: undefined,
      appId: "file-manager",
      appVersion: "1.0.0",
      appInstanceId: "fm-1",
      appIconKey: "file-manager-default",
      appRoute: "/",
      appOpaqueState: {}
    }, context)).toMatchObject({
      kind: "fileManager"
    });
  });

  test("keeps the Core Files surface while Files remains a preview route", () => {
    const context = {
      ...softwareStoreContext,
      fileManagerModel: {
        getState: () => ({ instanceId: "fm-1" })
      },
      fileManagerLabels: {
        downloadManagerTitle: "Download Manager"
      },
      onOpenFileFromManager: vi.fn()
    } as unknown as WorkspaceSurfaceRenderContext;
    expect(createAppSurfaceRenderModel({
      id: "files-surface",
      title: "Files",
      pageKind: "app",
      inputValue: "",
      displayAddress: "lyra://app/file-manager/fm-1",
      faviconUrl: undefined,
      query: undefined,
      appId: "file-manager",
      appVersion: "1.0.0",
      appInstanceId: "fm-1",
      appIconKey: "file-manager-default",
      appRoute: "/",
      appOpaqueState: {}
    }, context)).toMatchObject({
      kind: "fileManager"
    });
  });

  test("keeps the first-party image viewer surface when instance state has not committed yet", () => {
    const context = {
      ...softwareStoreContext,
      imageViewerModel: { getState: () => null },
      imageViewerLabels: { loading: "Loading" },
      resolvedThemeId: "test",
      fileEditorModel: {},
      fileEditorLabels: {}
    } as unknown as WorkspaceSurfaceRenderContext;
    expect(createAppSurfaceRenderModel({
      id: "image-viewer-pending",
      title: "logo.svg",
      pageKind: "app",
      inputValue: "",
      displayAddress: "lyra://app/image-viewer/pending",
      faviconUrl: undefined,
      query: undefined,
      appId: "image-viewer",
      appVersion: "1.0.0",
      appInstanceId: "pending-image",
      appIconKey: "image-viewer-default",
      appRoute: "/",
      appOpaqueState: {},
      filePath: "/tmp/logo.svg"
    }, context)).toMatchObject({
      kind: "imageViewer",
      props: {
        state: {
          instanceId: "pending-image",
          filePath: "/tmp/logo.svg",
          status: "idle"
        }
      }
    });
  });
});
