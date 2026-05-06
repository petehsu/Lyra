import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { AgentSessionDetail } from "../agent-ui-types";
import { PatchReviewStrip } from "../patch-review-strip";

describe("PatchReviewStrip", () => {
  test("renders the latest patch proposal summary and selects it", async () => {
    const onSelectPatch = vi.fn();
    render(
      <PatchReviewStrip
        detail={createDetail()}
        expandedPatchKey={null}
        onSelectPatch={onSelectPatch}
      />
    );

    expect(screen.getByText("1 file changed · +2 -1")).toBeDefined();
    expect(screen.getByText("Preview only")).toBeDefined();
    await userEvent.click(screen.getByRole("button"));
    expect(onSelectPatch).toHaveBeenCalledWith("session-1:artifact_patch_2:3");
  });

  test("filters applied proposals and shows the latest pending patch", async () => {
    const onSelectPatch = vi.fn();
    render(
      <PatchReviewStrip
        detail={createDetailWithLatestApplied()}
        expandedPatchKey={null}
        onSelectPatch={onSelectPatch}
      />
    );

    expect(screen.getByText("1 file changed · +1 -0")).toBeDefined();
    await userEvent.click(screen.getByRole("button"));
    expect(onSelectPatch).toHaveBeenCalledWith("session-1:artifact_patch_1:2");
  });

  test("filters denied proposals", () => {
    render(
      <PatchReviewStrip
        detail={createDetailWithLatestDenied()}
        expandedPatchKey={null}
        onSelectPatch={vi.fn()}
      />
    );

    expect(screen.queryByText("1 file changed · +2 -1")).toBeNull();
    expect(screen.getByText("1 file changed · +1 -0")).toBeDefined();
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
    updatedAt: 3,
  },
  pendingInteractions: [],
  turns: [],
  messages: [],
  runtimeEvents: [
    {
      sessionId: "session-1",
      turnId: "turn-1",
      phase: "tool_operation_completed",
      payload: {
        operation: { path: "/tools/filesystem/propose_patch" },
        result: {
          artifactId: "artifact_patch_1",
          patchRef: "tool_result_patch_1",
          changedFiles: [{ path: "README.md", changeType: "modified", additions: 1, deletions: 0 }],
        },
      },
      timestamp: 2,
    },
    {
      sessionId: "session-1",
      turnId: "turn-2",
      phase: "tool_operation_completed",
      payload: {
        operation: { path: "/tools/filesystem/propose_patch" },
        result: {
          artifactId: "artifact_patch_2",
          patchRef: "tool_result_patch_2",
          changedFiles: [{ path: "src/lib.rs", changeType: "modified", additions: 2, deletions: 1 }],
        },
      },
      timestamp: 3,
    },
  ],
});

const createDetailWithLatestApplied = (): AgentSessionDetail => ({
  ...createDetail(),
  runtimeEvents: [
    ...createDetail().runtimeEvents,
    {
      sessionId: "session-1",
      turnId: "turn-2",
      phase: "tool_operation_completed",
      payload: {
        operation: { path: "/tools/filesystem/apply_patch" },
        result: {
          status: "applied",
          artifactId: "artifact_applied_2",
          appliedFromArtifactId: "artifact_patch_2",
          patchRef: "tool_result_patch_2",
          changedFiles: [{ path: "src/lib.rs", changeType: "modified", additions: 2, deletions: 1 }],
        },
      },
      timestamp: 4,
    },
  ],
});

const createDetailWithLatestDenied = (): AgentSessionDetail => ({
  ...createDetail(),
  runtimeEvents: [
    ...createDetail().runtimeEvents,
    {
      sessionId: "session-1",
      turnId: "turn-2",
      phase: "approval_ticket_resolved",
      payload: {
        status: "denied",
        toolPath: "/tools/filesystem/apply_patch",
        approvalTicketId: "approval-2",
        artifactId: "artifact_patch_2",
        patchRef: "tool_result_patch_2",
      },
      timestamp: 4,
    },
  ],
});
