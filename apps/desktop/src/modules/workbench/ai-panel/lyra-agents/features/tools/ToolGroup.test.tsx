import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { SessionMeta, ToolCall, ToolGroup } from "../../core/types";
import { createDataProviderValue } from "../../data/createDataProviderValue";
import { DataContextProvider } from "../../data/DataProvider";
import { ToolGroupBlock } from "./ToolGroup";

const session: SessionMeta = {
  id: "session-1",
  title: "Session",
  project: "Lyra",
  workingDir: "/tmp",
  projectBound: true,
  workingDirIsHome: false,
  totalAdditions: 0,
  totalDeletions: 0
};

const agentCall: ToolCall = {
  id: "call-1",
  kind: "task",
  title: "Explore docs",
  status: "success",
  subagentId: "worker-1",
  details: { type: "text", body: "Worker report" }
};

const group: ToolGroup = {
  id: "group-1",
  label: "Tools",
  status: "done",
  calls: [agentCall]
};

const renderGroup = (nextGroup: ToolGroup, openSubagent = vi.fn()) => {
  const data = createDataProviderValue({
    session,
    messages: [],
    openSubagent
  });
  const view = render(
    <DataContextProvider value={data}>
      <ToolGroupBlock group={nextGroup} />
    </DataContextProvider>
  );
  return { ...view, openSubagent };
};

