import { afterEach, describe, expect, test, vi } from "vitest";

import { createWorkbenchWebActionDeadlineExecutor } from "../service-modules/action-deadline";

const makeError = (...args: any[]) =>
  Object.assign(new Error(String(args[1] ?? "error")), {
    code: args[0],
    details: args[4]?.details
  });

describe("action deadline executor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("passes through successful execution result", async () => {
    const expected = { ok: true } as any;
    const { executeWebActionWithDeadline } = createWorkbenchWebActionDeadlineExecutor({
      executeWebAction: async () => expected,
      createWebAutomationError: makeError,
      actionTimeoutHoverMs: 30,
      actionTimeoutSafeMs: 40,
      actionTimeoutMutateMs: 50,
      actionTimeoutNavigateMs: 60
    });

    const result = await executeWebActionWithDeadline({
      request: {
        action: { kind: "hover" }
      }
    });

    expect(result).toBe(expected);
  });

  test("times out and reports clamped minimum timeout", async () => {
    vi.useFakeTimers();
    const createWebAutomationError = vi.fn(makeError);
    const { executeWebActionWithDeadline } = createWorkbenchWebActionDeadlineExecutor({
      executeWebAction: async () => await new Promise<never>(() => undefined),
      createWebAutomationError,
      actionTimeoutHoverMs: 30,
      actionTimeoutSafeMs: 40,
      actionTimeoutMutateMs: 50,
      actionTimeoutNavigateMs: 60
    });

    const pending = executeWebActionWithDeadline({
      request: {
        action: { kind: "click" },
        timeoutMs: 10
      }
    });
    const expectation = expect(pending).rejects.toMatchObject({
      code: "script_execution_failed",
      details: {
        timeoutMs: 250,
        actionKind: "click"
      }
    });

    await vi.advanceTimersByTimeAsync(250);

    await expectation;
    expect(createWebAutomationError).toHaveBeenCalledTimes(1);
  });

  test("extends navigation timeout using waitForNavigationMs", async () => {
    vi.useFakeTimers();
    const createWebAutomationError = vi.fn(makeError);
    const { executeWebActionWithDeadline } = createWorkbenchWebActionDeadlineExecutor({
      executeWebAction: async () => await new Promise<never>(() => undefined),
      createWebAutomationError,
      actionTimeoutHoverMs: 10,
      actionTimeoutSafeMs: 20,
      actionTimeoutMutateMs: 30,
      actionTimeoutNavigateMs: 100
    });

    const pending = executeWebActionWithDeadline({
      request: {
        action: { kind: "goto_url", address: "https://example.com" },
        constraints: {
          waitForNavigationMs: 500
        }
      }
    });
    const expectation = expect(pending).rejects.toMatchObject({
      details: {
        timeoutMs: 1_700,
        actionKind: "goto_url"
      }
    });

    await vi.advanceTimersByTimeAsync(1_699);
    expect(createWebAutomationError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expectation;
  });
});
