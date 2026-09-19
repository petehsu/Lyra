import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { USER_GATE_IDLE_MS, UserGateHost } from "./UserGateHost";
import type { DecisionQuestion } from "../../core/types";

const question: DecisionQuestion = {
  id: "clar-1",
  question: "Which style?",
  options: [{ value: "brief", label: "Brief" }],
  allowCustomAnswer: false,
  detail: null,
  sessionId: "session-1"
};

describe("UserGateHost", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders the clarification card as a single host surface", () => {
    render(
      <UserGateHost
        sessionId="session-1"
        permissionMode="approval"
        showDecisions
        showPermission
        decisions={[question]}
        permissions={[]}
        planReview={null}
        onSubmitDecisions={vi.fn()}
        onApprovePermission={vi.fn()}
        onDenyPermission={vi.fn()}
        onOpenPlanReview={vi.fn()}
        onRespondPlanReview={vi.fn()}
      />
    );
    expect(screen.getByText("Which style?")).toBeTruthy();
    expect(document.querySelector("[data-user-gate-count='1']")).not.toBeNull();
  });

  test("auto-resolves after 10s idle only in autonomous mode", async () => {
    vi.useFakeTimers();
    const autoResolve = vi.fn(async () => undefined);
    render(
      <UserGateHost
        sessionId="session-1"
        permissionMode="autonomous"
        showDecisions
        showPermission
        decisions={[question]}
        permissions={[]}
        planReview={null}
        onSubmitDecisions={vi.fn()}
        onApprovePermission={vi.fn()}
        onDenyPermission={vi.fn()}
        onOpenPlanReview={vi.fn()}
        onRespondPlanReview={vi.fn()}
        autoResolve={autoResolve}
      />
    );
    await act(async () => {
      vi.advanceTimersByTime(USER_GATE_IDLE_MS - 1);
    });
    expect(autoResolve).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(autoResolve).toHaveBeenCalledWith({ gateId: "clar-1" });
  });

  test("does not auto-resolve in managed full_auto", async () => {
    vi.useFakeTimers();
    const autoResolve = vi.fn(async () => undefined);
    render(
      <UserGateHost
        sessionId="session-1"
        permissionMode="full_auto"
        showDecisions
        showPermission
        decisions={[question]}
        permissions={[]}
        planReview={null}
        onSubmitDecisions={vi.fn()}
        onApprovePermission={vi.fn()}
        onDenyPermission={vi.fn()}
        onOpenPlanReview={vi.fn()}
        onRespondPlanReview={vi.fn()}
        autoResolve={autoResolve}
      />
    );
    await act(async () => {
      vi.advanceTimersByTime(USER_GATE_IDLE_MS + 1000);
    });
    expect(autoResolve).not.toHaveBeenCalled();
  });

  test("activity on the host resets the 10s idle clock", async () => {
    vi.useFakeTimers();
    const autoResolve = vi.fn(async () => undefined);
    const { container } = render(
      <UserGateHost
        sessionId="session-1"
        permissionMode="autonomous"
        showDecisions
        showPermission
        decisions={[question]}
        permissions={[]}
        planReview={null}
        onSubmitDecisions={vi.fn()}
        onApprovePermission={vi.fn()}
        onDenyPermission={vi.fn()}
        onOpenPlanReview={vi.fn()}
        onRespondPlanReview={vi.fn()}
        autoResolve={autoResolve}
      />
    );
    const host = container.querySelector(".lyra-agents-user-gate-host");
    expect(host).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(USER_GATE_IDLE_MS - 1);
    });
    host?.dispatchEvent(new Event("keydown", { bubbles: true }));
    await act(async () => {
      vi.advanceTimersByTime(USER_GATE_IDLE_MS - 1);
    });
    expect(autoResolve).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(autoResolve).toHaveBeenCalledWith({ gateId: "clar-1" });
  });
});
