import { Bell } from "lucide-react";
import type { ReactNode } from "react";

import { renderNotificationSourceIcon } from "./icon-registry";
import type { NotificationTopbarLabels, WorkbenchNotificationItem } from "./types";

const MAX_TOPBAR_QUICK_ACTIONS = 4;

export type WorkbenchNotificationTopbarQuickAction = {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly tone?: "default" | "danger";
  readonly onSelect: () => void;
};

export type WorkbenchNotificationTopbarProps = {
  readonly labels: NotificationTopbarLabels;
  readonly notificationCount: number;
  readonly unreadCount: number;
  readonly preview: WorkbenchNotificationItem | null;
  readonly quickActions?: readonly WorkbenchNotificationTopbarQuickAction[];
  readonly onOpenCenter: () => void;
  readonly onOpenPreview: () => void;
};

export const WorkbenchNotificationTopbar = ({
  labels,
  notificationCount,
  unreadCount,
  preview,
  quickActions = [],
  onOpenCenter,
  onOpenPreview
}: WorkbenchNotificationTopbarProps) => {
  const previewText = preview === null
    ? ""
    : `${preview.source.title} · ${preview.preview}`;
  const visibleQuickActions = preview === null
    ? []
    : quickActions.slice(0, MAX_TOPBAR_QUICK_ACTIONS);
  const canOpenCenter = notificationCount > 0;

  return (
    <section className="lyra-notification-topbar" aria-label="notification-topbar">
      {preview === null ? null : (
        <button
          type="button"
          className="lyra-notification-topbar-preview"
          aria-label={labels.openPreview}
          onClick={onOpenPreview}
        >
          <span className="lyra-notification-topbar-preview-source" aria-hidden="true">
            {renderNotificationSourceIcon(preview.source.iconKey, 12)}
          </span>
          <span className="lyra-notification-topbar-preview-track">
            <span className="lyra-notification-topbar-preview-marquee">{previewText}</span>
            <span className="lyra-notification-topbar-preview-marquee" aria-hidden="true">
              {previewText}
            </span>
          </span>
        </button>
      )}

      {visibleQuickActions.length === 0 ? null : (
        <div className="lyra-notification-topbar-quick-actions">
          {visibleQuickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="lyra-notification-topbar-quick-action"
              data-tone={action.tone ?? "default"}
              aria-label={action.label}
              title={action.label}
              disabled={action.disabled === true}
              onClick={action.onSelect}
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className={
          preview === null
            ? "lyra-notification-topbar-entry"
            : "lyra-notification-topbar-entry lyra-notification-topbar-entry-active"
        }
        aria-label={labels.openCenter}
        disabled={!canOpenCenter}
        onClick={onOpenCenter}
      >
        <Bell size={14} />
        {unreadCount > 0 ? (
          <span className="lyra-notification-topbar-unread-dot" aria-hidden="true" />
        ) : null}
      </button>
    </section>
  );
};
