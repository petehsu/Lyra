import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { AgentSessionDetail } from "../agent-ui-types";
import { ExecutionTodoList } from "../execution-todo-list";

describe("ExecutionTodoList", () => {
  test("renders compact todo status from session detail", () => {
    render(<ExecutionTodoList detail={createDetail()} />);

    expect(screen.getByText("Execution checklist")).toBeDefined();
    expect(screen.getByText("mini · 1/3")).toBeDefined();
    expect(screen.getByText("Inspect relevant context")).toBeDefined();
    expect(screen.getByText("Apply approved workspace changes")).toBeDefined();
    expect(screen.getByText("Waiting for approval")).toBeDefined();
    expect(screen.getByLabelText("Completed")).toBeDefined();
    expect(screen.getByLabelText("Blocked")).toBeDefined();
  });

  test("does not render without active todo", () => {
    const { container } = render(<ExecutionTodoList detail={{ ...createDetail(), activeTodo: null }} />);

    expect(container.textContent).toBe("");
  });

  test("renders plan-bound coverage state", () => {
    render(<ExecutionTodoList detail={createPlanBoundDetail()} />);

    expect(screen.getByText("Plan: Refactor runtime")).toBeDefined();
    expect(screen.getByText("plan_bound · coverage valid · 0/2")).toBeDefined();
    expect(screen.getByText("Add planning tables")).toBeDefined();
  });
});

const createDetail = (): AgentSessionDetail => ({
  session: {
    id: "session-1",
    title: "Project",
    profileId: "profile-1",
    projectRoot: "/repo",
    projectName: "repo",
    collaborationMode: "default",
    createdAt: 1,
    updatedAt: 2,
  },
  pendingInteractions: [],
  turns: [],
  messages: [],
  runtimeEvents: [],
  activeTodo: {
    todoListId: "todo-list-1",
    sessionId: "session-1",
    runtimeTurnId: "turn-1",
    kind: "mini",
    status: "blocked",
    title: "Execution checklist",
    source: {},
    items: [
      {
        todoItemId: "todo-item-1",
        todoListId: "todo-list-1",
        status: "completed",
        title: "Inspect relevant context",
        actions: [],
        expectedTools: ["/tools/filesystem/read_file"],
        riskLevel: "low",
        completionCriteria: [],
        evidenceRefs: ["evidence-1"],
        blockers: [],
        source: {},
        createdAt: 1,
        updatedAt: 2,
      },
      {
        todoItemId: "todo-item-2",
        todoListId: "todo-list-1",
        status: "blocked",
        title: "Apply approved workspace changes",
        actions: [],
        expectedTools: ["/tools/filesystem/apply_patch"],
        riskLevel: "medium",
        completionCriteria: [],
        evidenceRefs: [],
        blockers: [{ kind: "approval_required", approvalTicketId: "approval-1" }],
        source: {},
        createdAt: 1,
        updatedAt: 2,
      },
      {
        todoItemId: "todo-item-3",
        todoListId: "todo-list-1",
        status: "pending",
        title: "Record verification status",
        actions: [],
        expectedTools: [],
        riskLevel: "low",
        completionCriteria: [],
        evidenceRefs: [],
        blockers: [],
        source: {},
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  },
  executionSummary: {
    executionRunId: "execution-run-1",
    sessionId: "session-1",
    runtimeTurnId: "turn-1",
    todoListId: "todo-list-1",
    status: "blocked",
    stepCount: 2,
    completedStepCount: 1,
    failedStepCount: 0,
    blockedStepCount: 1,
    updatedAt: 2,
  },
});

const createPlanBoundDetail = (): AgentSessionDetail => ({
  ...createDetail(),
  activeTodo: {
    todoListId: "todo-list-plan",
    sessionId: "session-1",
    runtimeTurnId: "turn-1",
    kind: "plan_bound",
    status: "active",
    title: "Plan: Refactor runtime",
    source: { planId: "plan-1", approvedVersionId: "plan-version-1" },
    items: [
      {
        todoItemId: "todo-item-plan-1",
        todoListId: "todo-list-plan",
        status: "pending",
        title: "Add planning tables",
        actions: [],
        expectedTools: [],
        riskLevel: "medium",
        completionCriteria: [],
        evidenceRefs: [],
        blockers: [],
        source: { planStepId: "step-1" },
        createdAt: 1,
        updatedAt: 2,
      },
      {
        todoItemId: "todo-item-plan-2",
        todoListId: "todo-list-plan",
        status: "pending",
        title: "Render review UI",
        actions: [],
        expectedTools: [],
        riskLevel: "medium",
        completionCriteria: [],
        evidenceRefs: [],
        blockers: [],
        source: { planStepId: "step-2" },
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  },
  executionSummary: {
    executionRunId: "execution-run-plan",
    sessionId: "session-1",
    runtimeTurnId: "turn-1",
    todoListId: "todo-list-plan",
    status: "running",
    stepCount: 0,
    completedStepCount: 0,
    failedStepCount: 0,
    blockedStepCount: 0,
    updatedAt: 2,
  },
  planCoverageSummary: {
    coverageId: "coverage-1",
    sessionId: "session-1",
    runtimeTurnId: "turn-1",
    planId: "plan-1",
    approvedVersionId: "plan-version-1",
    todoListId: "todo-list-plan",
    executionRunId: "execution-run-plan",
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
});
