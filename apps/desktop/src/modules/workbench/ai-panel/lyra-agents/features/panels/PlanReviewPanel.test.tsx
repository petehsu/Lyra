import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AgentPlanSnapshot } from "../../../../../../shared/agent";
import { PlanReviewPanel } from "./PlanReviewPanel";

const plan: AgentPlanSnapshot = {
  activePlanId: "plan-1",
  activeVersionId: "version-1",
  projectKey: "project-1",
  title: "实现规划模式",
  phase: "reviewing",
  markdown: "# Plan",
  annotations: [],
  review: {
    status: "pending",
    summary: "计划已生成"
  },
  reason: "需要多阶段实施",
  scope: "project"
};

describe("PlanReviewPanel", () => {
  test("renders pending plan review actions", () => {
    render(
      <PlanReviewPanel
        plan={plan}
        onReview={vi.fn()}
        onRespond={vi.fn()}
      />
    );

    expect(screen.getByText("实现规划模式")).toBeTruthy();
    expect(screen.getByText("计划已生成")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Set aside/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve plan/u })).toBeTruthy();
  });

  test("routes review and decision buttons", () => {
    const onReview = vi.fn();
    const onRespond = vi.fn();

    render(
      <PlanReviewPanel
        plan={plan}
        onReview={onReview}
        onRespond={onRespond}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Review/u }));
    fireEvent.click(screen.getByRole("button", { name: /Set aside/u }));
    fireEvent.click(screen.getByRole("button", { name: /Approve plan/u }));

    expect(onReview).toHaveBeenCalledWith(plan);
    expect(onRespond).toHaveBeenNthCalledWith(1, "set_aside");
    expect(onRespond).toHaveBeenNthCalledWith(2, "approve");
  });

  test("does not render non-reviewing plans", () => {
    const { container } = render(
      <PlanReviewPanel
        plan={{ ...plan, phase: "executing_todo" }}
        onReview={vi.fn()}
        onRespond={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  test("uses revision action when reviewed plan has local changes", () => {
    const onRespond = vi.fn();
    render(
      <PlanReviewPanel
        plan={{ ...plan, review: { status: "changed", summary: "已有反馈" } }}
        onReview={vi.fn()}
        onRespond={onRespond}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Revise from feedback/u }));

    expect(onRespond).toHaveBeenCalledWith("request_revision");
  });
});
