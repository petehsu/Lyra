import { ArrowUpRight, CheckCheck, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { renderNotificationSourceIcon } from "./icon-registry";
import type { NotificationCenterLabels, WorkbenchNotificationItem } from "./types";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export type NotificationCenterSurfaceProps = {
  readonly labels: NotificationCenterLabels;
  readonly notifications: readonly WorkbenchNotificationItem[];
  readonly selectedNotificationId: string | null;
  readonly onSelectNotification: (notificationId: string) => void;
  readonly onMarkAllRead: () => void;
  readonly onClearAll: () => void;
  readonly onOpenNotificationSource: (notificationId: string) => void;
};

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
};

export const NotificationCenterSurface = ({
  labels,
  notifications,
  selectedNotificationId,
  onSelectNotification,
  onMarkAllRead,
  onClearAll,
  onOpenNotificationSource
}: NotificationCenterSurfaceProps) => {
  const selected = useMemo(() => {
    if (notifications.length === 0) {
      return null;
    }

    if (selectedNotificationId === null) {
      return notifications[0] ?? null;
    }

    return notifications.find((entry) => entry.id === selectedNotificationId) ?? notifications[0] ?? null;
  }, [notifications, selectedNotificationId]);
  const unreadCount = notifications.filter((item) => item.readAt === undefined).length;
  const canMarkAllRead = unreadCount > 0;
  const canClearAll = notifications.length > 0;
  const titlebarContribution = useMemo(
    () => ({
      ariaLabel: labels.title,
      content: (
        <>
          {canMarkAllRead || canClearAll ? (
            <div className="lyra-titlebar-context-controls">
              {canMarkAllRead ? (
                <button
                  type="button"
                  className="lyra-titlebar-context-icon-button"
                  aria-label={labels.markAllRead}
                  title={labels.markAllRead}
                  onClick={onMarkAllRead}
                >
                  <CheckCheck size={14} aria-hidden="true" />
                </button>
              ) : null}
              {canClearAll ? (
                <button
                  type="button"
                  className="lyra-titlebar-context-icon-button lyra-titlebar-context-danger"
                  aria-label={labels.clearAll}
                  title={labels.clearAll}
                  onClick={onClearAll}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}
          <span className="lyra-titlebar-context-chip">
            {String(notifications.length)}
            {unreadCount > 0 ? ` / ${labels.unread} ${unreadCount}` : ""}
          </span>
        </>
      )
    }),
    [
      canClearAll,
      canMarkAllRead,
      labels,
      notifications.length,
      onClearAll,
      onMarkAllRead,
      unreadCount
    ]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  return (
    <section className="lyra-notification-center" aria-label="notification-center-surface">
      <section className="lyra-notification-center-body">
        <aside className="lyra-notification-center-list" aria-label={labels.listTitle}>
          {notifications.map((item) => {
            const isActive = item.id === selected?.id;
            const isUnread = item.readAt === undefined;
            const className = [
              "lyra-notification-center-item",
              isActive ? "lyra-notification-center-item-active" : "",
              isUnread ? "lyra-notification-center-item-unread" : ""
            ]
              .filter((value) => value.length > 0)
              .join(" ");

            return (
              <button
                key={item.id}
                type="button"
                className={className}
                onClick={() => {
                  onSelectNotification(item.id);
                }}
              >
                <span className="lyra-notification-center-item-icon" aria-hidden="true">
                  {renderNotificationSourceIcon(item.source.iconKey, 14)}
                </span>
                <span className="lyra-notification-center-item-main">
                  <strong>{item.title}</strong>
                  <small>{item.preview}</small>
                </span>
                <span className="lyra-notification-center-item-meta">
                  {isUnread ? <i>{labels.unread}</i> : null}
                  <time>{formatTimestamp(item.createdAt)}</time>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="lyra-notification-center-detail" aria-label="notification-center-detail">
          {selected === null ? null : (
            <article className="lyra-notification-center-detail-card">
              <header className="lyra-notification-center-detail-head">
                <span className="lyra-notification-center-detail-icon" aria-hidden="true">
                  {renderNotificationSourceIcon(selected.source.iconKey, 16)}
                </span>
                <div className="lyra-notification-center-detail-title-wrap">
                  <strong>{selected.title}</strong>
                  <small>{selected.source.title}</small>
                </div>
                <time>{formatTimestamp(selected.createdAt)}</time>
              </header>

              <section className="lyra-notification-center-detail-content">
                <p>{selected.preview}</p>
                {selected.body === undefined ? null : <pre>{selected.body}</pre>}
              </section>

              <footer className="lyra-notification-center-detail-actions">
                <button
                  type="button"
                  className="lyra-notification-center-detail-open"
                  disabled={selected.target.kind === "none"}
                  onClick={() => {
                    onOpenNotificationSource(selected.id);
                  }}
                >
                  <ArrowUpRight size={13} />
                  <span>
                    {selected.target.kind === "none"
                      ? labels.sourceFallback
                      : labels.openSource}
                  </span>
                </button>
              </footer>
            </article>
          )}
        </section>
      </section>
    </section>
  );
};
