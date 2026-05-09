import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { AgentSessionDetail } from "../agent-ui-types";
import { PendingApprovalList } from "../pending-approval-list";

describe("PendingApprovalList", () => {
  test("renders pending tool approvals and resolves approve or deny", async () => {
    const user = userEvent.setup();
    const resolveApproval = vi.fn(async () => ({
      sessionId: "session-1",
      approvalTicketId: "approval-1",
      status: "approved",
      detail: "ok",
      toolPath: "/tools/filesystem/apply_patch",
      changedFiles: [],
    }));
    render(
      <PendingApprovalList
        detail={createDetail()}
        resolveApproval={resolveApproval}
      />
    );

    expect(screen.getByText("Apply workspace patch")).toBeDefined();
    expect(screen.getByText("Rollback workspace patch")).toBeDefined();
    expect(screen.getByText("/tools/filesystem/apply_patch · README.md")).toBeDefined();
    expect(screen.getByText("/tools/agent/write_file · src/new.ts")).toBeDefined();

    const rows = screen.getAllByRole("button", { name: "Approve" });
    const firstApprove = rows[0];
    expect(firstApprove).toBeDefined();
    await user.click(firstApprove as HTMLElement);
    expect(resolveApproval).toHaveBeenCalledWith({
      sessionId: "session-1",
      approvalTicketId: "approval-1",
      decision: "approve",
    });
    expect(await screen.findByText("Approved")).toBeDefined();

    const rollbackRow = screen.getByText("Rollback workspace patch").closest(".lyra-ai-pending-approval-row");
    expect(rollbackRow).not.toBeNull();
    await user.click(within(rollbackRow as HTMLElement).getByRole("button", { name: "Deny" }));
    expect(resolveApproval).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      approvalTicketId: "approval-2",
      decision: "deny",
    });
    expect(await within(rollbackRow as HTMLElement).findByText("Denied")).toBeDefined();
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
        title: "Apply workspace patch",
        impactScope: { files: ["README.md"] },
      },
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "approval-2",
      sessionId: "session-1",
      turnId: "turn-1",
      kind: "tool_approval",
      status: "pending",
      payload: {
        approvalTicketId: "approval-2",
        toolPath: "/tools/filesystem/rollback_patch",
        title: "Rollback workspace patch",
        impactScope: { files: ["src/lib.rs", "src/main.rs"] },
      },
      createdAt: 2,
      updatedAt: 2,
    },
    {
      id: "approval-3",
      sessionId: "session-1",
      turnId: "turn-1",
      kind: "tool_approval",
      status: "pending",
      payload: {
        approvalTicketId: "approval-3",
        toolPath: "/tools/agent/write_file",
        title: "Write workspace file",
        requestedAction: {
          arguments: {
            path: "src/new.ts",
          },
        },
      },
      createdAt: 3,
      updatedAt: 3,
    },
  ],
  turns: [],
  messages: [],
  runtimeEvents: [],
});
