import { ArrowUpRight } from "lucide-react";
import { useMemo } from "react";

import { renderNotificationSourceIcon } from "./icon-registry";
import type { NotificationCenterLabels, WorkbenchNotificationItem } from "./types";

type NotificationCenterSurfaceProps = {
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

  return (
    <section className="lyra-notification-center" aria-label="notification-center-surface">
      <header className="lyra-notification-center-header">
        <h2>{labels.title}</h2>
        <div className="lyra-notification-center-header-actions">
          <button
            type="button"
            className="lyra-notification-center-header-action"
            onClick={onMarkAllRead}
          >
            {labels.markAllRead}
          </button>
          <button
            type="button"
            className="lyra-notification-center-header-action"
            onClick={onClearAll}
          >
            {labels.clearAll}
          </button>
        </div>
      </header>

      <section className="lyra-notification-center-body">
        <aside className="lyra-notification-center-list" aria-label={labels.listTitle}>
          {notifications.length === 0 ? (
            <div className="lyra-notification-center-empty">{labels.emptyState}</div>
          ) : (
            notifications.map((item) => {
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
            })
          )}
        </aside>

        <section className="lyra-notification-center-detail" aria-label="notification-center-detail">
          {selected === null ? (
            <div className="lyra-notification-center-detail-empty">{labels.detailEmpty}</div>
          ) : (
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