describe("ToolGroupBlock subagent cards", () => {
  test("title opens the worker workspace and the twist expands the report", () => {
    const { container, openSubagent } = renderGroup(group);

    fireEvent.click(container.querySelector(".lyra-agents-tool-group-head") as HTMLButtonElement);
    fireEvent.click(container.querySelector(".lyra-agents-tool-call-head") as HTMLButtonElement);

    expect(openSubagent).toHaveBeenCalledWith("worker-1", "Explore docs");
    expect(screen.queryByText("Worker report")).not.toBeInTheDocument();

    fireEvent.click(container.querySelector(".lyra-agents-tool-call-twist") as HTMLButtonElement);
    expect(screen.getByText("Worker report")).toBeInTheDocument();

    fireEvent.click(container.querySelector(".lyra-agents-tool-call-twist") as HTMLButtonElement);
    expect(container.querySelector(".lyra-agents-tool-call.open")).toBeNull();
    expect(screen.queryByText("Worker report")).not.toBeInTheDocument();
  });

  test("keeps a running Agent card collapsed until opened", () => {
    const runningCall: ToolCall = {
      ...agentCall,
      status: "running",
      details: { type: "text", body: "正在查看目录。" }
    };
    const runningGroup: ToolGroup = {
      id: "group-1",
      label: "Explore docs",
      status: "running",
      currentCallId: "call-1",
      calls: [runningCall]
    };

    const { container } = renderGroup(runningGroup);

    expect(screen.queryByText("正在查看目录。")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".lyra-agents-tool-group-head") as HTMLButtonElement);
    expect(screen.queryByText("正在查看目录。")).not.toBeInTheDocument();
    fireEvent.click(container.querySelector(".lyra-agents-tool-call-twist") as HTMLButtonElement);
    expect(screen.getByText("正在查看目录。")).toBeInTheDocument();
  });

  test("unmounts the previous tool body when another call expands", () => {
    const first: ToolCall = {
      id: "call-a",
      kind: "read",
      title: "Read A",
      status: "success",
      details: { type: "text", body: "Body A" }
    };
    const second: ToolCall = {
      id: "call-b",
      kind: "read",
      title: "Read B",
      status: "success",
      details: { type: "text", body: "Body B" }
    };
    const { container } = renderGroup({
      id: "group-1",
      label: "Tools",
      status: "done",
      calls: [first, second]
    });

    fireEvent.click(container.querySelector(".lyra-agents-tool-group-head") as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: "Read A" }));
    expect(screen.getByText("Body A")).toBeInTheDocument();
    expect(screen.queryByText("Body B")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Read B" }));
    expect(screen.queryByText("Body A")).not.toBeInTheDocument();
    expect(screen.getByText("Body B")).toBeInTheDocument();
    expect(container.querySelectorAll(".lyra-agents-tool-call-body")).toHaveLength(1);
    expect(container.querySelector(".lyra-syntax-source")).not.toBeNull();
  });

  test("thinking output follows the bottom until the pointer hovers it", () => {
    const runningGroup: ToolGroup = {
      id: "group-think",
      label: "Tools",
      status: "running",
      calls: []
    };
    const data = createDataProviderValue({
      session,
      messages: [],
      openSubagent: vi.fn()
    });
    const view = render(
      <DataContextProvider value={data}>
        <ToolGroupBlock
          group={runningGroup}
          thinkingEntries={[{ id: "think-1", body: "line 1\nline 2", status: "running" }]}
        />
      </DataContextProvider>
    );
    fireEvent.click(view.container.querySelector(".lyra-agents-tool-group-head") as HTMLButtonElement);
    fireEvent.click(view.container.querySelector(".lyra-agents-tool-call-twist") as HTMLButtonElement);
    const scroller = view.container.querySelector(".lyra-agents-tool-call-body") as HTMLDivElement;
    expect(scroller).not.toBeNull();
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 80 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 400 });
    scroller.scrollTop = 0;

    view.rerender(
      <DataContextProvider value={data}>
        <ToolGroupBlock
          group={runningGroup}
          thinkingEntries={[{ id: "think-1", body: "line 1\nline 2\nline 3", status: "running" }]}
        />
      </DataContextProvider>
    );
    expect(scroller.scrollTop).toBe(400);

    fireEvent.mouseEnter(scroller);
    scroller.scrollTop = 40;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 520 });
    view.rerender(
      <DataContextProvider value={data}>
        <ToolGroupBlock
          group={runningGroup}
          thinkingEntries={[{ id: "think-1", body: "line 1\nline 2\nline 3\nline 4", status: "running" }]}
        />
      </DataContextProvider>
    );
    expect(scroller.scrollTop).toBe(40);

    fireEvent.mouseLeave(scroller);
    expect(scroller.scrollTop).toBe(520);
  });

  test("shimmer follows running status for every tool kind", () => {
    const cases: Array<{ name: string; group: ToolGroup; running: boolean }> = [
      {
        name: "web",
        running: true,
        group: {
          id: "web",
          label: "Searched web",
          status: "running",
          currentCallId: "web-1",
          calls: [{ id: "web-1", kind: "web", title: "Searched web", status: "running" }]
        }
      },
      {
        name: "shell failed",
        running: false,
        group: {
          id: "shell",
          label: "Ran shell",
          status: "done",
          calls: [{ id: "shell-1", kind: "shell", title: "Ran shell", status: "warning" }]
        }
      },
      {
        name: "cancelled turn",
        running: false,
        group: {
          id: "cancelled",
          label: "Fetched",
          status: "done",
          calls: [{ id: "fetch-1", kind: "web", title: "Fetched", status: "success" }]
        }
      },
      {
        name: "live agent",
        running: true,
        group: {
          id: "live-agent",
          label: "Explore docs",
          status: "running",
          currentCallId: "agent-1",
          calls: [{
            id: "agent-1",
            kind: "task",
            title: "Explore docs",
            status: "running",
            subagentId: "worker-1",
            details: { type: "text", body: "working" }
          }]
        }
      },
      {
        name: "dead agent",
        running: false,
        group: {
          id: "dead-agent",
          label: "Explore docs",
          status: "done",
          calls: [{
            id: "agent-1",
            kind: "task",
            title: "Explore docs",
            status: "success",
            subagentId: "worker-1"
          }]
        }
      }
    ];

    for (const item of cases) {
      const { container, unmount } = renderGroup(item.group);
      expect({
        name: item.name,
        running: container.querySelector(".lyra-agents-mode-running") !== null
      }).toEqual({ name: item.name, running: item.running });
      unmount();
    }
  });

  test("shows the file basename and keeps the full path for hover", () => {
    const { container } = renderGroup({
      id: "group-read",
      label: "Agent activity",
      status: "done",
      calls: [{
        id: "read-1",
        kind: "read",
        title: "Read file",
        status: "success",
        details: {
          type: "read",
          file: "Documents/Lyra/apps/desktop/src/modules/workbench/theme/semantic.ts"
        }
      }]
    });

    fireEvent.click(container.querySelector(".lyra-agents-tool-group-head") as HTMLButtonElement);
    const target = container.querySelector(".lyra-agents-tool-call-target") as HTMLElement;
    expect(target).toHaveAttribute(
      "title",
      "Documents/Lyra/apps/desktop/src/modules/workbench/theme/semantic.ts"
    );
    expect(target.querySelector(".lyra-agents-tool-call-target-name")?.textContent).toBe("semantic.ts");
  });

  test("shows how many agents are in the group", () => {
    renderGroup({
      id: "group-agents",
      label: "2 agents",
      status: "done",
      calls: [
        {
          id: "agent-1",
          kind: "task",
          title: "Explore theme",
          status: "success",
          subagentId: "worker-1",
          details: { type: "text", body: "report" }
        },
        {
          id: "agent-2",
          kind: "task",
          title: "Inspect runtime",
          status: "success",
          subagentId: "worker-2",
          details: { type: "text", body: "report" }
        }
      ]
    });

    expect(screen.getByRole("button", { name: "2 agents" })).toBeInTheDocument();
  });
});
