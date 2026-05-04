import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AiPanelInteractionShell } from "../interaction-shell";
import type { PendingInteractionPanel } from "../interaction/pending-interaction-mappers";

const planArtifact = {
  planId: "plan-1",
  status: "proposed" as const,
  title: "Website plan",
  summary: "Website plan",
  objective: "Build the page",
  assumptions: [],
  steps: [{ id: "step-1", kind: "step", title: "Build", body: "Build the page" }],
  interfaces: [],
  risks: [],
  tests: [],
  acceptanceCriteria: [],
};

const commandRequest = (id: string, turnId: string) => ({
  id,
  interactionId: id,
  interactionKind: "command_execution_approval" as const,
  sessionId: "s-1",
  turnId,
  toolCallId: `${id}-tc`,
  toolName: "terminal.exec",
  toolLabel: "Terminal",
  command: "echo hi",
  riskLevel: "medium" as const,
  riskDescription: "needs approval",
  isRepeat: false
});

describe("ai panel interaction shell", () => {
  test("does not duplicate plan approval content above the composer", () => {
    const request = {
      id: "plan:turn-1",
      sessionId: "thread-1",
      turnId: "turn-1",
      planId: "plan-1",
      version: 2,
      status: "proposed" as const,
      summary: "Website plan",
      artifact: planArtifact,
    };
    const interaction = {
      kind: "planApproval" as const,
      request,
    } satisfies PendingInteractionPanel;

    const { container } = render(
      <AiPanelInteractionShell
        locale="en-US"
        panelRef={createRef<HTMLDivElement>()}
        activeInteractionPanel={interaction}
        activePendingInteraction={interaction}
        pendingInteractionQueue={[interaction]}
        activeInteractionPosition={1}
        navPreviousLabel="Previous"
        navNextLabel="Next"
        onSelectInteractionId={vi.fn()}
        onCommandApprovalDecision={async () => {}}
        onAgentQuestionSubmit={async () => {}}
      />
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Website plan")).toBeNull();
  });

  test("navigates pending interactions", () => {
    const first = {
      kind: "commandApproval" as const,
      request: commandRequest("ia-1", "t-1")
    } satisfies PendingInteractionPanel;
    const second = {
      kind: "commandApproval" as const,
      request: commandRequest("ia-2", "t-2")
    } satisfies PendingInteractionPanel;

    const onSelectInteractionId = vi.fn();

    render(
      <AiPanelInteractionShell
        locale="en-US"
        panelRef={createRef<HTMLDivElement>()}
        activeInteractionPanel={second}
        activePendingInteraction={second}
        pendingInteractionQueue={[first, second]}
        activeInteractionPosition={2}
        navPreviousLabel="Previous"
        navNextLabel="Next"
        onSelectInteractionId={onSelectInteractionId}
        onCommandApprovalDecision={async () => {}}
        onAgentQuestionSubmit={async () => {}}
      />
    );

    expect(screen.queryByText("Pending")).toBeNull();
    expect(screen.queryByText("2/2")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(onSelectInteractionId).toHaveBeenCalledWith("ia-1");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  test("submits mcp elicitation responses", () => {
    const onSubmit = vi.fn(async () => {});
    const interaction = {
      kind: "mcpElicitation" as const,
      request: {
        id: "ia-mcp",
        interactionId: "ia-mcp",
        interactionKind: "mcp_elicitation" as const,
        sessionId: "thread-1",
        turnId: "turn-1",
        serverName: "Filesystem MCP",
        mode: "form" as const,
        message: "Need your email",
        fields: [
          {
            id: "email",
            label: "Email",
            description: "Account email",
            kind: "string" as const,
            required: true,
            options: [],
          },
        ],
        meta: { persist: ["session"] },
      },
    } satisfies PendingInteractionPanel;

    render(
      <AiPanelInteractionShell
        locale="en-US"
        panelRef={createRef<HTMLDivElement>()}
        activeInteractionPanel={interaction}
        activePendingInteraction={interaction}
        pendingInteractionQueue={[interaction]}
        activeInteractionPosition={1}
        navPreviousLabel="Previous"
        navNextLabel="Next"
        onSelectInteractionId={vi.fn()}
        onCommandApprovalDecision={async () => {}}
        onAgentQuestionSubmit={async () => {}}
        onMcpElicitationSubmit={onSubmit}
      />
    );

    expect(screen.getByText("MCP request")).toBeDefined();
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: " dev@example.com " } });
    fireEvent.click(screen.getByRole("button", { name: "For this session" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(onSubmit).toHaveBeenCalledWith({
      action: "accept",
      content: { email: "dev@example.com" },
      meta: { persist: "session" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onSubmit).toHaveBeenCalledWith({ action: "decline" });
  });
});
