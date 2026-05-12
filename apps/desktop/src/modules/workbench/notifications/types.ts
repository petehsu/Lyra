import type { WorkspaceAppIconKey } from "../workspace-apps";

export type NotificationCenterAppId = "notification-center";
export type NotificationCenterAppIconKey = "notification-center-default";

export type WorkbenchNotificationLevel = "info" | "success" | "warning" | "error";

export type WorkbenchNotificationSourceIconKey =
  | "file-manager"
  | "file-editor"
  | "browser"
  | "terminal"
  | "system"
  | "notification";

export type WorkbenchNotificationSource = {
  readonly id: string;
  readonly title: string;
  readonly iconKey: WorkbenchNotificationSourceIconKey;
};

export type WorkbenchNotificationTarget =
  | {
      readonly kind: "none";
    }
  | {
      readonly kind: "page-tab";
      readonly address: string;
      readonly title?: string;
    }
  | {
      readonly kind: "app-tab";
      readonly appId:
        | "file-manager"
        | "file-editor"
        | "image-viewer"
        | "resource-monitor"
        | NotificationCenterAppId;
      readonly appInstanceId: string;
      readonly title?: string;
      readonly iconKey?: WorkspaceAppIconKey;
      readonly filePath?: string;
      readonly fileSessionId?: string;
      readonly isDirty?: boolean;
    };

export type WorkbenchNotificationItem = {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly body?: string;
  readonly level: WorkbenchNotificationLevel;
  readonly source: WorkbenchNotificationSource;
  readonly target: WorkbenchNotificationTarget;
  readonly createdAt: number;
  readonly readAt?: number;
};

export type WorkbenchNotificationPublishRequest = Omit<
  WorkbenchNotificationItem,
  "id" | "createdAt"
> & {
  readonly id?: string;
  readonly createdAt?: number;
  readonly previewBehavior?: "show" | "silent";
};

export type WorkbenchNotificationSnapshot = {
  readonly version: 1;
  readonly notifications: readonly WorkbenchNotificationItem[];
  readonly selectedNotificationId: string | null;
};

export type WorkbenchNotificationModel = {
  readonly notifications: readonly WorkbenchNotificationItem[];
  readonly unreadCount: number;
  readonly selectedNotificationId: string | null;
  readonly selectedNotification: WorkbenchNotificationItem | null;
  readonly topbarPreviewNotificationId: string | null;
  readonly topbarPreview: WorkbenchNotificationItem | null;
  readonly publishNotification: (
    request: WorkbenchNotificationPublishRequest
  ) => WorkbenchNotificationItem;
  readonly markNotificationRead: (notificationId: string) => void;
  readonly markAllNotificationsRead: () => void;
  readonly clearNotifications: () => void;
  readonly selectNotification: (notificationId: string) => void;
  readonly acknowledgeTopbarPreview: () => void;
  readonly getNotification: (notificationId: string) => WorkbenchNotificationItem | null;
};

export type NotificationCenterLabels = {
  readonly title: string;
  readonly listTitle: string;
  readonly markAllRead: string;
  readonly clearAll: string;
  readonly openSource: string;
  readonly sourceFallback: string;
  readonly unread: string;
};

export type NotificationTopbarLabels = {
  readonly openCenter: string;
  readonly openPreview: string;
};
