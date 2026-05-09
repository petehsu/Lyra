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

  test("places pending runtime actions inside the chronological thread timeline", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createShellApprovalDetail()}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
      />
    );

    const userMessage = screen.getByText("Inspect README");
    const approval = screen.getByText("Run shell command");
    const assistantMessage = screen.getByText("Done.");
    expect(approval.closest(".lyra-ai-agent-runtime-action")).not.toBeNull();
    expect(
      userMessage.compareDocumentPosition(approval) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      approval.compareDocumentPosition(assistantMessage) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("orders saved assistant text before a later clarification panel", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createClarificationTimelineDetail({ includeAssistantMessage: true })}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
      />
    );

    const userMessage = screen.getByText("Build a website");
    const assistantMessage = screen.getByText("I need one detail first.");
    const clarification = screen.getByText("Choose site direction");
    expect(
      userMessage.compareDocumentPosition(assistantMessage) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      assistantMessage.compareDocumentPosition(clarification) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("orders live assistant text before a later clarification panel", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createClarificationTimelineDetail({ includeAssistantMessage: false })}
        streamingTurnId="turn-clarify"
        streamingAssistantText="I need one detail first."
        isLoading={false}
        runtimeError={null}
      />
    );

    const userMessage = screen.getByText("Build a website");
    const assistantMessage = screen.getByText("I need one detail first.");
    const clarification = screen.getByText("Choose site direction");
    expect(
      userMessage.compareDocumentPosition(assistantMessage) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      assistantMessage.compareDocumentPosition(clarification) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("orders saved assistant text before later tool calls in the same turn", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createToolAfterAssistantDetail({ includeAssistantMessage: true })}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
      />
    );

    const userMessage = screen.getByText("Build a website");
    const assistantMessage = screen.getByText("I will inspect the workspace first.");
    const toolCall = screen.getByText("Read /tools/filesystem/read_file");
    expect(
      userMessage.compareDocumentPosition(assistantMessage) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      assistantMessage.compareDocumentPosition(toolCall) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("orders live assistant text before later tool calls in the same turn", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createToolAfterAssistantDetail({ includeAssistantMessage: false })}
        streamingTurnId="turn-tool"
        streamingAssistantText="I will inspect the workspace first."
        isLoading={false}
        runtimeError={null}
      />
    );

    const userMessage = screen.getByText("Build a website");
    const assistantMessage = screen.getByText("I will inspect the workspace first.");
    const toolCall = screen.getByText("Read /tools/filesystem/read_file");
    expect(
      userMessage.compareDocumentPosition(assistantMessage) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      assistantMessage.compareDocumentPosition(toolCall) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("keeps user messages unlabeled and places actions in the message footer", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createDetail()}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
        renderMessageActions={(message) =>
          message.role === "user" ? <button type="button">Rollback preview</button> : null
        }
      />
    );

    expect(screen.queryByText("You")).toBeNull();
    expect(screen.getByText("Lyra")).toBeDefined();
    const userMessage = screen.getByText("Inspect README").closest(".lyra-ai-agent-message-user");
    expect(userMessage?.querySelector(".lyra-ai-agent-message-footer")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Rollback preview" })).toBeDefined();
  });

  test("shows the assistant generating indicator while a response is active", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={createDetail()}
        streamingTurnId="turn-live"
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
      />
    );

    expect(screen.getByLabelText("Lyra is responding")).toBeDefined();
  });

  test("renders optimistic user messages before session detail returns", () => {
    render(
      <AiPanelThreadView
        logoUrl="/logo.png"
        emptyThreadLabel="Hello"
        detail={null}
        optimisticUserMessages={[
          {
            id: "optimistic-1",
            clientRequestId: "optimistic-1",
            tabId: "draft-1",
            targetSessionId: null,
            sessionId: "draft-1",
            role: "user",
            content: "Build the project",
            displayContent: "Build the project",
            createdAt: 1,
            optimistic: true,
          },
        ]}
        streamingTurnId={null}
        streamingAssistantText=""
        isLoading={false}
        runtimeError={null}
      />
    );

    expect(screen.getByText("Build the project")).toBeDefined();
    expect(screen.queryByText("Hello")).toBeNull();
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

const createShellApprovalDetail = (): AgentSessionDetail => ({
  ...createDetail(),
  pendingInteractions: [
    {
      id: "approval-shell-1",
      sessionId: "session-1",
      turnId: "turn-1",
      kind: "tool_approval",
      status: "pending",
      payload: {
        approvalTicketId: "approval-shell-1",
        toolPath: "/tools/shell/run_command",
        command: "npm test",
        cwd: "/repo",
      },
      createdAt: 2,
      updatedAt: 2,
    },
  ],
  runtimeEvents: [],
});

const createClarificationTimelineDetail = ({
  includeAssistantMessage,
}: {
  readonly includeAssistantMessage: boolean;
}): AgentSessionDetail => {
  const detail = createDetail();
  return {
    ...detail,
    session: {
      ...detail.session,
      updatedAt: 5,
    },
    pendingInteractions: [
      {
        id: "clarification-1",
        sessionId: "session-1",
        turnId: "turn-clarify",
        kind: "clarification",
        status: "pending",
        payload: {
          panelId: "panel-clarify-1",
          title: "Choose site direction",
          description: "Needed before generating the files.",
          presentation: "inline_card",
          blocksExecution: true,
          questions: [
            {
              questionTicketId: "question-1",
              title: "Choose site direction",
              question: "Which kind of homepage should Lyra build?",
              why: "This changes the content and structure.",
              options: [
                { id: "A", label: "Product", description: "Product marketing page", recommended: true },
                { id: "B", label: "Portfolio", description: "Personal portfolio" },
                { id: "C", label: "Docs", description: "Documentation entry" },
                { id: "D", label: "Other", description: "Use a custom answer" },
              ],
              allowCustomAnswer: true,
            },
          ],
        },
        createdAt: 3,
        updatedAt: 3,
      },
    ],
    turns: [
      {
        id: "turn-clarify",
        sessionId: "session-1",
        profileId: "profile-1",
        status: "paused",
        collaborationMode: "default",
        createdAt: 1,
        updatedAt: 4,
      },
    ],
    messages: [
      {
        id: "msg-user-clarify",
        sessionId: "session-1",
        turnId: "turn-clarify",
        role: "user",
        content: "Build a website",
        displayContent: "Build a website",
        createdAt: 1,
      },
      ...(includeAssistantMessage
        ? [
            {
              id: "msg-assistant-clarify",
              sessionId: "session-1",
              turnId: "turn-clarify",
              role: "assistant" as const,
              content: "I need one detail first.",
              displayContent: "I need one detail first.",
              createdAt: 4,
            },
          ]
        : []),
    ],
    runtimeEvents: [
      {
        sessionId: "session-1",
        turnId: "turn-clarify",
        phase: "model_stream_delta",
        payload: { text: "I need one detail first." },
        timestamp: 2,
      },
    ],
  };
};

const createToolAfterAssistantDetail = ({
  includeAssistantMessage,
}: {
  readonly includeAssistantMessage: boolean;
}): AgentSessionDetail => {
  const detail = createDetail();
  return {
    ...detail,
    session: {
      ...detail.session,
      updatedAt: 5,
    },
    pendingInteractions: [],
    turns: [
      {
        id: "turn-tool",
        sessionId: "session-1",
        profileId: "profile-1",
        status: "completed",
        collaborationMode: "default",
        createdAt: 1,
        updatedAt: 5,
      },
    ],
    messages: [
      {
        id: "msg-user-tool",
        sessionId: "session-1",
        turnId: "turn-tool",
        role: "user",
        content: "Build a website",
        displayContent: "Build a website",
        createdAt: 1,
      },
      ...(includeAssistantMessage
        ? [
            {
              id: "msg-assistant-tool",
              sessionId: "session-1",
              turnId: "turn-tool",
              role: "assistant" as const,
              content: "I will inspect the workspace first.",
              displayContent: "I will inspect the workspace first.",
              createdAt: 5,
            },
          ]
        : []),
    ],
    runtimeEvents: [
      {
        sessionId: "session-1",
        turnId: "turn-tool",
        phase: "model_stream_delta",
        payload: { text: "I will inspect the workspace first." },
        timestamp: 2,
      },
      {
        sessionId: "session-1",
        turnId: "turn-tool",
        phase: "tool_operation_started",
        payload: {
          operation: {
            schemaVersion: "v1",
            opId: "op-read-after-text",
            op: "run",
            path: "/tools/filesystem/read_file",
            toolPath: "/tools/filesystem/read_file",
            riskLevel: "low",
            summary: "Run /tools/filesystem/read_file",
          },
        },
        timestamp: 3,
      },
      {
        sessionId: "session-1",
        turnId: "turn-tool",
        phase: "tool_operation_completed",
        payload: {
          operation: {
            schemaVersion: "v1",
            opId: "op-read-after-text",
            op: "run",
            path: "/tools/filesystem/read_file",
            toolPath: "/tools/filesystem/read_file",
            riskLevel: "low",
            summary: "Run /tools/filesystem/read_file",
          },
          result: {
            schemaVersion: "v1",
            opId: "op-read-after-text",
            op: "run",
            path: "/tools/filesystem/read_file",
            resultRef: "tool_result_after_text",
            status: "completed",
            summary: "Read /tools/filesystem/read_file",
            contentPreview: "{}",
            contentBytes: 128,
            truncated: true,
          },
        },
        timestamp: 4,
      },
    ],
  };
};

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
