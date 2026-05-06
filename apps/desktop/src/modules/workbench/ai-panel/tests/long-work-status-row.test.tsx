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

  test("renders queued and resuming continuation state compactly", () => {
    const { rerender } = render(
      <LongWorkStatusRow
        detail={createDetail(createSummary({
          continuation: {
            continuationId: "continuation_1",
            status: "queued",
            recommendedAction: "auto_continue",
            previousSliceId: "work_slice_1",
            nextSliceSequence: 2,
            reasonSummary: "Verification or evidence is still missing",
            createdAt: 2,
            updatedAt: 3,
          },
          currentSlice: {
            workSliceId: "work_slice_1",
            status: "continuation_queued",
            sequence: 1,
            todoListId: "todo_list_1",
            executionRunId: "execution_run_1",
            stopCause: "completion_candidate",
            checkpointIds: [],
            blockerIds: [],
            createdAt: 1,
            updatedAt: 2,
          },
        }))}
      />
    );

    expect(screen.getByText("1/4 · Slice 1 · 1/3 auto resumes · Verification or evidence is still missing")).toBeDefined();

    rerender(
      <LongWorkStatusRow
        detail={createDetail(createSummary({
          status: "auto_resuming",
          continuation: {
            continuationId: "continuation_1",
            status: "resuming",
            recommendedAction: "auto_continue",
            previousSliceId: "work_slice_1",
            nextSliceSequence: 2,
            createdAt: 2,
            updatedAt: 3,
          },
          currentSlice: {
            workSliceId: "work_slice_2",
            status: "running",
            sequence: 2,
            todoListId: "todo_list_1",
            executionRunId: "execution_run_1",
            checkpointIds: [],
            blockerIds: [],
            createdAt: 3,
            updatedAt: 4,
          },
        }))}
      />
    );

    expect(screen.getByText("1/4 · Slice 2 · Auto resuming")).toBeDefined();
  });

  test("renders stuck state compactly", () => {
    render(
      <LongWorkStatusRow
        detail={createDetail(createSummary({
          status: "stuck",
          stuck: {
            stuckReportId: "stuck_report_1",
            repeatedFailureCount: 2,
            noProgressSliceCount: 0,
            suspectedCause: "same_tool_failure",
            recommendedAction: "stop_with_report",
            evidenceRefs: [],
            reasonSummary: "Repeated same tool failure",
            createdAt: 4,
          },
          currentSlice: {
            workSliceId: "work_slice_2",
            status: "stuck",
            sequence: 2,
            todoListId: "todo_list_1",
            executionRunId: "execution_run_1",
            stopCause: "tool_failure",
            checkpointIds: [],
            blockerIds: [],
            createdAt: 3,
            updatedAt: 4,
          },
        }))}
      />
    );

    expect(screen.getByLabelText("Stuck")).toBeDefined();
    expect(screen.getByText("1/4 · Slice 2 · Repeated same tool failure")).toBeDefined();
  });

  test("restores from a reloaded thread detail", () => {
    const { container, rerender } = render(<LongWorkStatusRow detail={null} />);

    expect(container.firstChild).toBeNull();

    rerender(<LongWorkStatusRow detail={createDetail(createSummary({ status: "completed" }))} />);

    expect(screen.getByLabelText("Long work status")).toBeDefined();
    expect(screen.getByText("1/4 · Completed")).toBeDefined();

    rerender(
      <LongWorkStatusRow
        detail={createDetail(createSummary({
          continuation: {
            continuationId: "continuation_2",
            status: "queued",
            recommendedAction: "auto_continue",
            previousSliceId: "work_slice_1",
            nextSliceSequence: 2,
            reasonSummary: "Todo items remain open",
            createdAt: 2,
            updatedAt: 3,
          },
        }))}
      />
    );

    expect(screen.getByText("1/4 · 1/3 auto resumes · Todo items remain open")).toBeDefined();
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
