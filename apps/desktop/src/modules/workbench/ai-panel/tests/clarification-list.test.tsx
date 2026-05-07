import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { AgentSessionDetail } from "../agent-ui-types";
import { ClarificationList } from "../clarification-list";

describe("ClarificationList", () => {
  test("renders pending questions and resolves A/B/C/D answers", async () => {
    const user = userEvent.setup();
    const resolveClarification = vi.fn(async () => ({
      sessionId: "session-1",
      questionTicketId: "question-1",
      status: "answered" as const,
      detail: createDetail([]),
    }));
    const onResolved = vi.fn();
    render(
      <ClarificationList
        detail={createDetail(["question-1", "question-2"])}
        resolveClarification={resolveClarification}
        onResolved={onResolved}
      />
    );

    expect(screen.getByText("Clarify target")).toBeDefined();
    expect(screen.getByText("Pick destination")).toBeDefined();

    const firstRow = screen.getByText("Clarify target").closest(".lyra-ai-clarification-row");
    expect(firstRow).not.toBeNull();
    await user.click(within(firstRow as HTMLElement).getByRole("button", { name: "B" }));

    expect(resolveClarification).toHaveBeenCalledWith({
      sessionId: "session-1",
      questionTicketId: "question-1",
      selectedOptionId: "B",
    });
    expect(onResolved).toHaveBeenCalled();
  });

  test("submits custom answer inline", async () => {
    const user = userEvent.setup();
    const resolveClarification = vi.fn(async () => ({
      sessionId: "session-1",
      questionTicketId: "question-1",
      status: "answered" as const,
      detail: createDetail([]),
    }));
    render(
      <ClarificationList
        detail={createDetail(["question-1"])}
        resolveClarification={resolveClarification}
      />
    );

    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.type(screen.getByPlaceholderText("Custom answer"), "Use README.md");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(resolveClarification).toHaveBeenCalledWith({
      sessionId: "session-1",
      questionTicketId: "question-1",
      customAnswer: "Use README.md",
      answerText: "Use README.md",
    });
  });
});

const createDetail = (ticketIds: readonly string[]): AgentSessionDetail => ({
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
  pendingInteractions: ticketIds.map((id, index) => ({
    id,
    sessionId: "session-1",
    turnId: `turn-${String(index + 1)}`,
    kind: "clarification",
    status: "pending",
    payload: {
      questionTicketId: id,
      title: index === 0 ? "Clarify target" : "Pick destination",
      question: "Which target should Lyra use?",
      why: "Target is unclear",
      targetSummary: "No fresh binding",
      allowCustomAnswer: true,
      options: [
        { id: "A", label: "Latest", description: "Use latest thread" },
        { id: "B", label: "Reference", description: "Use referenced target" },
        { id: "C", label: "Plan", description: "Open planning" },
        { id: "D", label: "Cancel", description: "Cancel" },
      ],
    },
    createdAt: index + 1,
    updatedAt: index + 1,
  })),
  turns: [],
  messages: [],
  runtimeEvents: [],
});
