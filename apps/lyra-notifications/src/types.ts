import type { NotificationSourceIconKey } from "./icons";

export type NotificationTarget =
  | { readonly kind: "none" }
  | { readonly kind: "page-tab"; readonly address: string; readonly title?: string }
  | {
      readonly kind: "app-tab";
      readonly appId: string;
      readonly appInstanceId: string;
      readonly title?: string;
      readonly iconKey?: string;
      readonly filePath?: string;
    };

export type NotificationBodyKind = "plain" | "markdown" | "image" | "page";

export type NotificationItem = {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly body?: string;
  readonly bodyKind?: NotificationBodyKind;
  readonly imageUrl?: string;
  readonly level: "info" | "success" | "warning" | "error";
  readonly sourceTitle: string;
  readonly sourceIconKey: NotificationSourceIconKey;
  readonly target: NotificationTarget;
  readonly createdAt: number;
  readonly readAt?: number;
};

export type NotificationCenterLabels = {
  readonly title: string;
  readonly listTitle: string;
  readonly emptyTitle: string;
  readonly openSource: string;
  readonly openPage: string;
  readonly sourceFallback: string;
  readonly retry: string;
};

export type NotificationSnapshot = {
  readonly notifications: readonly NotificationItem[];
  readonly selectedNotificationId: string | null;
  readonly unreadCount: number;
};
