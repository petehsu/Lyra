import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { FileEditorModel } from "../../file-editor";
import type { FileManagerModel } from "../../file-manager";
import type {
  WorkbenchNotificationItem,
  WorkbenchNotificationModel
} from "../../notifications";
import type { WorkspaceTabsModel } from "../../workspace-tabs";
import { useWorkbenchNotificationNavigation } from "../use-workbench-notification-navigation";

const t = (key: string): string => key;

const createNotification = (
  overrides: Partial<WorkbenchNotificationItem>
): WorkbenchNotificationItem => ({
  id: "notification-1",
  title: "Notice",
  preview: "Preview",
  level: "info",
  source: {
    id: "source-1",
    title: "Source",
    iconKey: "system"
  },
  target: {
    kind: "none"
  },
  createdAt: 1000,
  ...overrides
});

const createNotificationModel = (
  notification: WorkbenchNotificationItem | null
): WorkbenchNotificationModel => ({
  notifications: notification === null ? [] : [notification],
  unreadCount: notification === null ? 0 : 1,
  selectedNotificationId: null,
  selectedNotification: null,
  topbarPreviewNotificationId: notification?.id ?? null,
  topbarPreview: notification,
  publishNotification: vi.fn() as never,
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  clearNotifications: vi.fn(),
  selectNotification: vi.fn(),
  acknowledgeTopbarPreview: vi.fn(),
  getNotification: vi.fn((notificationId: string) =>
    notification?.id === notificationId ? notification : null
  )
});

describe("useWorkbenchNotificationNavigation", () => {
  test("does not open the notification center when there are no notifications and closes stale center tabs", () => {
    const notificationModel = createNotificationModel(null);
    const tabsModel = {
      tabs: [
        {
          id: "notification-center-tab",
          pageKind: "app",
          appId: "notification-center",
          appInstanceId: "notification-center"
        }
      ],
      closeTab: vi.fn(),
      openAppTab: vi.fn(),
      setActiveTab: vi.fn()
    } as unknown as WorkspaceTabsModel;
    const { result } = renderHook(() =>
      useWorkbenchNotificationNavigation({
        tabsModel,
        fileManagerModel: {} as FileManagerModel,
        fileEditorModel: {} as FileEditorModel,
        notificationModel,
        openDialog: vi.fn(),
        t: t as never
      })
    );

    result.current.onOpenNotificationCenter();

    expect(notificationModel.acknowledgeTopbarPreview).toHaveBeenCalled();
    expect(tabsModel.openAppTab).not.toHaveBeenCalled();
    expect(tabsModel.setActiveTab).not.toHaveBeenCalled();
    expect(tabsModel.closeTab).toHaveBeenCalledWith("notification-center-tab");
  });

  test("opens page-tab notification previews and marks them read", () => {
    const notification = createNotification({
      target: {
        kind: "page-tab",
        address: "https://example.com",
        title: "Example"
      }
    });
    const notificationModel = createNotificationModel(notification);
    const tabsModel = {
      tabs: [],
      openPageInNewTab: vi.fn(),
      openAppTab: vi.fn(),
      setActiveTab: vi.fn()
    } as unknown as WorkspaceTabsModel;
    const { result } = renderHook(() =>
      useWorkbenchNotificationNavigation({
        tabsModel,
        fileManagerModel: {} as FileManagerModel,
        fileEditorModel: {} as FileEditorModel,
        notificationModel,
        openDialog: vi.fn(),
        t: t as never
      })
    );

    result.current.onOpenNotificationPreview();

    expect(notificationModel.markNotificationRead).toHaveBeenCalledWith("notification-1");
    expect(notificationModel.acknowledgeTopbarPreview).toHaveBeenCalled();
    expect(tabsModel.openPageInNewTab).toHaveBeenCalledWith("https://example.com", "Example");
  });

  test("opens an Editor source from the canonical notification without dropping session or dirty metadata", () => {
    const notification = createNotification({
      source: {
        id: "agent-edit",
        title: "Agent edit",
        iconKey: "file-editor"
      },
      target: {
        kind: "app-tab",
        appId: "file-editor",
        appInstanceId: "editor-notification-1",
        filePath: "/project/src/index.ts",
        fileSessionId: "file-session-9",
        isDirty: true
      }
    });
    const notificationModel = createNotificationModel(notification);
    const tabsModel = {
      tabs: [],
      openAppTab: vi.fn(),
      setActiveTab: vi.fn()
    } as unknown as WorkspaceTabsModel;
    const fileEditorModel = {
      ensureInstance: vi.fn(),
      openFile: vi.fn(async () => undefined)
    } as unknown as FileEditorModel;
    const { result } = renderHook(() =>
      useWorkbenchNotificationNavigation({
        tabsModel,
        fileManagerModel: {} as FileManagerModel,
        fileEditorModel,
        notificationModel,
        openDialog: vi.fn(),
        t: t as never
      })
    );

    result.current.onOpenNotificationSource(notification.id);

    expect(notificationModel.getNotification).toHaveBeenCalledWith(notification.id);
    expect(notificationModel.markNotificationRead).toHaveBeenCalledWith(notification.id);
    expect(tabsModel.openAppTab).toHaveBeenCalledWith({
      appId: "file-editor",
      appInstanceId: "editor-notification-1",
      title: "Agent edit",
      iconKey: "file-editor-code",
      filePath: "/project/src/index.ts",
      fileSessionId: "file-session-9",
      isDirty: true
    });
    expect(fileEditorModel.ensureInstance).toHaveBeenCalledWith(
      "editor-notification-1",
      {
        filePath: "/project/src/index.ts",
        fileSessionId: "file-session-9"
      }
    );
    expect(fileEditorModel.openFile).toHaveBeenCalledWith(
      "editor-notification-1",
      "/project/src/index.ts"
    );
  });

  test("shows a clear-all confirmation dialog", () => {
    const notificationModel = createNotificationModel(null);
    const openDialog = vi.fn();
    const { result } = renderHook(() =>
      useWorkbenchNotificationNavigation({
        tabsModel: { tabs: [] } as unknown as WorkspaceTabsModel,
        fileManagerModel: {} as FileManagerModel,
        fileEditorModel: {} as FileEditorModel,
        notificationModel,
        openDialog,
        t: t as never
      })
    );

    result.current.onRequestClearNotifications();

    expect(openDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "notification.centerClearConfirmTitle",
        actions: expect.arrayContaining([
          expect.objectContaining({
            id: "notification-clear-confirm",
            tone: "danger",
            onSelect: notificationModel.clearNotifications
          })
        ])
      })
    );
  });
});
