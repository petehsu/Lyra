import { describe, expect, test } from "vitest";

import { mapFeedbackEventToNotification } from "../feedback-adapter";
import type { WorkbenchFeedbackEvent } from "../../feedback";

const createFeedbackEvent = (
  overrides?: Partial<WorkbenchFeedbackEvent>
): WorkbenchFeedbackEvent => ({
  id: "feedback-test-id",
  code: "workbench.info",
  level: "success",
  createdAt: 1_700_000_000,
  ...overrides
});

describe("notification feedback adapter", () => {
  test("maps AI feedback into a notification without navigation target", () => {
    const notification = mapFeedbackEventToNotification(
      createFeedbackEvent({
        message: "configuration saved"
      })
    );

    expect(notification.id).toBe("feedback-feedback-test-id");
    expect(notification.level).toBe("success");
    expect(notification.target).toEqual({ kind: "none" });
  });

  test("falls back to none target when session is missing", () => {
    const notification = mapFeedbackEventToNotification(
      createFeedbackEvent({
        code: "workbench.warning",
        level: "warning",
        message: ""
      })
    );

    expect(notification.target).toEqual({ kind: "none" });
    expect(notification.preview.length).toBeGreaterThan(0);
  });
});
