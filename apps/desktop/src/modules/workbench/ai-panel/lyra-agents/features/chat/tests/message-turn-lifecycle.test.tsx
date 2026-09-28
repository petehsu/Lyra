import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentSessionSnapshot } from "../../../../../../../shared/agent";
import { agentSessionToChatMessages } from "@workbench/agent-session-view-model/message-view-model";
import { getStreamStore } from "@workbench/agent-session-view-model/stream-store";
import { t } from "@workbench/i18n";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import { Message, resolveAgentActivityHostMessageId } from "../Message";

const snapshot = (): AgentSessionSnapshot => ({
  id: "session-turn", title: "Inspect project", sessionKind: "normal",
  workingDir: "/project", projectBound: true, workingDirIsHome: false,
  turnStatus: "running", activeTurnId: "turn-1",
  follow: { running: true, activity: "calling_model" }, todos: [], memory: null,
  updatedAt: "2026-09-28T20:56:04.000Z",
  messages: [
    { id: "user", role: "user", text: "Inspect project", createdAt: "2026-09-28T20:55:27.000Z" },
    {
      id: "assistant-first", role: "assistant", text: "Checking the project.", createdAt: "2026-09-28T20:55:36.000Z",
      blocks: [
        { id: "thinking-1", type: "thinking", text: "Earlier reasoning", status: "done" },
        { id: "text-0", type: "text", text: "Checking the project." },
        ...Array.from({ length: 6 }, (_, i) => ({ id: `tool-${i}`, type: "tool" as const, toolId: `tool-${i}` }))
      ]
    },
    { id: "assistant-next", role: "assistant", text: "", blocks: [], createdAt: "2026-09-28T20:56:04.000Z" }
  ],
  tools: Array.from({ length: 6 }, (_, i) => ({
    id: `tool-${i}`, name: i === 0 ? "read_file" : "exec_command", label: i === 0 ? "Read file" : "Run command",
    status: "completed" as const, input: i === 0 ? { path: "README.md" } : { command: "pwd" },
    startedAt: `2026-09-28T20:55:${40 + i}.000Z`, finishedAt: `2026-09-28T20:55:${40 + i}.500Z`
  }))
});

function Transcript({ state, followActivity = state.follow.activity }: { state: AgentSessionSnapshot; followActivity?: string | null }) {
  const messages = agentSessionToChatMessages(state);
  const running = state.turnStatus === "running";
  const host = resolveAgentActivityHostMessageId(messages, running);
  const data = createDataProviderValue({
    session: { title: state.title, project: "Lyra", workingDir: state.workingDir, projectBound: true, workingDirIsHome: false, totalAdditions: 0, totalDeletions: 0 },
    messages, isTurnRunning: running, followActivity: followActivity ?? null
  });
  return <DataContextProvider value={data}>{messages.filter((m) => m.author === "agent").map((message) =>
    <Message key={message.id} message={message} showActivityIndicator={message.id === host} activityIndicatorMessage={messages.find((m) => m.id === host) ?? null} />
  )}</DataContextProvider>;
}

