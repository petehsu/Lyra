import { LyraAppState } from "@lyra/first-party-app-kit";
import { ArrowUpRight, ChevronDown, ChevronRight } from "@lyra/icons";
import { useMemo, useState, type ReactNode } from "react";

import { NotificationMarkdownBody } from "./markdown";
import {
  renderNotificationSourceIcon,
  type NotificationSourceIconKey
} from "./icons";
import type {
  NotificationCenterLabels,
  NotificationItem
} from "./types";

export type {
  NotificationBodyKind,
  NotificationCenterLabels,
  NotificationItem,
  NotificationTarget
} from "./types";

const formatTimestamp = (timestamp: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);

const formatRelativeAge = (timestamp: number, locale: string): string => {
  const deltaSec = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  const abs = Math.abs(deltaSec);
  if (abs < 60) {
    return formatter.format(deltaSec, "second");
  }
  const minutes = Math.round(deltaSec / 60);
  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, "minute");
  }
  const hours = Math.round(deltaSec / 3600);
  if (Math.abs(hours) < 24) {
    return formatter.format(hours, "hour");
  }
  return formatter.format(Math.round(deltaSec / 86400), "day");
};

const sidebarPreview = (item: NotificationItem): string => {
  const title = item.title.trim();
  const preview = item.preview.trim();
  if (title.length === 0) {
    return preview;
  }
  if (preview.length === 0) {
    return title;
  }
  return title.length <= preview.length ? title : preview;
};

const sourceGroupKey = (item: NotificationItem): string =>
  `${item.sourceTitle}\0${item.sourceIconKey}`;

type NotificationSourceGroup = {
  readonly key: string;
  readonly sourceTitle: string;
  readonly sourceIconKey: NotificationSourceIconKey;
  readonly items: readonly NotificationItem[];
  readonly unreadCount: number;
};

const groupNotifications = (
  notifications: readonly NotificationItem[]
): readonly NotificationSourceGroup[] => {
  const groups: NotificationSourceGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of notifications) {
    const key = sourceGroupKey(item);
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        key,
        sourceTitle: item.sourceTitle,
        sourceIconKey: item.sourceIconKey,
        items: [item],
        unreadCount: item.readAt === undefined ? 1 : 0
      });
      continue;
    }
    const group = groups[existing];
    if (group === undefined) {
      continue;
    }
    groups[existing] = {
      ...group,
      items: [...group.items, item],
      unreadCount: group.unreadCount + (item.readAt === undefined ? 1 : 0)
    };
  }
  return groups;
};

const NotificationDetailBody = ({
  item,
  onOpenLink
}: {
  readonly item: NotificationItem;
  readonly onOpenLink: (url: string) => void;
}): ReactNode => {
  const bodyKind = item.bodyKind ?? "plain";
  if (bodyKind === "markdown") {
    return (
      <NotificationMarkdownBody
        content={item.body ?? item.preview}
        onOpenLink={onOpenLink}
      />
    );
  }
  if (bodyKind === "image" && item.imageUrl !== undefined) {
    return (
      <figure className="lyra-notification-center-detail-figure">
        <img src={item.imageUrl} alt="" />
        {item.body === undefined ? null : (
          <figcaption>{item.body}</figcaption>
        )}
      </figure>
    );
  }
  return (
    <>
      <p>{item.preview}</p>
      {item.body === undefined ? null : <pre>{item.body}</pre>}
    </>
  );
};

export const NotificationCenterChrome = ({
  labels,
  locale,
  notifications,
  selectedNotificationId,
  error,
  onSelectNotification,
  onOpenNotificationSource,
  onOpenNotificationLink,
  onRetry
}: {
  readonly labels: NotificationCenterLabels;
  readonly locale: string;
  readonly notifications: readonly NotificationItem[];
  readonly selectedNotificationId: string | null;
  readonly error: string | null;
  readonly onSelectNotification: (notificationId: string) => void;
  readonly onOpenNotificationSource: (notificationId: string) => void;
  readonly onOpenNotificationLink: (url: string) => void;
  readonly onRetry: () => void;
}): ReactNode => {
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const groups = useMemo(() => groupNotifications(notifications), [notifications]);
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
      <section className="lyra-app-sidebar-split lyra-notification-center-body">
        <aside className="lyra-app-sidebar-nav lyra-notification-center-list" aria-label={labels.listTitle}>
          {notifications.length === 0 ? (
            <LyraAppState className="lyra-notification-center-empty" kind="empty" title={labels.emptyTitle} />
          ) : groups.map((group) => {
            const collapsed = collapsedKeys.has(group.key);
            return (
              <div key={group.key} className="lyra-notification-center-source-group">
                <div className="lyra-app-sidebar-group lyra-notification-center-source-header">
                  <button
                    type="button"
                    className="lyra-ui-button lyra-ui-button-ghost lyra-ui-button-size-sm lyra-app-sidebar-group-toggle"
                    aria-expanded={!collapsed}
                    onClick={() => {
                      setCollapsedKeys((current) => {
                        const next = new Set(current);
                        if (next.has(group.key)) {
                          next.delete(group.key);
                        } else {
                          next.add(group.key);
                        }
                        return next;
                      });
                    }}
                    onPointerUp={(event) => {
                      event.currentTarget.blur();
                    }}
                  >
                    <span className="lyra-agent-project-tree-icon-slot has-twist" aria-hidden="true">
                      <span className="lyra-agent-project-tree-entry-icon">
                        {renderNotificationSourceIcon(group.sourceIconKey, 13)}
                      </span>
                      <span className="lyra-agent-project-tree-twist">
                        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      </span>
                    </span>
                    <span className="lyra-app-sidebar-group-name">{group.sourceTitle}</span>
                  </button>
                  {group.unreadCount > 0 ? (
                    <span className="lyra-notification-center-unread" aria-hidden="true">
                      {group.unreadCount}
                    </span>
                  ) : null}
                </div>
                {collapsed ? null : group.items.map((item) => {
                  const isActive = item.id === selected?.id;
                  const isUnread = item.readAt === undefined;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={[
                        "lyra-app-object-row",
                        "lyra-app-sidebar-row",
                        "lyra-notification-center-item",
                        isUnread ? "lyra-notification-center-item-unread" : ""
                      ].filter((value) => value.length > 0).join(" ")}
                      data-active={isActive ? "true" : undefined}
                      data-has-icon="true"
                      onClick={() => {
                        onSelectNotification(item.id);
                      }}
                    >
                      <span className="lyra-app-object-row-icon" aria-hidden="true" />
                      <span className="lyra-app-object-row-main">
                        <span className="lyra-app-object-row-head">
                          <span className="lyra-app-object-row-title">{sidebarPreview(item)}</span>
                          <span className="lyra-app-object-row-meta lyra-app-sidebar-row-age">
                            {formatRelativeAge(item.createdAt, locale)}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </aside>

        <section className="lyra-notification-center-detail" aria-label="notification-center-detail">
          {error !== null ? (
            <LyraAppState
              className="lyra-notification-center-detail-empty"
              kind="error"
              title={error}
              actionLabel={labels.retry}
              onAction={onRetry}
            />
          ) : selected === null ? (
            <LyraAppState className="lyra-notification-center-detail-empty" kind="empty" title={labels.emptyTitle} />
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
                <NotificationDetailBody
                  item={selected}
                  onOpenLink={onOpenNotificationLink}
                />
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
                    {selected.target.kind === "none"
                      ? labels.sourceFallback
                      : selected.bodyKind === "page"
                        ? labels.openPage
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
