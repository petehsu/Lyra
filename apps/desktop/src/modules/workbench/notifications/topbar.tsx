import { Bell } from "lucide-react";

import { renderNotificationSourceIcon } from "./icon-registry";
import type { NotificationTopbarLabels, WorkbenchNotificationItem } from "./types";

type WorkbenchNotificationTopbarProps = {
  readonly labels: NotificationTopbarLabels;
  readonly unreadCount: number;
  readonly preview: WorkbenchNotificationItem | null;
  readonly onOpenCenter: () => void;
  readonly onOpenPreview: () => void;
};

export const WorkbenchNotificationTopbar = ({
  labels,
  unreadCount,
  preview,
  onOpenCenter,
  onOpenPreview
}: WorkbenchNotificationTopbarProps) => {
  const previewText = preview === null
    ? ""
    : `${preview.source.title} · ${preview.preview}`;

  return (
    <section className="lyra-notification-topbar" aria-label="notification-topbar">
      <button
        type="button"
        className={
          preview === null
            ? "lyra-notification-topbar-entry"
            : "lyra-notification-topbar-entry lyra-notification-topbar-entry-active"
        }
        aria-label={labels.openCenter}
        onClick={onOpenCenter}
      >
        <Bell size={14} />
        {unreadCount > 0 ? (
          <span className="lyra-notification-topbar-unread-dot" aria-hidden="true" />
        ) : null}
      </button>

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
    </section>
  );
};
