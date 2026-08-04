import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  createFirstPartyAppModule,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

const COMMANDS = {
  read: "lyra.core.notifications.read",
  select: "lyra.core.notifications.select",
  markAllRead: "lyra.core.notifications.mark-all-read",
  openSource: "lyra.core.notifications.open-source",
  requestClear: "lyra.core.notifications.request-clear"
} as const;
const NOTIFICATIONS_CHANGED_EVENT = "lyra.core.notifications-changed";

type NotificationTarget =
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

export type NotificationItem = {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly body?: string;
  readonly level: "info" | "success" | "warning" | "error";
  readonly sourceTitle: string;
  readonly target: NotificationTarget;
  readonly createdAt: number;
  readonly readAt?: number;
};

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
    title: "通知", empty: "暂无通知", markAll: "全部已读", clear: "清除全部",
    open: "打开来源", retry: "重试", loading: "正在读取通知…", unread: "未读"
  } : {
    title: "Notifications", empty: "No notifications", markAll: "Mark all read", clear: "Clear all",
    open: "Open source", retry: "Retry", loading: "Loading notifications…", unread: "unread"
  };
};

const buttonStyle: CSSProperties = {
  border: "1px solid var(--lyra-border-subtle, #d5d8de)", borderRadius: 6,
  color: "inherit", background: "var(--lyra-surface-secondary, #f6f7f9)",
  padding: "6px 10px", cursor: "pointer"
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

  const selected = useMemo(
    () => snapshot?.notifications.find((item) => item.id === selectedId) ?? snapshot?.notifications[0] ?? null,
    [selectedId, snapshot]
  );
  const select = useCallback(async (id: string) => {
    setSelectedId(id);
    await host.executeCommand(COMMANDS.select, { notificationId: id });
    await refresh();
  }, [host, refresh]);
  const openSource = useCallback(async (item: NotificationItem) => {
    await host.executeCommand(COMMANDS.openSource, { notificationId: item.id });
    await refresh();
  }, [host, refresh]);

  return (
    <section data-lyra-component="lyra.notifications" aria-label="notification-center-surface" style={{
      display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", width: "100%", height: "100%",
      color: "var(--lyra-text-primary, #202124)", background: "var(--lyra-surface-primary, #fff)",
      fontFamily: "var(--lyra-font-sans, system-ui, sans-serif)"
    }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--lyra-border-subtle, #ddd)" }}>
        <strong>{labels.title}</strong>
        <span style={{ color: "var(--lyra-text-secondary, #666)", fontSize: 12 }}>
          {snapshot === null ? "" : `${snapshot.notifications.length} · ${snapshot.unreadCount} ${labels.unread}`}
        </span>
        <span style={{ flex: 1 }} />
        <button style={buttonStyle} disabled={!snapshot?.unreadCount} onClick={() => void host.executeCommand(COMMANDS.markAllRead, {}).then(refresh)}>{labels.markAll}</button>
        <button style={buttonStyle} disabled={!snapshot?.notifications.length} onClick={() => void host.executeCommand(COMMANDS.requestClear, {})}>{labels.clear}</button>
      </header>
      {error !== null ? (
        <div role="alert" style={{ margin: "auto", textAlign: "center" }}><p>{error}</p><button style={buttonStyle} onClick={() => void refresh()}>{labels.retry}</button></div>
      ) : snapshot === null ? (
        <p style={{ margin: "auto" }}>{labels.loading}</p>
      ) : snapshot.notifications.length === 0 ? (
        <p style={{ margin: "auto", color: "var(--lyra-text-secondary, #666)" }}>{labels.empty}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 34%) minmax(0, 1fr)", minHeight: 0 }}>
          <nav aria-label={labels.title} style={{ overflow: "auto", borderRight: "1px solid var(--lyra-border-subtle, #ddd)" }}>
            {snapshot.notifications.map((item) => (
              <button key={item.id} onClick={() => void select(item.id)} style={{
                display: "block", width: "100%", padding: "12px 14px", textAlign: "left", border: 0,
                borderBottom: "1px solid var(--lyra-border-subtle, #eee)", color: "inherit", cursor: "pointer",
                background: item.id === selected?.id ? "var(--lyra-surface-selected, #e8eef8)" : "transparent"
              }}>
                <span style={{ display: "flex", gap: 7, alignItems: "center", fontWeight: item.readAt === undefined ? 650 : 450 }}>
                  <i aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: item.readAt === undefined ? "var(--lyra-accent, #3478d4)" : "transparent" }} />
                  {item.title}
                </span>
                <small style={{ display: "block", marginTop: 5, color: "var(--lyra-text-secondary, #666)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.preview}</small>
              </button>
            ))}
          </nav>
          {selected === null ? null : (
            <article style={{ overflow: "auto", padding: 22 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{selected.title}</h2>
              <p style={{ margin: "6px 0 18px", color: "var(--lyra-text-secondary, #666)", fontSize: 12 }}>
                {selected.sourceTitle} · {new Date(selected.createdAt).toLocaleString()}
              </p>
              <p>{selected.preview}</p>
              {selected.body === undefined ? null : <pre style={{ whiteSpace: "pre-wrap", font: "inherit" }}>{selected.body}</pre>}
              <button style={buttonStyle} disabled={selected.target.kind === "none"} onClick={() => void openSource(selected)}>{labels.open}</button>
            </article>
          )}
        </div>
      )}
    </section>
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
