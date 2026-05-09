import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { AgentSessionDetail } from "../agent-ui-types";
import { ClarificationList } from "../clarification-list";
import { hasPendingClarification } from "../clarification-model";

describe("ClarificationList", () => {
  test("shows one question at a time and submits answers at the end", async () => {
    const user = userEvent.setup();
    const resolveClarification = vi.fn(async () => ({
      sessionId: "session-1",
      questionTicketId: "question-2",
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

    expect(screen.getAllByText("Clarify target").length).toBeGreaterThan(0);
    expect(screen.queryByText("Pick destination")).toBeNull();

    const firstRow = screen.getAllByText("Clarify target")[0]?.closest(".lyra-ai-clarification-panel");
    expect(firstRow).not.toBeNull();
    await user.click(within(firstRow as HTMLElement).getByRole("button", { name: "Select B: Reference" }));
    expect(resolveClarification).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByText("Pick destination").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Select A: Latest" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(resolveClarification).toHaveBeenCalledWith({
      sessionId: "session-1",
      questionTicketId: "question-1",
      selectedOptionId: "B",
      answerText: "Reference",
    });
    expect(resolveClarification).toHaveBeenCalledWith({
      sessionId: "session-1",
      questionTicketId: "question-2",
      selectedOptionId: "A",
      answerText: "Latest",
    });
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  test("submits custom answer from the final submit action", async () => {
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

    await user.type(screen.getByPlaceholderText("Custom answer"), "Use README.md");
    expect(resolveClarification).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(resolveClarification).toHaveBeenCalledWith({
      sessionId: "session-1",
      questionTicketId: "question-1",
      customAnswer: "Use README.md",
      answerText: "Use README.md",
    });
  });

  test("detects pending clarification for composer blocking", () => {
    expect(hasPendingClarification(createDetail(["question-1"]))).toBe(true);
    expect(hasPendingClarification(createDetail([]))).toBe(false);
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
