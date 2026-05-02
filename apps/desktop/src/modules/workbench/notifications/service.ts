import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import type { WorkbenchAppId, WorkspaceAppIconKey } from "../workspace-apps";
import type {
  NotificationCenterAppId,
  NotificationCenterAppIconKey,
  WorkbenchNotificationItem,
  WorkbenchNotificationModel,
  WorkbenchNotificationPublishRequest,
  WorkbenchNotificationSnapshot
} from "./types";

const WORKBENCH_STATE_KEY = "notifications" as const;
const SNAPSHOT_VERSION = 1;
const MAX_NOTIFICATION_COUNT = 200;
const TOPBAR_PREVIEW_TIMEOUT_MS = 5000;

const createNotificationId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `notification-${crypto.randomUUID()}`;
  }
  return `notification-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
};

type RuntimeState = {
  readonly notifications: readonly WorkbenchNotificationItem[];
  readonly selectedNotificationId: string | null;
  readonly topbarPreviewNotificationId: string | null;
};

const CLOSED_STATE: RuntimeState = {
  notifications: [],
  selectedNotificationId: null,
  topbarPreviewNotificationId: null
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const sanitizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const APP_IDS = new Set<WorkbenchAppId>([
  "file-manager",
  "file-editor",
  "image-viewer",
  "resource-monitor",
  "ai-history",
  "ai-mcp",
  "ai-plan-review",
  "ai-skills",
  "ai-plugins",
  "notification-center"
]);

const APP_ICON_KEYS = new Set<WorkspaceAppIconKey>([
  "file-manager-home",
  "file-manager-directory-empty",
  "file-manager-directory-non-empty",
  "file-manager-trash",
  "file-editor-code",
  "file-editor-readonly",
  "file-editor-unsupported",
  "image-viewer-default",
  "resource-monitor-default",
  "ai-panel-default",
  "ai-panel-history",
  "ai-panel-mcp",
  "ai-panel-plan",
  "ai-panel-skills",
  "ai-panel-plugins",
  "notification-center-default"
]);

const isWorkspaceAppId = (value: string): value is WorkbenchAppId => APP_IDS.has(value as WorkbenchAppId);
const isWorkspaceAppIconKey = (value: string): value is WorkspaceAppIconKey =>
  APP_ICON_KEYS.has(value as WorkspaceAppIconKey);

const sanitizeNotification = (value: unknown): WorkbenchNotificationItem | null => {
  if (isRecord(value) === false) {
    return null;
  }

  const id = sanitizeString(value.id);
  const title = sanitizeString(value.title);
  const preview = sanitizeString(value.preview);
  const level = sanitizeString(value.level);
  const createdAt = typeof value.createdAt === "number" ? value.createdAt : NaN;

  if (
    id === null ||
    title === null ||
    preview === null ||
    (level !== "info" && level !== "success" && level !== "warning" && level !== "error") ||
    Number.isFinite(createdAt) === false
  ) {
    return null;
  }

  const source = value.source;
  if (isRecord(source) === false) {
    return null;
  }
  const sourceId = sanitizeString(source.id);
  const sourceTitle = sanitizeString(source.title);
  const sourceIconKey = sanitizeString(source.iconKey);
  if (
    sourceId === null ||
    sourceTitle === null ||
    sourceIconKey === null
  ) {
    return null;
  }

  const target = value.target;
  if (isRecord(target) === false) {
    return null;
  }
  const targetKind = sanitizeString(target.kind);
  if (targetKind === null) {
    return null;
  }

  let normalizedTarget: WorkbenchNotificationItem["target"];
  if (targetKind === "none") {
    normalizedTarget = { kind: "none" };
  } else if (targetKind === "page-tab") {
    const address = sanitizeString(target.address);
    if (address === null) {
      return null;
    }
    const targetTitle = sanitizeString(target.title) ?? undefined;
    normalizedTarget = {
      kind: "page-tab",
      address,
      ...(targetTitle === undefined ? {} : { title: targetTitle })
    };
  } else if (targetKind === "app-tab") {
    const appId = sanitizeString(target.appId);
    const appInstanceId = sanitizeString(target.appInstanceId);
    if (appId === null || appInstanceId === null || isWorkspaceAppId(appId) === false) {
      return null;
    }
    const appTitle = sanitizeString(target.title) ?? undefined;
    const iconKeyRaw = sanitizeString(target.iconKey) ?? undefined;
    const iconKey =
      iconKeyRaw === undefined || isWorkspaceAppIconKey(iconKeyRaw)
        ? iconKeyRaw
        : undefined;
    const filePath = sanitizeString(target.filePath) ?? undefined;
    const fileSessionId = sanitizeString(target.fileSessionId) ?? undefined;
    const isDirty = typeof target.isDirty === "boolean" ? target.isDirty : undefined;

    normalizedTarget = {
      kind: "app-tab",
      appId,
      appInstanceId,
      ...(appTitle === undefined ? {} : { title: appTitle }),
      ...(iconKey === undefined ? {} : { iconKey }),
      ...(filePath === undefined ? {} : { filePath }),
      ...(fileSessionId === undefined ? {} : { fileSessionId }),
      ...(isDirty === undefined ? {} : { isDirty })
    };
  } else {
    return null;
  }

  const body = sanitizeString(value.body) ?? undefined;
  const readAt = typeof value.readAt === "number" && Number.isFinite(value.readAt)
    ? value.readAt
    : undefined;

  return {
    id,
    title,
    preview,
    ...(body === undefined ? {} : { body }),
    level,
    source: {
      id: sourceId,
      title: sourceTitle,
      iconKey: sourceIconKey as WorkbenchNotificationItem["source"]["iconKey"]
    },
    target: normalizedTarget,
    createdAt,
    ...(readAt === undefined ? {} : { readAt })
  };
};

const readSnapshot = (): RuntimeState => {
  if (typeof window === "undefined") {
    return CLOSED_STATE;
  }
  const raw = readWorkbenchStateSync(WORKBENCH_STATE_KEY);
  if (raw === null) {
    return CLOSED_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) === false) {
      return CLOSED_STATE;
    }
    if (parsed.version !== SNAPSHOT_VERSION || Array.isArray(parsed.notifications) === false) {
      return CLOSED_STATE;
    }

    const notifications = parsed.notifications
      .map((entry) => sanitizeNotification(entry))
      .filter((entry): entry is WorkbenchNotificationItem => entry !== null)
      .slice(0, MAX_NOTIFICATION_COUNT);

    const selectedNotificationId =
      typeof parsed.selectedNotificationId === "string" &&
      notifications.some((entry) => entry.id === parsed.selectedNotificationId)
        ? parsed.selectedNotificationId
        : null;

    return {
      notifications,
      selectedNotificationId,
      topbarPreviewNotificationId: null
    };
  } catch {
    return CLOSED_STATE;
  }
};

const writeSnapshot = (state: RuntimeState): void => {
  if (typeof window === "undefined") {
    return;
  }

  const snapshot: WorkbenchNotificationSnapshot = {
    version: SNAPSHOT_VERSION,
    notifications: state.notifications,
    selectedNotificationId: state.selectedNotificationId
  };

  writeWorkbenchStateSync(WORKBENCH_STATE_KEY, JSON.stringify(snapshot));
};

const ensureSelectedNotification = (state: RuntimeState): RuntimeState => {
  if (state.notifications.length === 0) {
    return {
      ...state,
      selectedNotificationId: null,
      topbarPreviewNotificationId: null
    };
  }

  if (
    state.selectedNotificationId !== null &&
    state.notifications.some((item) => item.id === state.selectedNotificationId)
  ) {
    return state;
  }

  return {
    ...state,
    selectedNotificationId: state.notifications[0]?.id ?? null
  };
};

const clampList = (
  notifications: readonly WorkbenchNotificationItem[]
): readonly WorkbenchNotificationItem[] => notifications.slice(0, MAX_NOTIFICATION_COUNT);

const markRead = (
  notifications: readonly WorkbenchNotificationItem[],
  targetId: string,
  readAt: number
): readonly WorkbenchNotificationItem[] =>
  notifications.map((item) => {
    if (item.id !== targetId || item.readAt !== undefined) {
      return item;
    }
    return {
      ...item,
      readAt
    };
  });

export const createNotificationCenterAppRequest = (
  title: string
): {
  readonly appId: NotificationCenterAppId;
  readonly appInstanceId: "notification-center";
  readonly title: string;
  readonly iconKey: NotificationCenterAppIconKey;
} => ({
  appId: "notification-center",
  appInstanceId: "notification-center",
  title,
  iconKey: "notification-center-default"
});

export const useWorkbenchNotificationModel = (): WorkbenchNotificationModel => {
  const [state, setState] = useState<RuntimeState>(() => readSnapshot());
  const previewTimerRef = useRef<number | null>(null);

  useEffect(() => {
    writeSnapshot(state);
  }, [state]);

  useEffect(() => {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    if (state.topbarPreviewNotificationId === null) {
      return;
    }

    previewTimerRef.current = window.setTimeout(() => {
      setState((current) => {
        if (current.topbarPreviewNotificationId !== state.topbarPreviewNotificationId) {
          return current;
        }
        return {
          ...current,
          topbarPreviewNotificationId: null
        };
      });
      previewTimerRef.current = null;
    }, TOPBAR_PREVIEW_TIMEOUT_MS);

    return () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
    };
  }, [state.topbarPreviewNotificationId]);

  const publishNotification = useCallback((request: WorkbenchNotificationPublishRequest): WorkbenchNotificationItem => {
    const nextItem: WorkbenchNotificationItem = {
      ...request,
      id: request.id ?? createNotificationId(),
      createdAt: request.createdAt ?? Date.now()
    };

    setState((current) => {
      const deduped = current.notifications.filter((item) => item.id !== nextItem.id);
      const nextNotifications = clampList([nextItem, ...deduped]);
      return ensureSelectedNotification({
        ...current,
        notifications: nextNotifications,
        topbarPreviewNotificationId: nextItem.id
      });
    });

    return nextItem;
  }, []);

  const markNotificationRead = useCallback((notificationId: string): void => {
    if (notificationId.trim().length === 0) {
      return;
    }

    setState((current) => {
      if (current.notifications.some((item) => item.id === notificationId) === false) {
        return current;
      }

      return {
        ...current,
        notifications: markRead(current.notifications, notificationId, Date.now())
      };
    });
  }, []);

  const markAllNotificationsRead = useCallback((): void => {
    setState((current) => {
      if (current.notifications.some((item) => item.readAt === undefined) === false) {
        return current;
      }
      const readAt = Date.now();
      return {
        ...current,
        notifications: current.notifications.map((item) =>
          item.readAt === undefined
            ? {
                ...item,
                readAt
              }
            : item
        )
      };
    });
  }, []);

  const clearNotifications = useCallback((): void => {
    setState((current) => ({
      ...current,
      notifications: [],
      selectedNotificationId: null,
      topbarPreviewNotificationId: null
    }));
  }, []);

  const selectNotification = useCallback((notificationId: string): void => {
    if (notificationId.trim().length === 0) {
      return;
    }

    setState((current) => {
      if (current.notifications.some((item) => item.id === notificationId) === false) {
        return current;
      }

      return {
        ...current,
        selectedNotificationId: notificationId,
        notifications: markRead(current.notifications, notificationId, Date.now())
      };
    });
  }, []);

  const acknowledgeTopbarPreview = useCallback((): void => {
    setState((current) => {
      if (current.topbarPreviewNotificationId === null) {
        return current;
      }
      return {
        ...current,
        topbarPreviewNotificationId: null
      };
    });
  }, []);

  const getNotification = useCallback((notificationId: string): WorkbenchNotificationItem | null => {
    const id = notificationId.trim();
    if (id.length === 0) {
      return null;
    }
    return state.notifications.find((item) => item.id === id) ?? null;
  }, [state.notifications]);

  const selectedNotification =
    state.selectedNotificationId === null
      ? null
      : state.notifications.find((item) => item.id === state.selectedNotificationId) ?? null;

  const topbarPreview =
    state.topbarPreviewNotificationId === null
      ? null
      : state.notifications.find((item) => item.id === state.topbarPreviewNotificationId) ?? null;

  const unreadCount = useMemo(
    () => state.notifications.filter((item) => item.readAt === undefined).length,
    [state.notifications]
  );

  return {
    notifications: state.notifications,
    unreadCount,
    selectedNotificationId: state.selectedNotificationId,
    selectedNotification,
    topbarPreviewNotificationId: state.topbarPreviewNotificationId,
    topbarPreview,
    publishNotification,
    markNotificationRead,
    markAllNotificationsRead,
    clearNotifications,
    selectNotification,
    acknowledgeTopbarPreview,
    getNotification
  };
};
