import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useWorkbenchFeedbackModel, type WorkbenchFeedbackEvent } from "..";

describe("workbench feedback service", () => {
  test("publishes feedback events to subscribers", () => {
    const { result } = renderHook(() => useWorkbenchFeedbackModel());
    const received: WorkbenchFeedbackEvent[] = [];

    const unsubscribe = result.current.subscribe((event) => {
      received.push(event);
      expect(event.id.length).toBeGreaterThan(0);
      expect(Number.isFinite(event.createdAt)).toBe(true);
    });

    act(() => {
      result.current.publishFeedback({
        code: "ai.runtime.approval.accepted",
        level: "success",
        sessionId: "session-1",
        runtimeItemId: "runtime-1"
      });
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      code: "ai.runtime.approval.accepted",
      sessionId: "session-1",
      runtimeItemId: "runtime-1"
    });

    unsubscribe();
  });

  test("stops dispatching after unsubscribe", () => {
    const { result } = renderHook(() => useWorkbenchFeedbackModel());
    const received: string[] = [];

    const unsubscribe = result.current.subscribe((event) => {
      received.push(event.code);
    });

    act(() => {
      result.current.publishFeedback({
        code: "ai.runtime.approval.undo",
        level: "info"
      });
    });

    unsubscribe();

    act(() => {
      result.current.publishFeedback({
        code: "ai.runtime.approval.rejected",
        level: "warning"
      });
    });

    expect(received).toEqual(["ai.runtime.approval.undo"]);
  });
});
