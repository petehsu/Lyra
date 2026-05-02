import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import {
  WorkbenchNotificationTopbar,
  type WorkbenchNotificationTopbarQuickAction
} from "../topbar";
import type { WorkbenchNotificationItem } from "../types";

const createPreviewNotification = (): WorkbenchNotificationItem => ({
  id: "notification-1",
  title: "Build complete",
  preview: "Desktop build finished",
  level: "success",
  source: {
    id: "system",
    title: "System",
    iconKey: "system"
  },
  target: {
    kind: "none"
  },
  createdAt: 1_700_000_000_000
});

const createQuickAction = (
  index: number,
  onSelect = vi.fn()
): WorkbenchNotificationTopbarQuickAction => ({
  id: `action-${index}`,
  label: `Action ${index}`,
  icon: <span aria-hidden="true">{index}</span>,
  onSelect
});

describe("WorkbenchNotificationTopbar", () => {
  test("renders at most four quick actions for a preview notification", () => {
    const onSelect = vi.fn();
    const actions = [
      createQuickAction(1),
      createQuickAction(2, onSelect),
      createQuickAction(3),
      createQuickAction(4),
      createQuickAction(5)
    ];

    render(
      <WorkbenchNotificationTopbar
        labels={{
          openCenter: "Open center",
          openPreview: "Open preview"
        }}
        notificationCount={1}
        unreadCount={1}
        preview={createPreviewNotification()}
        quickActions={actions}
        onOpenCenter={vi.fn()}
        onOpenPreview={vi.fn()}
      />
    );

    const topbar = screen.getByLabelText("notification-topbar");
    expect(within(topbar).getByRole("button", { name: "Action 1" })).toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "Action 4" })).toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "Action 5" })).toBeNull();

    fireEvent.click(within(topbar).getByRole("button", { name: "Action 2" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("does not reserve quick action slots when no preview is visible", () => {
    render(
      <WorkbenchNotificationTopbar
        labels={{
          openCenter: "Open center",
          openPreview: "Open preview"
        }}
        notificationCount={0}
        unreadCount={0}
        preview={null}
        quickActions={[createQuickAction(1)]}
        onOpenCenter={vi.fn()}
        onOpenPreview={vi.fn()}
      />
    );

    const topbar = screen.getByLabelText("notification-topbar");
    expect(within(topbar).queryByRole("button", { name: "Action 1" })).toBeNull();
    expect(within(topbar).getByRole("button", { name: "Open center" })).toBeDisabled();
  });

  test("keeps the center button enabled when read notifications still exist", () => {
    const onOpenCenter = vi.fn();

    render(
      <WorkbenchNotificationTopbar
        labels={{
          openCenter: "Open center",
          openPreview: "Open preview"
        }}
        notificationCount={2}
        unreadCount={0}
        preview={null}
        onOpenCenter={onOpenCenter}
        onOpenPreview={vi.fn()}
      />
    );

    const openCenterButton = within(screen.getByLabelText("notification-topbar")).getByRole(
      "button",
      { name: "Open center" }
    );
    expect(openCenterButton).toBeEnabled();

    fireEvent.click(openCenterButton);
    expect(onOpenCenter).toHaveBeenCalledTimes(1);
  });
});
