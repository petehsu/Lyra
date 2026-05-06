import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { AgentSessionDetail } from "../agent-ui-types";
import { AiPlanReviewSurface } from "../plan-review-surface";

describe("AiPlanReviewSurface", () => {
  test("renders planning summary and resolves review actions", async () => {
    const user = userEvent.setup();
    const resolvePlanReview = vi.fn(async () => ({
      sessionId: "session-1",
      planId: "plan-1",
      versionId: "plan-version-1",
      status: "approved",
      detail: createDetail(),
    }));
    render(
      <AiPlanReviewSurface
        detail={createDetail()}
        resolvePlanReview={resolvePlanReview}
      />
    );

    expect(screen.getByText("Refactor runtime")).toBeDefined();
    expect(screen.getByText("v1 · Pending review")).toBeDefined();
    expect(screen.getByText("Split planning state into Rust-owned storage")).toBeDefined();
    expect(screen.getByText("Add planning tables")).toBeDefined();
    expect(screen.getByText("1 note")).toBeDefined();

    await user.type(screen.getByPlaceholderText("Add note"), "Keep bridge thin");
    await user.click(screen.getByRole("button", { name: "Note" }));
    expect(resolvePlanReview).toHaveBeenCalledWith({
      sessionId: "session-1",
      planId: "plan-1",
      versionId: "plan-version-1",
      decision: "annotate",
      annotationText: "Keep bridge thin",
    });

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(resolvePlanReview).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      planId: "plan-1",
      versionId: "plan-version-1",
      decision: "approve",
    });
  });

  test("does not render without planning summary", () => {
    const { container } = render(
      <AiPlanReviewSurface detail={{ ...createDetail(), planningSummary: null }} />
    );

    expect(container.textContent).toBe("");
  });

  test("renders approved plan coverage state", () => {
    render(
      <AiPlanReviewSurface
        detail={{
          ...createDetail(),
          planningSummary: {
            ...createDetail().planningSummary!,
            status: "approved",
            panelStatus: "approved",
          },
          planCoverageSummary: {
            coverageId: "coverage-1",
            sessionId: "session-1",
            runtimeTurnId: "turn-1",
            planId: "plan-1",
            approvedVersionId: "plan-version-1",
            todoListId: "todo-list-1",
            executionRunId: "execution-run-1",
            status: "valid",
            coveredPlanStepIds: ["step-1", "step-2"],
            missingPlanStepIds: [],
            extraTodoItemIds: [],
            riskMismatches: [],
            verificationGaps: [],
            missingReferenceIds: [],
            mismatchedReferenceIds: [],
            createdAt: 1,
            updatedAt: 2,
          },
        }}
      />
    );

    expect(screen.getByText("v1 · Approved · Coverage valid")).toBeDefined();
    expect(screen.getByText("Coverage valid")).toBeDefined();
    expect(screen.getByText("2 steps mapped to Todo")).toBeDefined();
  });

  test("renders blocked plan coverage reason", () => {
    render(
      <AiPlanReviewSurface
        detail={{
          ...createDetail(),
          planningSummary: {
            ...createDetail().planningSummary!,
            status: "approved",
            panelStatus: "approved",
          },
          planCoverageSummary: {
            coverageId: "coverage-2",
            sessionId: "session-1",
            runtimeTurnId: "turn-1",
            planId: "plan-1",
            approvedVersionId: "plan-version-1",
            status: "reference_missing",
            coveredPlanStepIds: ["step-1"],
            missingPlanStepIds: [],
            extraTodoItemIds: [],
            riskMismatches: [],
            verificationGaps: [],
            missingReferenceIds: ["step-1"],
            mismatchedReferenceIds: [],
            createdAt: 1,
            updatedAt: 2,
          },
        }}
      />
    );

    expect(
      screen.getByText("v1 · Approved · Coverage blocked · missing references")
    ).toBeDefined();
    expect(screen.getByText("Coverage blocked")).toBeDefined();
    expect(screen.getByText("Missing refs step-1")).toBeDefined();
  });
});

const createDetail = (): AgentSessionDetail => ({
  session: {
    id: "session-1",
    title: "Project",
    profileId: "profile-1",
    projectRoot: "/repo",
    projectName: "repo",
    collaborationMode: "plan",
    createdAt: 1,
    updatedAt: 2,
  },
  pendingInteractions: [],
  turns: [],
  messages: [],
  runtimeEvents: [],
  planningSummary: {
    planId: "plan-1",
    sessionId: "session-1",
    runtimeTurnId: "turn-1",
    status: "pending_review",
    title: "Refactor runtime",
    objectiveSummary: "Split planning state into Rust-owned storage",
    source: {},
    activeVersionId: "plan-version-1",
    panelId: "plan-panel-1",
    panelStatus: "pending_review",
    versionNumber: 1,
    version: {
      steps: [
        { id: "step-1", title: "Add planning tables", detail: "Rust storage" },
        { id: "step-2", title: "Render review UI" },
      ],
    },
    annotations: [
      {
        annotationId: "annotation-1",
        panelId: "plan-panel-1",
        anchor: "plan",
        note: "Preserve Rust-first boundary",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  },
});
