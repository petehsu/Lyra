import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { AgentSessionDetail } from "../agent-ui-types";
import { AiPanelThreadView } from "../thread-view";

describe("AiPanelThreadView", () => {
  test("renders compact read-only tool events in the thread timeline", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createDetail()}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
      />
    );

    expect(screen.getByText("Inspect README")).toBeDefined();
    expect(screen.getByText("Read /tools/filesystem/read_file")).toBeDefined();
    expect(screen.getByText("tool_result_1 · truncated · 128 bytes")).toBeDefined();
    expect(screen.getByText("Done.")).toBeDefined();
  });

  test("renders patch proposal refs and changed file summary", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createPatchDetail()}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
      />
    );

    expect(screen.getByText("Proposed patch for 1 file")).toBeDefined();
    expect(screen.getByText("1 file changed · +1 -0 · Preview only · Not applied or tested")).toBeDefined();
    expect(screen.getByText("README.md +1 -0")).toBeDefined();
    expect(screen.getByText("tool_result_patch · artifact artifact_patch_1")).toBeDefined();
    expect(screen.queryByText("Apply")).toBeNull();
    expect(screen.queryByText("Accept")).toBeNull();
    expect(screen.queryByText("Reject")).toBeNull();
  });

  test("loads and renders expanded patch diff preview", async () => {
    const readArtifact = vi.fn(async () => ({
      kind: "diff",
      artifactId: "artifact_patch_1",
      evidenceId: "evidence_patch_1",
      patchRef: "tool_result_patch",
      title: "Update README",
      content: "--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # Demo\n+Preview line\n",
      contentSha256: "a".repeat(64),
      contentBytes: 82,
      changedFiles: [
        {
          path: "README.md",
          changeType: "modified",
          additions: 1,
          deletions: 0,
        },
      ],
      createdAt: 2,
    }));
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createPatchDetail()}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
        expandedPatchKey="session-1:artifact_patch_1:2"
        readArtifact={readArtifact}
      />
    );

    expect(await screen.findByText("Preview line")).toBeDefined();
    expect(screen.getByText("@@ -1 +1,2 @@")).toBeDefined();
    expect(readArtifact).toHaveBeenCalledWith({
      sessionId: "session-1",
      artifactId: "artifact_patch_1",
    });
  });

  test("applies an expanded patch preview through the desktop API", async () => {
    const user = userEvent.setup();
    const applyPatch = vi.fn(async () => ({
      sessionId: "session-1",
      turnId: "turn-1",
      status: "applied",
      detail: "Patch applied",
      approvalTicketId: "approval-1",
      artifactId: "artifact-applied",
      evidenceId: "evidence-applied",
      patchRef: "tool_result_patch",
      changedFiles: [
        {
          path: "README.md",
          changeType: "modified",
          additions: 1,
          deletions: 0,
        },
      ],
    }));
    const { rerender } = render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createPatchDetail()}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
        expandedPatchKey="session-1:artifact_patch_1:2"
        applyPatch={applyPatch}
      />
    );

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(applyPatch).toHaveBeenCalledWith({
      sessionId: "session-1",
      artifactId: "artifact_patch_1",
    });
    rerender(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createAppliedPatchDetail()}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
        expandedPatchKey="session-1:artifact_patch_1:2"
        applyPatch={applyPatch}
      />
    );
    expect(await screen.findByRole("button", { name: "Applied" })).toBeDisabled();
  });

  test("shows approval required when a matching pending tool approval exists", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createPendingApprovalPatchDetail()}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
        expandedPatchKey="session-1:artifact_patch_1:2"
        applyPatch={vi.fn()}
      />
    );

    expect(screen.getByText("Approval required")).toBeDefined();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  test("resolves matching pending approval from the patch apply button", async () => {
    const user = userEvent.setup();
    const applyPatch = vi.fn();
    const resolveApproval = vi.fn(async () => ({
      sessionId: "session-1",
      approvalTicketId: "approval-1",
      status: "approved",
      detail: "Patch applied",
      toolPath: "/tools/filesystem/apply_patch",
      artifactId: "artifact_applied",
      evidenceId: "evidence_applied",
      patchRef: "tool_result_patch",
      changedFiles: [],
    }));
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createPendingApprovalPatchDetail()}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
        expandedPatchKey="session-1:artifact_patch_1:2"
        applyPatch={applyPatch}
        resolveApproval={resolveApproval}
      />
    );

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(resolveApproval).toHaveBeenCalledWith({
      sessionId: "session-1",
      approvalTicketId: "approval-1",
      decision: "approve",
    });
    expect(applyPatch).not.toHaveBeenCalled();
  });

  test("shows denied patch proposals as disabled", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createDeniedPatchDetail()}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
        expandedPatchKey="session-1:artifact_patch_1:2"
        applyPatch={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Denied" })).toBeDisabled();
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
  turns: [
    {
      id: "turn-1",
      sessionId: "session-1",
      profileId: "profile-1",
      status: "completed",
      collaborationMode: "default",
      createdAt: 1,
      updatedAt: 3,
    },
  ],
  messages: [
    {
      id: "msg-user",
      sessionId: "session-1",
      turnId: "turn-1",
      role: "user",
      content: "Inspect README",
      displayContent: "Inspect README",
      createdAt: 1,
    },
    {
      id: "msg-assistant",
      sessionId: "session-1",
      turnId: "turn-1",
      role: "assistant",
      content: "Done.",
      displayContent: "Done.",
      createdAt: 3,
    },
  ],
  runtimeEvents: [
    {
      sessionId: "session-1",
      turnId: "turn-1",
      phase: "tool_operation_completed",
      payload: {
        operation: {
          schemaVersion: "v1",
          opId: "op-read",
          op: "run",
          path: "/tools/filesystem/read_file",
          toolPath: "/tools/filesystem/read_file",
          riskLevel: "low",
          summary: "Run /tools/filesystem/read_file",
        },
        result: {
          schemaVersion: "v1",
          opId: "op-read",
          op: "run",
          path: "/tools/filesystem/read_file",
          resultRef: "tool_result_1",
          status: "completed",
          summary: "Read /tools/filesystem/read_file",
          contentPreview: "{}",
          contentBytes: 128,
          truncated: true,
        },
      },
      timestamp: 2,
    },
  ],
});

