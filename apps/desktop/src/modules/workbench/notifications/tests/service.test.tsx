import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { useWorkbenchNotificationModel } from "../service";
import type { WorkbenchNotificationPublishRequest } from "../types";
import { resetWorkbenchStateStorageForTests } from "../../state-storage";

const createRequest = (
  index: number,
  overrides?: Partial<WorkbenchNotificationPublishRequest>
): WorkbenchNotificationPublishRequest => ({
  title: `Notification ${index}`,
  preview: `Preview ${index}`,
  level: "info",
  source: {
    id: "test-source",
    title: "Test Source",
    iconKey: "notification"
  },
  target: {
    kind: "none"
  },
  ...overrides
});

describe("workbench notification model", () => {
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
    vi.useRealTimers();
  });

  test("publishes notifications and clamps to latest 200 entries", () => {
    const { result } = renderHook(() => useWorkbenchNotificationModel());

    act(() => {
      for (let index = 1; index <= 205; index += 1) {
        result.current.publishNotification(createRequest(index));
      }
    });

    expect(result.current.notifications).toHaveLength(200);
    expect(result.current.notifications[0]?.title).toBe("Notification 205");
    expect(result.current.notifications.at(-1)?.title).toBe("Notification 6");
    expect(result.current.unreadCount).toBe(200);
  });

  test("marks notification as read when selected", () => {
    const { result } = renderHook(() => useWorkbenchNotificationModel());

    act(() => {
      result.current.publishNotification(createRequest(1));
      result.current.publishNotification(createRequest(2));
    });

    const targetId = result.current.notifications[1]?.id;
    expect(targetId).toBeDefined();

    act(() => {
      result.current.selectNotification(targetId!);
    });

    const selected = result.current.notifications.find((item) => item.id === targetId);
    expect(selected?.readAt).toBeTypeOf("number");
    expect(result.current.unreadCount).toBe(1);
  });

  test("auto-hides topbar preview after timeout", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkbenchNotificationModel());

    act(() => {
      result.current.publishNotification(createRequest(1));
    });

    expect(result.current.topbarPreview).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.topbarPreview).toBeNull();
  });

  test("restores persisted snapshot from workbench state storage", () => {
    const first = renderHook(() => useWorkbenchNotificationModel());

    act(() => {
      first.result.current.publishNotification(
        createRequest(7, {
          source: {
            id: "persisted",
            title: "Persisted",
            iconKey: "system"
          }
        })
      );
    });

    first.unmount();

    const second = renderHook(() => useWorkbenchNotificationModel());
    expect(second.result.current.notifications).toHaveLength(1);
    expect(second.result.current.notifications[0]?.title).toBe("Notification 7");
    expect(second.result.current.topbarPreview).toBeNull();
  });
});
