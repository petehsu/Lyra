import { useCallback, useEffect, useState } from "react";

import {
  createFirstPartyAppModule,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

import type { NotificationSourceIconKey } from "./icons";
import {
  NotificationCenterChrome,
  type NotificationItem,
  type NotificationTarget
} from "./surface";

const COMMANDS = {
  read: "lyra.core.notifications.read",
  select: "lyra.core.notifications.select",
  markAllRead: "lyra.core.notifications.mark-all-read",
  openSource: "lyra.core.notifications.open-source",
  requestClear: "lyra.core.notifications.request-clear"
} as const;
const NOTIFICATIONS_CHANGED_EVENT = "lyra.core.notifications-changed";
const SOURCE_ICON_KEYS = new Set<NotificationSourceIconKey>([
  "file-manager",
  "file-editor",
  "browser",
  "terminal",
  "system",
  "notification"
]);

export type NotificationSnapshot = {
  readonly notifications: readonly NotificationItem[];
  readonly selectedNotificationId: string | null;
  readonly unreadCount: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const parseTarget = (value: unknown): NotificationTarget => {
  if (!isRecord(value) || value.kind === "none") return { kind: "none" };
  if (value.kind === "page-tab") {
    const address = stringValue(value.address);
    if (address !== undefined) {
      const title = stringValue(value.title);
      return { kind: "page-tab", address, ...(title === undefined ? {} : { title }) };
    }
  }
  if (value.kind === "app-tab") {
    const appId = stringValue(value.appId);
    const appInstanceId = stringValue(value.appInstanceId);
    if (appId !== undefined && appInstanceId !== undefined) {
      const title = stringValue(value.title);
      const iconKey = stringValue(value.iconKey);
      const filePath = stringValue(value.filePath);
      return {
        kind: "app-tab", appId, appInstanceId,
        ...(title === undefined ? {} : { title }),
        ...(iconKey === undefined ? {} : { iconKey }),
        ...(filePath === undefined ? {} : { filePath })
      };
    }
  }
  return { kind: "none" };
};

const parseSourceIconKey = (value: unknown): NotificationSourceIconKey => {
  const iconKey = stringValue(value);
  return iconKey !== undefined && SOURCE_ICON_KEYS.has(iconKey as NotificationSourceIconKey)
    ? iconKey as NotificationSourceIconKey
    : "notification";
};

export const parseNotificationSnapshot = (value: unknown): NotificationSnapshot => {
  if (!isRecord(value) || !Array.isArray(value.notifications)) {
    throw new Error("Core returned an invalid notification snapshot.");
  }
  const notifications = value.notifications.flatMap((entry): readonly NotificationItem[] => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const title = stringValue(entry.title);
    const preview = stringValue(entry.preview);
    const level = entry.level;
    const createdAt = entry.createdAt;
    if (
      id === undefined || title === undefined || preview === undefined
      || (level !== "info" && level !== "success" && level !== "warning" && level !== "error")
      || typeof createdAt !== "number" || !Number.isFinite(createdAt)
    ) return [];
    const source = isRecord(entry.source) ? entry.source : {};
    const body = stringValue(entry.body);
    const readAt = typeof entry.readAt === "number" && Number.isFinite(entry.readAt)
      ? entry.readAt
      : undefined;
    return [{
      id, title, preview,
      ...(body === undefined ? {} : { body }),
      level,
      sourceTitle: stringValue(source.title) ?? "Lyra",
      sourceIconKey: parseSourceIconKey(source.iconKey),
      target: parseTarget(entry.target),
      createdAt,
      ...(readAt === undefined ? {} : { readAt })
    }];
  });
  return {
    notifications,
    selectedNotificationId: typeof value.selectedNotificationId === "string"
      ? value.selectedNotificationId : null,
    unreadCount: typeof value.unreadCount === "number"
      ? Math.max(0, Math.floor(value.unreadCount))
      : notifications.filter((item) => item.readAt === undefined).length
  };
};

const text = (locale: string) => {
  const chinese = locale.toLowerCase().startsWith("zh");
  return chinese ? {
    title: "通知",
    listTitle: "列表",
    emptyTitle: "暂无通知",
    openSource: "打开来源",
    sourceFallback: "没有可跳转目标",
    retry: "重试"
  } : {
    title: "Notifications",
    listTitle: "List",
    emptyTitle: "No notifications",
    openSource: "Open source",
    sourceFallback: "No jump target available",
    retry: "Retry"
  };
};

const NotificationsSurface = ({
  host,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const labels = text(presentation.locale);
  const restoredSelection = isRecord(opaqueState) && typeof opaqueState.selectedNotificationId === "string"
    ? opaqueState.selectedNotificationId : null;
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(restoredSelection);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = parseNotificationSnapshot(await host.executeCommand(COMMANDS.read, {}));
      setSnapshot(next);
      setSelectedId((current) => {
        if (current !== null && next.notifications.some((item) => item.id === current)) {
          return current;
        }
        if (
          next.selectedNotificationId !== null
          && next.notifications.some((item) => item.id === next.selectedNotificationId)
        ) {
          return next.selectedNotificationId;
        }
        return next.notifications[0]?.id ?? null;
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [host]);

  useEffect(() => {
    void refresh();
    try {
      const subscription = host.subscribeEvent(NOTIFICATIONS_CHANGED_EVENT, async () => refresh());
      return () => subscription.dispose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }, [host, refresh]);

  useEffect(() => {
    updateOpaqueState(selectedId === null ? {} : { selectedNotificationId: selectedId });
  }, [selectedId, updateOpaqueState]);

  const select = useCallback(async (id: string) => {
    setSelectedId(id);
    await host.executeCommand(COMMANDS.select, { notificationId: id });
    await refresh();
  }, [host, refresh]);
  const openSource = useCallback(async (id: string) => {
    await host.executeCommand(COMMANDS.openSource, { notificationId: id });
    await refresh();
  }, [host, refresh]);

  return (
    <NotificationCenterChrome
      labels={labels}
      locale={presentation.locale}
      notifications={snapshot?.notifications ?? []}
      selectedNotificationId={selectedId}
      error={error}
      onSelectNotification={(id) => {
        void select(id);
      }}
      onOpenNotificationSource={(id) => {
        void openSource(id);
      }}
      onRetry={() => {
        void refresh();
      }}
    />
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.notifications",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.notifications.refresh", title: "Refresh notifications" },
      { id: "lyra.notifications.mark-all-read", title: "Mark all notifications read" }
    ],
    status: [
      { id: "lyra.notifications.status", title: "Notifications" }
    ]
  },
  commandHandlers: {
    "lyra.notifications.refresh": (host) => host.executeCommand(COMMANDS.read, {}),
    "lyra.notifications.mark-all-read": async (host) => {
      await host.executeCommand(COMMANDS.markAllRead, {});
      return host.executeCommand(COMMANDS.read, {});
    }
  },
  surfaces: {
    "notification-center": {
      title: "Notifications",
      description: "Review Lyra activity and open its source.",
      component: NotificationsSurface
    }
  }
});
export default lyraAppModule;