const createPatchDetail = (): AgentSessionDetail => ({
  ...createDetail(),
  runtimeEvents: [
    {
      sessionId: "session-1",
      turnId: "turn-1",
      phase: "tool_operation_completed",
      payload: {
        operation: {
          schemaVersion: "v1",
          opId: "op-propose",
          op: "run",
          path: "/tools/filesystem/propose_patch",
          toolPath: "/tools/filesystem/propose_patch",
          riskLevel: "medium",
          summary: "Run /tools/filesystem/propose_patch",
        },
        result: {
          schemaVersion: "v1",
          opId: "op-propose",
          op: "run",
          path: "/tools/filesystem/propose_patch",
          resultRef: "tool_result_patch",
          patchRef: "tool_result_patch",
          artifactId: "artifact_patch_1",
          evidenceId: "evidence_patch_1",
          status: "completed",
          summary: "Proposed patch for 1 file",
          contentPreview: "--- a/README.md\n+++ b/README.md",
          contentBytes: 92,
          truncated: false,
          changedFiles: [
            {
              path: "README.md",
              changeType: "modified",
              additions: 1,
              deletions: 0,
            },
          ],
        },
      },
      timestamp: 2,
    },
  ],
});

const createAppliedPatchDetail = (): AgentSessionDetail => ({
  ...createPatchDetail(),
  runtimeEvents: [
    ...createPatchDetail().runtimeEvents,
    {
      sessionId: "session-1",
      turnId: "turn-1",
      phase: "tool_operation_completed",
      payload: {
        operation: {
          path: "/tools/filesystem/apply_patch",
          toolPath: "/tools/filesystem/apply_patch",
        },
        result: {
          status: "applied",
          artifactId: "artifact_applied",
          evidenceId: "evidence_applied",
          approvalTicketId: "approval-1",
          appliedFromArtifactId: "artifact_patch_1",
          patchRef: "tool_result_patch",
          changedFiles: [
            {
              path: "README.md",
              changeType: "modified",
              additions: 1,
              deletions: 0,
            },
          ],
        },
      },
      timestamp: 3,
    },
  ],
});

const createPendingApprovalPatchDetail = (): AgentSessionDetail => ({
  ...createPatchDetail(),
  pendingInteractions: [
    {
      id: "approval-1",
      sessionId: "session-1",
      turnId: "turn-1",
      kind: "tool_approval",
      status: "pending",
      payload: {
        approvalTicketId: "approval-1",
        toolPath: "/tools/filesystem/apply_patch",
        artifactId: "artifact_patch_1",
        patchRef: "tool_result_patch",
        approvalMode: "user",
      },
      createdAt: 2,
      updatedAt: 2,
    },
  ],
});

const createDeniedPatchDetail = (): AgentSessionDetail => ({
  ...createPatchDetail(),
  runtimeEvents: [
    ...createPatchDetail().runtimeEvents,
    {
      sessionId: "session-1",
      turnId: "turn-1",
      phase: "approval_ticket_resolved",
      payload: {
        status: "denied",
        toolPath: "/tools/filesystem/apply_patch",
        approvalTicketId: "approval-1",
        artifactId: "artifact_patch_1",
        patchRef: "tool_result_patch",
      },
      timestamp: 3,
    },
  ],
});
