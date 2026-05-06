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

  test("compact preview row renders conflict and preview-only state", () => {
    render(<RollbackPreviewRow detail={detailWithPreview("conflict")} />);

    expect(screen.getByLabelText("Rollback preview")).toBeDefined();
    expect(screen.getByText("Conflict")).toBeDefined();
    expect(screen.getByText("2 msg / 1 file")).toBeDefined();
    expect(screen.getByText("Preview only")).toBeDisabled();
  });

  test("compact preview row renders external side effect state", () => {
    render(<RollbackPreviewRow detail={detailWithPreview("external_side_effect")} />);

    expect(screen.getByText("External effect")).toBeDefined();
    expect(screen.getByText("2 msg / 1 file / 1 external")).toBeDefined();
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

const detailWithPreview = (impactLevel: "conflict" | "external_side_effect"): AgentSessionDetail => ({
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
