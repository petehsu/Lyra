import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { LongWorkStatusRow } from "../long-work-status-row";
import type { AgentLongWorkSummary, AgentSessionDetail } from "../agent-ui-types";

describe("LongWorkStatusRow", () => {
  test("renders compact running status from session detail", () => {
    render(<LongWorkStatusRow detail={createDetail(createSummary({ status: "running" }))} />);

    expect(screen.getByLabelText("Long work status")).toBeDefined();
    expect(screen.getByText("Long Work")).toBeDefined();
    expect(screen.getByText("Implement ledger state")).toBeDefined();
    expect(screen.getByText("1/4 · Running")).toBeDefined();
  });

  test("renders blocked and completed states", () => {
    const { rerender } = render(
      <LongWorkStatusRow
        detail={createDetail(createSummary({
          status: "blocked",
          blockerSummary: "Waiting for approval decision",
        }))}
      />
    );

    expect(screen.getByLabelText("Blocked")).toBeDefined();
    expect(screen.getByText("1/4 · Waiting for approval decision")).toBeDefined();

    rerender(
      <LongWorkStatusRow
        detail={createDetail(createSummary({
          status: "completed",
          todoProgress: { total: 4, completed: 4, blocked: 0, failed: 0 },
        }))}
      />
    );

    expect(screen.getByLabelText("Completed")).toBeDefined();
    expect(screen.getByText("4/4 · Completed")).toBeDefined();
  });

  test("restores from a reloaded thread detail", () => {
    const { container, rerender } = render(<LongWorkStatusRow detail={null} />);

    expect(container.firstChild).toBeNull();

    rerender(<LongWorkStatusRow detail={createDetail(createSummary({ status: "completed" }))} />);

    expect(screen.getByLabelText("Long work status")).toBeDefined();
    expect(screen.getByText("1/4 · Completed")).toBeDefined();
  });
});

const createSummary = (
  overrides: Partial<AgentLongWorkSummary>
): AgentLongWorkSummary => ({
  longWorkRunId: "long_work_run_1",
  goalId: "goal_1",
  sessionId: "session-1",
  runtimeTurnId: "turn-1",
  userMessageId: "msg-1",
  todoListId: "todo_list_1",
  executionRunId: "execution_run_1",
  status: "running",
  objectiveSummary: "Implement ledger state",
  todoProgress: { total: 4, completed: 1, blocked: 0, failed: 0 },
  currentSlice: {
    workSliceId: "work_slice_1",
    status: "running",
    todoListId: "todo_list_1",
    executionRunId: "execution_run_1",
    checkpointIds: [],
    blockerIds: [],
    createdAt: 1,
    updatedAt: 2,
  },
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

const createDetail = (longWorkSummary: AgentLongWorkSummary | null): AgentSessionDetail => ({
  session: {
    id: "session-1",
    title: "Thread",
    collaborationMode: "default",
    createdAt: 1,
    updatedAt: 2,
  },
  pendingInteractions: [],
  turns: [],
  messages: [],
  runtimeEvents: [],
  activeTodo: null,
  executionSummary: null,
  verificationSummary: null,
  completionAudit: null,
  deliveryProof: null,
  longWorkSummary,
});
