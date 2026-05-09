import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { AgentSessionDetail } from "../agent-ui-types";
import { AgentTodoRail } from "../agent-todo-rail";

describe("AgentTodoRail", () => {
  test("renders the current todo step collapsed by default", () => {
    render(<AgentTodoRail detail={createDetail()} />);

    expect(screen.getByLabelText("Agent todo")).toBeDefined();
    expect(screen.getByText("Execution checklist")).toBeDefined();
    expect(screen.getByText("Apply approved workspace changes")).toBeDefined();
    expect(screen.getByText("mini · 1/3")).toBeDefined();
    expect(screen.queryByText("Inspect relevant context")).toBeNull();
  });

  test("expands to show the full todo list", () => {
    render(<AgentTodoRail detail={createDetail()} />);

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByRole("button", { expanded: true })).toBeDefined();
    expect(screen.getByText("Inspect relevant context")).toBeDefined();
    expect(screen.getByText("Record verification status")).toBeDefined();
    expect(screen.getByText("Waiting for approval")).toBeDefined();
  });

  test("renders nothing without active todo items", () => {
    const { container } = render(<AgentTodoRail detail={{ ...createDetail(), activeTodo: null }} />);

    expect(container.firstChild).toBeNull();
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
