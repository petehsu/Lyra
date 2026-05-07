import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { RollbackMessageAction } from "../rollback-message-action";
import { RollbackPreviewRow } from "../rollback-preview-row";
import type {
  AgentMessage,
  AgentRecoverySummary,
  AgentSessionDetail,
} from "../agent-ui-types";

describe("rollback preview UI", () => {
  test("user message with checkpoint shows rollback preview icon", async () => {
    const previewMessageRollback = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      rollbackId: "rollback-1",
      targetUserMessageId: "msg-user",
      status: "previewed",
      impactLevel: "safe",
      requiresConfirmation: false,
      summary: "Safe preview",
      workspaceChanges: [],
      conversationChanges: [],
      externalSideEffects: [],
    });
    const onPreviewComplete = vi.fn().mockResolvedValue(undefined);
    render(
      <RollbackMessageAction
        message={userMessage}
        recoverySummary={recoverySummary}
        previewMessageRollback={previewMessageRollback}
        onPreviewComplete={onPreviewComplete}
      />
    );

    fireEvent.click(screen.getByLabelText("Rollback preview"));

    await waitFor(() => expect(previewMessageRollback).toHaveBeenCalledWith({
      sessionId: "session-1",
      targetUserMessageId: "msg-user",
    }));
    await waitFor(() => expect(onPreviewComplete).toHaveBeenCalledTimes(1));
  });

  test("non checkpoint message has no rollback action", () => {
    const { container } = render(
      <RollbackMessageAction
        message={{ ...userMessage, id: "msg-other" }}
        recoverySummary={recoverySummary}
        previewMessageRollback={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  test("compact preview row safe state calls restore and refreshes", async () => {
    const executeMessageRollback = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      rollbackId: "rollback-1",
      status: "completed",
      impactLevel: "safe",
      supersededMessageIds: ["msg-assistant"],
      unresolvedSideEffectIds: [],
      reopenedUserMessageId: "msg-user",
      detail: "Restored 1 workspace file.",
    });
    const onExecuteComplete = vi.fn().mockResolvedValue(undefined);
    render(
      <RollbackPreviewRow
        detail={detailWithPreview("safe")}
        executeMessageRollback={executeMessageRollback}
        onExecuteComplete={onExecuteComplete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore rollback preview" }));

    await waitFor(() => expect(executeMessageRollback).toHaveBeenCalledWith({
      sessionId: "session-1",
      rollbackId: "rollback-1",
      confirmationToken: "restore:rollback-1",
      strategy: "safe_only",
    }));
    await waitFor(() => expect(onExecuteComplete).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Restored")).toBeDefined();
  });

  test("compact preview row renders conflict and blocked state", () => {
    render(<RollbackPreviewRow detail={detailWithPreview("conflict")} />);

    expect(screen.getByLabelText("Rollback preview")).toBeDefined();
    expect(screen.getByText("Conflict")).toBeDefined();
    expect(screen.getByText("2 msg / 1 file")).toBeDefined();
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Restore rollback preview" })).toBeNull();
  });

  test("compact preview row renders external side effect state", () => {
    render(<RollbackPreviewRow detail={detailWithPreview("external_side_effect")} />);

    expect(screen.getByText("External effect")).toBeDefined();
    expect(screen.getByText("2 msg / 1 file / 1 external")).toBeDefined();
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Restore rollback preview" })).toBeNull();
  });

  test("restored rollback state survives detail reload", () => {
    render(<RollbackPreviewRow detail={detailWithExecutedPreview()} />);

    expect(screen.getByText("Restored")).toBeDefined();
    expect(screen.getByText("Restored 1 workspace file.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Restore rollback preview" })).toBeNull();
  });
});

const userMessage: AgentMessage = {
  id: "msg-user",
  sessionId: "session-1",
  turnId: "turn-1",
  role: "user",
  content: "Please change this",
  displayContent: "Please change this",
  createdAt: 1,
};

const recoverySummary: AgentRecoverySummary = {
  latestAnchor: {
    anchorId: "anchor-1",
    sessionId: "session-1",
    userMessageId: "msg-user",
    runtimeTurnId: "turn-1",
    checkpointId: "checkpoint-1",
    conversationSnapshotId: "conversation-1",
    workspaceSnapshotId: "workspace-1",
    status: "active",
    createdAt: 1,
  },
  rollbackReadyMessageIds: ["msg-user"],
  rollbackPreviews: [],
  activeRollbackPreview: null,
};

const detailWithPreview = (
  impactLevel: "safe" | "conflict" | "external_side_effect"
): AgentSessionDetail => ({
  session: {
    id: "session-1",
    title: "Thread",
    collaborationMode: "default",
    createdAt: 1,
    updatedAt: 2,
  },
  pendingInteractions: [],
  turns: [],
  messages: [userMessage],
  runtimeEvents: [],
  activeTodo: null,
  executionSummary: null,
  verificationSummary: null,
  completionAudit: null,
  deliveryProof: null,
  longWorkSummary: null,
  followSummary: null,
  recoverySummary: {
    ...recoverySummary,
    rollbackPreviews: [{
      rollbackId: "rollback-1",
      sessionId: "session-1",
      targetUserMessageId: "msg-user",
      status: "previewed",
      impactLevel,
      requiresConfirmation: true,
      summary: "Preview",
      messageCount: 2,
      workspaceChangeCount: 1,
      externalSideEffectCount: impactLevel === "external_side_effect" ? 1 : 0,
      updatedAt: 2,
    }],
    activeRollbackPreview: {
      rollbackId: "rollback-1",
      sessionId: "session-1",
      targetUserMessageId: "msg-user",
      status: "previewed",
      impactLevel,
      requiresConfirmation: true,
      summary: "Preview",
      messageCount: 2,
      workspaceChangeCount: 1,
      externalSideEffectCount: impactLevel === "external_side_effect" ? 1 : 0,
      updatedAt: 2,
    },
  },
});

const detailWithExecutedPreview = (): AgentSessionDetail => ({
  ...detailWithPreview("safe"),
  recoverySummary: {
    ...recoverySummary,
    rollbackPreviews: [{
      rollbackId: "rollback-1",
      sessionId: "session-1",
      targetUserMessageId: "msg-user",
      status: "executed",
      impactLevel: "safe",
      requiresConfirmation: true,
      summary: "Preview",
      messageCount: 2,
      workspaceChangeCount: 1,
      externalSideEffectCount: 0,
      updatedAt: 3,
    }],
    latestExecution: {
      rollbackId: "rollback-1",
      status: "completed",
      impactLevel: "safe",
      reopenedUserMessageId: "msg-user",
      supersededMessageCount: 1,
      unresolvedSideEffectCount: 0,
      detail: "Restored 1 workspace file.",
      updatedAt: 3,
    },
    reopenedMessageId: "msg-user",
  },
});
