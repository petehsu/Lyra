import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AiPanelRuntimeFeedBlock } from "../runtime-feed-block";
import type { AgentRuntimeFeedItem } from "../runtime/feed-utils";

const statusLabels = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

describe("AiPanelRuntimeFeedBlock", () => {
  test("renders every collab receiver thread as an openable target", () => {
    const onOpenThread = vi.fn();
    const item: AgentRuntimeFeedItem = {
      id: "agent-wait-1",
      turnId: "turn-1",
      toolName: "collab.wait",
      toolLabel: "Wait",
      target: "child-thread-1, child-thread-2",
      icon: "agent",
      openThreadId: "child-thread-1",
      openThreadTargets: [
        { threadId: "child-thread-1", label: "child-thread-1" },
        { threadId: "child-thread-2", label: "child-thread-2" },
      ],
      status: "completed",
      timestamp: 100,
    };

    render(
      <AiPanelRuntimeFeedBlock
        items={[item]}
        canOpenPath={false}
        statusLabels={statusLabels}
        showFullOutputLabel="Show full output"
        expandToolOutputLabel="Expand output"
        collapseToolOutputLabel="Collapse output"
        fileChangesLabel="File changes"
        openRuntimeTargetPath={vi.fn(async () => {})}
        onOpenThread={onOpenThread}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "child-thread-2" }));

    expect(screen.getByRole("button", { name: "child-thread-1" })).toBeDefined();
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    expect(onOpenThread).toHaveBeenCalledWith("child-thread-2");
  });

  test("keeps completed tool details folded", () => {
    const item: AgentRuntimeFeedItem = {
      id: "terminal-1",
      turnId: "turn-1",
      toolName: "terminal.exec",
      toolLabel: "terminal command",
      target: "npm test",
      icon: "tool",
      status: "completed",
      timestamp: 100,
      liveOutput: "test output",
    };

    render(
      <AiPanelRuntimeFeedBlock
        items={[item]}
        canOpenPath={false}
        statusLabels={statusLabels}
        showFullOutputLabel="Show full output"
        expandToolOutputLabel="Expand output"
        collapseToolOutputLabel="Collapse output"
        fileChangesLabel="File changes"
        openRuntimeTargetPath={vi.fn(async () => {})}
      />
    );

    expect(screen.queryByText("test output")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand output" }));

    expect(screen.getByText("test output")).toBeDefined();
  });

  test("keeps completed tool groups folded until expanded", () => {
    const items: AgentRuntimeFeedItem[] = [
      {
        id: "terminal-1",
        turnId: "turn-1",
        toolName: "terminal.exec",
        toolLabel: "terminal command",
        target: "npm test",
        icon: "tool",
        status: "completed",
        timestamp: 100,
      },
      {
        id: "terminal-2",
        turnId: "turn-1",
        toolName: "terminal.exec",
        toolLabel: "terminal command",
        target: "npm run lint",
        icon: "tool",
        status: "completed",
        timestamp: 101,
      },
    ];

    render(
      <AiPanelRuntimeFeedBlock
        items={items}
        canOpenPath={false}
        statusLabels={statusLabels}
        showFullOutputLabel="Show full output"
        expandToolOutputLabel="Expand output"
        collapseToolOutputLabel="Collapse output"
        fileChangesLabel="File changes"
        openRuntimeTargetPath={vi.fn(async () => {})}
      />
    );

    expect(screen.queryByText("npm test")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand output" }));
    expect(screen.getByText("npm test")).toBeDefined();
    expect(screen.getByText("npm run lint")).toBeDefined();
  });

  test("shows running tool details by default", () => {
    const item: AgentRuntimeFeedItem = {
      id: "terminal-1",
      turnId: "turn-1",
      toolName: "terminal.exec",
      toolLabel: "terminal command",
      target: "npm test",
      icon: "tool",
      status: "running",
      timestamp: 100,
      liveOutput: "running output",
    };

    render(
      <AiPanelRuntimeFeedBlock
        items={[item]}
        canOpenPath={false}
        statusLabels={statusLabels}
        showFullOutputLabel="Show full output"
        expandToolOutputLabel="Expand output"
        collapseToolOutputLabel="Collapse output"
        fileChangesLabel="File changes"
        openRuntimeTargetPath={vi.fn(async () => {})}
      />
    );

    expect(screen.getByText("running output")).toBeDefined();
  });
});
