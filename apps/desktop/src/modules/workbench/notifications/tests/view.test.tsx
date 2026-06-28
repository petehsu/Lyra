import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { NotificationCenterSurface } from "../view";
import type { NotificationCenterLabels, WorkbenchNotificationItem } from "../types";

const labels: NotificationCenterLabels = {
  title: "Notification Center",
  listTitle: "Notification list",
  emptyTitle: "No notifications",
  markAllRead: "Mark all as read",
  clearAll: "Clear all",
  openSource: "Open source",
  sourceFallback: "No jump target available",
  unread: "Unread"
};

const createNotification = (
  id: string,
  overrides: Partial<WorkbenchNotificationItem> = {}
): WorkbenchNotificationItem => ({
  id,
  title: `Notification ${id}`,
  preview: `Preview ${id}`,
  body: `Body ${id}`,
  level: "info",
  source: {
    id: "system",
    title: "System",
    iconKey: "system"
  },
  target: {
    kind: "app-tab",
    appId: "software-store",
    appInstanceId: "software-store"
  },
  createdAt: 1_700_000_000_000,
  ...overrides
});

describe("NotificationCenterSurface", () => {
  test("renders the empty state in both panes", () => {
    render(
      <NotificationCenterSurface
        labels={labels}
        notifications={[]}
        selectedNotificationId={null}
        onSelectNotification={vi.fn()}
        onMarkAllRead={vi.fn()}
        onClearAll={vi.fn()}
        onOpenNotificationSource={vi.fn()}
      />
    );

    expect(screen.getAllByText("No notifications")).toHaveLength(2);
    expect(screen.queryByText("Important updates and app activity will appear here.")).toBeNull();
  });

  test("uses quiet rows, unread dots, and preserves selection/open behavior", () => {
    const onSelectNotification = vi.fn();
    const onOpenNotificationSource = vi.fn();
    render(
      <NotificationCenterSurface
        labels={labels}
        notifications={[
          createNotification("one"),
          createNotification("two", { readAt: 1_700_000_100_000 })
        ]}
        selectedNotificationId="two"
        onSelectNotification={onSelectNotification}
        onMarkAllRead={vi.fn()}
        onClearAll={vi.fn()}
        onOpenNotificationSource={onOpenNotificationSource}
      />
    );

    const firstRow = screen.getByRole("button", { name: /Notification one/ });
    expect(firstRow).toHaveClass("lyra-app-object-row", "lyra-notification-center-item-unread");
    expect(firstRow).not.toHaveTextContent("Unread");
    expect(firstRow.querySelector(".lyra-app-object-row-meta")).toBeNull();

    fireEvent.click(firstRow);
    expect(onSelectNotification).toHaveBeenCalledWith("one");

    const detail = screen.getByLabelText("notification-center-detail");
    expect(within(detail).getByText("Notification two")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open source" }));
    expect(onOpenNotificationSource).toHaveBeenCalledWith("two");
  });
});
