import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AiPanelInteractionShell } from "../interaction-shell";
import type { PendingInteractionPanel } from "../interaction/pending-interaction-mappers";

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
      version: 0,
      status: "submitted" as const,
      summary: "Website plan",
      proposedMarkdown: "# Website plan",
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
        onPlanQuestionSubmit={async () => {}}
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
        onPlanQuestionSubmit={async () => {}}
      />
    );

    expect(screen.queryByText("Pending")).toBeNull();
    expect(screen.queryByText("2/2")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(onSelectInteractionId).toHaveBeenCalledWith("ia-1");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