describe("one assistant turn across model/tool rounds", () => {
  afterEach(() => getStreamStore().clear());

  it("keeps completed tools and the next reasoning stream together, then folds only after turn completion", () => {
    const state = snapshot();
    const view = render(<Transcript state={state} />);
    expect(view.container.querySelectorAll(".lyra-agents-message-agent")).toHaveLength(1);
    expect(view.container.querySelector(".lyra-agents-time-text")).toBeNull();
    expect(view.container.querySelector(".lyra-agents-message-process-fold")).toBeNull();

    act(() => {
      getStreamStore().appendReasoningDelta("assistant-next", "Latest reasoning");
      getStreamStore().flush();
    });
    const groups = view.container.querySelectorAll<HTMLElement>(".lyra-agents-tool-group");
    expect(groups).toHaveLength(2); // Earlier thought, then tools + latest thought.
    fireEvent.click(groups[1]!.querySelector(".lyra-agents-tool-group-head")!);
    fireEvent.click(groups[1]!.querySelectorAll(".lyra-agents-tool-call-head")[6]!);
    expect(within(groups[1]!).getByText("Latest reasoning")).toBeInTheDocument();
    expect(groups[1]!.querySelectorAll(".lyra-agents-tool-call")).toHaveLength(7);

    const last = state.messages.at(-1)!;
    const streaming = { ...state, messages: [...state.messages.slice(0, -1), {
      ...last, text: "Final", blocks: [{ id: "text-0", type: "text" as const, text: "Final" }]
    }] };
    act(() => {
      getStreamStore().appendDelta("assistant-next", "text-0", "Final response");
      getStreamStore().flush();
    });
    view.rerender(<Transcript state={streaming} />);
    expect(screen.getByText("Final response")).toBeInTheDocument();
    expect(view.container.querySelector(".lyra-agents-time-text")).toBeNull();
    expect(view.container.querySelector(".lyra-agents-message-process-fold")).toBeNull();

    const complete: AgentSessionSnapshot = { ...state, turnStatus: "idle", activeTurnId: null,
      follow: { running: false, activity: null }, messages: [...state.messages.slice(0, -1), {
        ...last, text: "Final response", blocks: [
          { id: "thinking-1", type: "thinking", text: "Latest reasoning", status: "done" },
          { id: "text-0", type: "text", text: "Final response" }
        ]
      }] };
    view.rerender(<Transcript state={complete} />);
    expect(view.container.querySelectorAll(".lyra-agents-message-agent")).toHaveLength(1);
    expect(view.container.querySelectorAll(".lyra-agents-time-text")).toHaveLength(1);
    const fold = view.container.querySelector<HTMLElement>(".lyra-agents-message-process-fold")!;
    expect(fold).not.toBeNull();
    fireEvent.click(fold.querySelector("button")!);
    const activities = fold.querySelectorAll<HTMLElement>(".lyra-agents-tool-group");
    const activityHead = activities[1]!.querySelector(".lyra-agents-tool-group-head")!;
    if (activityHead.getAttribute("aria-expanded") !== "true") fireEvent.click(activityHead);
    fireEvent.click(activities[1]!.querySelectorAll(".lyra-agents-tool-call-head")[6]!);
    expect(within(activities[1]!).getByText("Latest reasoning")).toBeInTheDocument();
    expect(activities[1]!.querySelectorAll(".lyra-agents-tool-call")).toHaveLength(7);
    view.unmount();
    const reopened = render(<Transcript state={complete} />);
    expect(reopened.container.querySelectorAll(".lyra-agents-message-process-fold")).toHaveLength(1);
    expect(reopened.container.querySelectorAll(".lyra-agents-time-text")).toHaveLength(1);
    expect(screen.getByText("Final response")).toBeInTheDocument();
    expect(reopened.container.querySelector(".lyra-agents-tool-call")).toBeNull();
  });

  it.each([null, "calling_model", "retrying_provider", "waiting_for_tool", "Unknown activity"])("never shows completion time while a turn runs with activity %s", (activity) => {
    const initial = snapshot();
    const state = { ...initial, messages: initial.messages.slice(0, -1) };
    const { container } = render(<Transcript state={state} followActivity={activity} />);
    expect(container.querySelector(".lyra-agents-time-text")).toBeNull();
    expect(screen.getByLabelText(t("lyra-agents-message.agentResponding"))).toBeInTheDocument();
  });

  it("keeps earlier completed turns settled while a new request has no assistant shell yet", () => {
    const initial = snapshot();
    const state: AgentSessionSnapshot = { ...initial, tools: [], messages: [
      { id: "old-user", role: "user", text: "Earlier question", createdAt: "2026-09-28T19:00:00.000Z" },
      { id: "old-answer", role: "assistant", text: "Earlier answer", createdAt: "2026-09-28T19:00:05.000Z" },
      { id: "new-user", role: "user", text: "New question", createdAt: "2026-09-28T20:55:27.000Z" }
    ] };
    const { container } = render(<Transcript state={state} />);
    expect(container.querySelector('[data-message-id="old-answer"] .lyra-agents-time-text')).not.toBeNull();
    expect(container.querySelector('[data-message-id="lyra-agent-loading"] .lyra-agents-time-text')).toBeNull();
    expect(container.querySelector('[data-message-id="lyra-agent-loading"] [aria-label]')).not.toBeNull();
    expect(resolveAgentActivityHostMessageId(agentSessionToChatMessages(state), true)).toBe("lyra-agent-loading");
  });
});
