import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { LiveDraftStatusRow } from "../live-draft-status-row";
import type { AgentLiveDraftSummary, AgentSessionDetail } from "../agent-ui-types";

describe("live draft status row", () => {
  test("renders compact labels for all live draft statuses", () => {
    const statuses = [
      ["drafting", "Drafting"],
      ["ready_to_commit", "Ready"],
      ["committing", "Committing"],
      ["committed", "Committed"],
      ["discarded", "Discarded"],
      ["conflict", "Conflict"],
      ["failed", "Failed"],
    ] as const;
    const { rerender } = render(
      <LiveDraftStatusRow detail={detailWithDraft(statuses[0][0])} />
    );

    for (const [status, label] of statuses) {
      rerender(<LiveDraftStatusRow detail={detailWithDraft(status)} />);
      expect(screen.getByLabelText("Live draft")).toBeDefined();
      expect(screen.getByText(label)).toBeDefined();
      expect(screen.getByText(/README\.md/)).toBeDefined();
    }
  });

  test("renders nothing without active live draft", () => {
    const { container } = render(<LiveDraftStatusRow detail={detailWithDraft(null)} />);

    expect(container.firstChild).toBeNull();
  });
});

const detailWithDraft = (status: AgentLiveDraftSummary["status"] | null): AgentSessionDetail => ({
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
  recoverySummary: null,
  followSummary: {
    followSessionId: "follow-1",
    sessionId: "session-1",
    status: "enabled",
    activeTargetId: "target-1",
    activeTarget: null,
    targets: [],
    recentEvents: [],
    activeLiveDraft: status === null
      ? null
      : {
          liveEditId: "live-edit-1",
          followSessionId: "follow-1",
          followTargetId: "target-1",
          path: "README.md",
          status,
          commitOperationId: status === "committed" ? "op-apply" : undefined,
          deltaCount: 2,
          updatedAt: 2,
        },
    updatedAt: 2,
  },
});
