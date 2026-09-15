import { ArrowUpRight } from "@lyra/icons";
import { useMemo, type ReactNode } from "react";

import {
  renderNotificationSourceIcon,
  type NotificationSourceIconKey
} from "./icons";

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

export type NotificationItem = {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly body?: string;
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
  readonly sourceFallback: string;
  readonly retry: string;
};

const formatTimestamp = (timestamp: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);

const EmptyState = ({
  className,
  title
}: {
  readonly className: string;
  readonly title: string;
}): ReactNode => (
  <div
    className={[
      "lyra-app-state",
      "lyra-app-state-empty",
      "lyra-app-state-density-default",
      "lyra-app-state-align-center",
      "lyra-app-state-tone-neutral",
      className
    ].join(" ")}
  >
    <span className="lyra-app-state-icon" aria-hidden="true">
      <span className="lyra-app-logo-mark lyra-app-state-logo" />
    </span>
    <span className="lyra-app-state-copy">
      <strong className="lyra-app-state-title">{title}</strong>
    </span>
  </div>
);

export const NotificationCenterChrome = ({
  labels,
  locale,
  notifications,
  selectedNotificationId,
  error,
  onSelectNotification,
  onOpenNotificationSource,
  onRetry
}: {
  readonly labels: NotificationCenterLabels;
  readonly locale: string;
  readonly notifications: readonly NotificationItem[];
  readonly selectedNotificationId: string | null;
  readonly error: string | null;
  readonly onSelectNotification: (notificationId: string) => void;
  readonly onOpenNotificationSource: (notificationId: string) => void;
  readonly onRetry: () => void;
}): ReactNode => {
  const selected = useMemo(() => {
    if (notifications.length === 0) {
      return null;
    }
    if (selectedNotificationId === null) {
      return notifications[0] ?? null;
    }
    return notifications.find((entry) => entry.id === selectedNotificationId)
      ?? notifications[0]
      ?? null;
  }, [notifications, selectedNotificationId]);

  return (
    <section
      className="lyra-notification-center"
      data-lyra-component="lyra.notifications"
      aria-label="notification-center-surface"
    >
      <section className="lyra-notification-center-body">
        <aside className="lyra-app-sidebar-nav lyra-notification-center-list" aria-label={labels.listTitle}>
          {notifications.length === 0 ? (
            <EmptyState className="lyra-notification-center-empty" title={labels.emptyTitle} />
          ) : notifications.map((item) => {
            const isActive = item.id === selected?.id;
            const isUnread = item.readAt === undefined;
            return (
              <button
                key={item.id}
                type="button"
                className={[
                  "lyra-app-object-row",
                  "lyra-notification-center-item",
                  isUnread ? "lyra-notification-center-item-unread" : ""
                ].filter((value) => value.length > 0).join(" ")}
                data-active={isActive ? "true" : undefined}
                data-has-icon="true"
                onClick={() => {
                  onSelectNotification(item.id);
                }}
              >
                <span className="lyra-app-object-row-icon" aria-hidden="true">
                  {renderNotificationSourceIcon(item.sourceIconKey, 16)}
                </span>
                <span className="lyra-app-object-row-main">
                  <span className="lyra-app-object-row-head">
                    <span className="lyra-app-object-row-title">{item.title}</span>
                  </span>
                  <span className="lyra-app-object-row-description">{item.preview}</span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="lyra-notification-center-detail" aria-label="notification-center-detail">
          {error !== null ? (
            <div
              className="lyra-app-state lyra-app-state-error lyra-app-state-density-default lyra-app-state-align-center lyra-app-state-tone-error lyra-notification-center-detail-empty"
              role="alert"
            >
              <span className="lyra-app-state-copy">
                <strong className="lyra-app-state-title">{error}</strong>
              </span>
              <span className="lyra-app-state-actions">
                <button
                  type="button"
                  className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
                  onClick={onRetry}
                >
                  {labels.retry}
                </button>
              </span>
            </div>
          ) : selected === null ? (
            <EmptyState className="lyra-notification-center-detail-empty" title={labels.emptyTitle} />
          ) : (
            <article className="lyra-notification-center-detail-card">
              <header className="lyra-notification-center-detail-head">
                <span className="lyra-notification-center-detail-icon" aria-hidden="true">
                  {renderNotificationSourceIcon(selected.sourceIconKey, 16)}
                </span>
                <div className="lyra-notification-center-detail-title-wrap">
                  <strong>{selected.title}</strong>
                  <small>{selected.sourceTitle}</small>
                </div>
                <time>{formatTimestamp(selected.createdAt, locale)}</time>
              </header>
              <section className="lyra-notification-center-detail-content">
                <p>{selected.preview}</p>
                {selected.body === undefined ? null : <pre>{selected.body}</pre>}
              </section>
              <footer className="lyra-notification-center-detail-actions">
                <button
                  type="button"
                  className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
                  disabled={selected.target.kind === "none"}
                  onClick={() => {
                    onOpenNotificationSource(selected.id);
                  }}
                >
                  <ArrowUpRight size={14} aria-hidden="true" />
                  <span>
                    {selected.target.kind === "none" ? labels.sourceFallback : labels.openSource}
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
