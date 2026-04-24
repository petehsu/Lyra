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
        pendingInteractionsLabel="Pending"
        navPreviousLabel="Previous"
        navNextLabel="Next"
        onSelectInteractionId={onSelectInteractionId}
        onCommandApprovalDecision={async () => {}}
        onPlanQuestionSubmit={async () => {}}
        onPlanApprovalDecision={async () => {}}
      />
    );

    expect(screen.getByText("Pending")).toBeDefined();
    expect(screen.getByText("2/2")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(onSelectInteractionId).toHaveBeenCalledWith("ia-1");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
