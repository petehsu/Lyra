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
        openRuntimeTargetPath={vi.fn(async () => {})}
        onOpenThread={onOpenThread}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "child-thread-2" }));

    expect(screen.getByRole("button", { name: "child-thread-1" })).toBeDefined();
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    expect(onOpenThread).toHaveBeenCalledWith("child-thread-2");
  });
});
