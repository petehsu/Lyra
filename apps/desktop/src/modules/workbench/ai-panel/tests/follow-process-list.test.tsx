import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { FollowProcessList } from "../follow-process-list";
import type { AgentFollowSummary, AgentSessionDetail } from "../agent-ui-types";

describe("FollowProcessList", () => {
  test("renders nothing without summary", () => {
    const { container } = render(<FollowProcessList detail={createDetail(null)} />);

    expect(container.firstChild).toBeNull();
  });

  test("renders active target and recent events", () => {
    render(<FollowProcessList detail={createDetail(createSummary())} />);

    expect(screen.getByLabelText("Follow process")).toBeDefined();
    expect(screen.getByLabelText("Tool progress")).toBeDefined();
    expect(screen.getByText("Following")).toBeDefined();
    expect(screen.getAllByText("Patch applied").length).toBeGreaterThan(0);
    expect(screen.getByText("src/main.rs")).toBeDefined();
    expect(screen.getByText("Tests passed")).toBeDefined();
  });

  test("renders follow projection events when no summary is present yet", () => {
    render(
      <FollowProcessList
        detail={{
          ...createDetail(null),
          runtimeEvents: [{
            sessionId: "session-1",
            turnId: "turn-1",
            phase: "follow_projection_updated",
            payload: {
              operations: [{
                toolName: "write_file",
                status: "running",
                filePath: "src/generated.ts",
                startedAt: 1,
                finishedAt: null,
              }],
            },
            timestamp: 1,
          }],
        }}
      />
    );

    expect(screen.getByText("Running write_file")).toBeDefined();
    expect(screen.getByText("src/generated.ts")).toBeDefined();
  });

  test("shows compact failed command state", () => {
    render(
      <FollowProcessList
        detail={createDetail(createSummary({
          activeTarget: {
            followTargetId: "follow_target_2",
            kind: "test_report",
            title: "cargo test -p lyra-ai-core",
            status: "failed",
            toolOperationId: "op-test",
            artifactRefs: ["artifact-test"],
            evidenceRefs: ["evidence-test"],
            updatedAt: 4,
          },
          activeTargetId: "follow_target_2",
          targets: [{
            followTargetId: "follow_target_2",
            kind: "test_report",
            title: "cargo test -p lyra-ai-core",
            status: "failed",
            toolOperationId: "op-test",
            artifactRefs: ["artifact-test"],
            evidenceRefs: ["evidence-test"],
            updatedAt: 4,
          }],
          recentEvents: [{
            followEventId: "follow_event_3",
            followTargetId: "follow_target_2",
            eventType: "operation_finished",
            label: "Tests failed",
            status: "failed",
            createdAt: 4,
          }],
        }))}
      />
    );

    expect(screen.getAllByText("Tests failed").length).toBeGreaterThan(0);
    expect(screen.getByText("cargo test -p lyra-ai-core")).toBeDefined();
  });

  test("paused summary shows resume and resumed summary shows pause", async () => {
    const pauseFollow = vi.fn().mockResolvedValue(undefined);
    const resumeFollow = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <FollowProcessList
        detail={createDetail(createSummary({ status: "paused_by_user" }))}
        pauseFollow={pauseFollow}
        resumeFollow={resumeFollow}
      />
    );

    expect(screen.getByText("Following paused")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Resume following"));
    await waitFor(() => expect(resumeFollow).toHaveBeenCalledTimes(1));

    rerender(
      <FollowProcessList
        detail={createDetail(createSummary({ status: "auto_following" }))}
        pauseFollow={pauseFollow}
        resumeFollow={resumeFollow}
      />
    );

    expect(screen.getByText("Following")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Pause following"));
    await waitFor(() => expect(pauseFollow).toHaveBeenCalledTimes(1));
  });

  test("click target with workspace uri opens file callback", () => {
    const openWorkspaceUri = vi.fn();
    render(
      <FollowProcessList
        detail={createDetail(createSummary())}
        onOpenWorkspaceUri={openWorkspaceUri}
      />
    );

    fireEvent.click(screen.getByText("src/main.rs"));

    expect(openWorkspaceUri).toHaveBeenCalledWith("src/main.rs");
  });
});

const createSummary = (overrides: Partial<AgentFollowSummary> = {}): AgentFollowSummary => ({
  followSessionId: "follow_session_1",
  sessionId: "session-1",
  runtimeTurnId: "turn-1",
  longWorkRunId: "long_work_run_1",
  status: "auto_following",
  activeTargetId: "follow_target_1",
  activeTarget: {
    followTargetId: "follow_target_1",
    kind: "diff",
    title: "src/main.rs",
    resourceRef: "tool_result_1",
    workspaceUri: "src/main.rs",
    status: "completed",
    toolOperationId: "op-apply",
    artifactRefs: ["artifact-1"],
    evidenceRefs: ["evidence-1"],
    updatedAt: 3,
  },
  targets: [{
    followTargetId: "follow_target_1",
    kind: "diff",
    title: "src/main.rs",
    resourceRef: "tool_result_1",
    workspaceUri: "src/main.rs",
    status: "completed",
    toolOperationId: "op-apply",
    artifactRefs: ["artifact-1"],
    evidenceRefs: ["evidence-1"],
    updatedAt: 3,
  }],
  recentEvents: [
    {
      followEventId: "follow_event_2",
      followTargetId: "follow_target_1",
      eventType: "operation_finished",
      label: "Patch applied",
      status: "completed",
      createdAt: 3,
    },
    {
      followEventId: "follow_event_1",
      followTargetId: "follow_target_1",
      eventType: "operation_progress",
      label: "Tests passed",
      status: "completed",
      createdAt: 2,
    },
  ],
  updatedAt: 3,
  ...overrides,
});

const createDetail = (followSummary: AgentFollowSummary | null): AgentSessionDetail => ({
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
  longWorkSummary: null,
  followSummary,
});
