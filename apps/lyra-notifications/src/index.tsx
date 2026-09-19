import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createFirstPartyAppModule,
  useFirstPartyWorkbenchChrome,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

import { resolveMessages } from "./l10n/resolve";
import { isRecord, parseNotificationSnapshot, type NotificationSnapshot } from "./parse";
import { NotificationCenterChrome } from "./surface";

const COMMANDS = {
  read: "lyra.core.notifications.read",
  select: "lyra.core.notifications.select",
  markAllRead: "lyra.core.notifications.mark-all-read",
  openSource: "lyra.core.notifications.open-source",
  openLink: "lyra.core.notifications.open-link",
  requestClear: "lyra.core.notifications.request-clear"
} as const;
const NOTIFICATIONS_CHANGED_EVENT = "lyra.core.notifications-changed";

export { parseNotificationSnapshot } from "./parse";
export type { NotificationSnapshot } from "./parse";

const NotificationsSurface = ({
  host,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const labels = useMemo(
    () => resolveMessages(presentation.locale),
    [presentation.locale]
  );
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
  const openLink = useCallback(async (url: string) => {
    await host.executeCommand(COMMANDS.openLink, { url });
  }, [host]);

  const buildChrome = useCallback(() => {
    const notifications = snapshot?.notifications ?? [];
    const unreadCount = snapshot?.unreadCount
      ?? notifications.filter((item) => item.readAt === undefined).length;
    const canMarkAllRead = notifications.some((item) => item.readAt === undefined);
    const canClearAll = notifications.length > 0;
    const actions = [
      ...(canMarkAllRead ? [{
        id: "mark-all-read",
        label: labels.markAllRead,
        commandId: "lyra.notifications.mark-all-read",
        order: 0,
        iconKey: "check-check"
      }] : []),
      ...(canClearAll ? [{
        id: "clear-all",
        label: labels.clearAll,
        commandId: "lyra.notifications.request-clear",
        order: 1,
        iconKey: "trash-2",
        tone: "danger" as const
      }] : [])
    ];
    return {
      navigation: { navigation: { mode: "hidden" as const } },
      toolbarContext: {
        ariaLabel: labels.title,
        ...(actions.length > 0 ? { actions } : {}),
        chips: [{
          id: "notification-count",
          text: `${String(notifications.length)}${unreadCount > 0 ? ` / ${labels.unread} ${unreadCount}` : ""}`,
          order: 2
        }]
      }
    };
  }, [labels, snapshot]);

  useFirstPartyWorkbenchChrome("lyra.notifications", buildChrome, [buildChrome]);

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
      onOpenNotificationLink={(url) => {
        void openLink(url);
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
      { id: "lyra.notifications.mark-all-read", title: "Mark all notifications read" },
      { id: "lyra.notifications.request-clear", title: "Request clear notifications" }
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
    },
    "lyra.notifications.request-clear": async (host) => {
      await host.executeCommand(COMMANDS.requestClear, {});
      return null;
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
