import { describe, expect, test } from "vitest";

import { mapFeedbackEventToNotification } from "../feedback-adapter";
import type { WorkbenchFeedbackEvent } from "../../feedback";

const createFeedbackEvent = (
  overrides?: Partial<WorkbenchFeedbackEvent>
): WorkbenchFeedbackEvent => ({
  id: "feedback-test-id",
  code: "ai.runtime.approval.accepted",
  level: "success",
  createdAt: 1_700_000_000,
  ...overrides
});

describe("notification feedback adapter", () => {
  test("maps session scoped feedback into app-tab target", () => {
    const notification = mapFeedbackEventToNotification(
      createFeedbackEvent({
        sessionId: "ai-session-1",
        message: "approval accepted"
      })
    );

    expect(notification.id).toBe("feedback-feedback-test-id");
    expect(notification.level).toBe("success");
    expect(notification.target).toEqual({
      kind: "app-tab",
      appId: "ai-panel",
      appInstanceId: "ai-session-1",
      title: "AI 面板",
      iconKey: "ai-panel-default"
    });
  });

  test("falls back to none target when session is missing", () => {
    const notification = mapFeedbackEventToNotification(
      createFeedbackEvent({
        code: "ai.runtime.timeout",
        level: "warning",
        message: ""
      })
    );

    expect(notification.target).toEqual({ kind: "none" });
    expect(notification.preview.length).toBeGreaterThan(0);
  });
});
