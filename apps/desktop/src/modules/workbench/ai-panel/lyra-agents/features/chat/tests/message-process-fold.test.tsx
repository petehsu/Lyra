import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { ChatMessage, SessionMeta, ToolCall } from "../../../core/types";
import { setLocale } from "@workbench/i18n";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import { Message } from "../Message";

const session: SessionMeta = {
  title: "New session",
  project: "Lyra",
  workingDir: "/Users/petehsu/Documents/Lyra",
  projectBound: true,
  workingDirIsHome: false,
  totalAdditions: 0,
  totalDeletions: 0
};

const renderMessage = (message: ChatMessage, isTurnRunning = false) => {
  const data = createDataProviderValue({
    session,
    messages: [message],
    isTurnRunning
  });
  return render(
    <DataContextProvider value={data}>
      <Message
        message={message}
        showActivityIndicator={isTurnRunning}
        activityIndicatorMessage={message}
      />
    </DataContextProvider>
  );
};

const expectBefore = (left: Element | null, right: Element | null) => {
  if (left === null || right === null) {
    throw new Error("Expected both activity rows to render");
  }
  expect(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
};

const completedAgentMessage: ChatMessage = {
  id: "agent-1",
  author: "agent",
  blocks: [
    { type: "text", id: "narration-1", body: "我先检查项目结构。" },
    {
      type: "tools",
      id: "tools-1",
      group: {
        id: "group-1",
        status: "done",
        label: "Agent 活动",
        calls: [{
          id: "call-1",
          kind: "search",
          title: "搜索代码",
          status: "success",
          details: {
            type: "search",
            query: "Agent 活动",
            results: []
          }
        }]
      }
    },
    { type: "text", id: "summary-1", body: "已完成：新增总折叠。" }
  ],
  time: "23:10",
  workDurationMs: 2_000
};

describe("agent message process fold", () => {
  test("collapses narration and tools before the final summary", () => {
    setLocale("zh-CN");
    const { container } = renderMessage(completedAgentMessage);

    expect(screen.getByText("已完成：新增总折叠。")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "已工作 2秒" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector(".lyra-agents-message-process-fold .lyra-agents-collapse")
    ).toHaveAttribute("data-open", "false");

    expect(screen.queryByText("我先检查项目结构。")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector(".lyra-agents-message-process-fold .lyra-agents-collapse")
    ).toHaveAttribute("data-open", "true");
    expect(screen.getByText("我先检查项目结构。")).toBeInTheDocument();
  });

  test("merges consecutive tool folds before the final summary", () => {
    setLocale("zh-CN");
    renderMessage({
      ...completedAgentMessage,
      id: "agent-consecutive-tools",
      blocks: [
        completedAgentMessage.blocks[1]!,
        {
          type: "tools",
          id: "tools-2",
          group: {
            id: "group-2",
            status: "done",
            label: "Agent 活动",
            calls: [{
              id: "call-2",
              kind: "read",
              title: "读取文件",
              status: "success",
              details: {
                type: "read",
                file: "README.md"
              }
            }]
          }
        },
        { type: "text", id: "summary-2", body: "完成。" }
      ]
    });

    expect(screen.queryByRole("button", { name: "Agent 活动" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "已工作 2秒" }));
    expect(screen.getAllByRole("button", { name: "Agent 活动" })).toHaveLength(1);
  });

  test("keeps consecutive thinking and tool blocks in one activity fold", () => {
    setLocale("zh-CN");
    const { container } = renderMessage({
      id: "agent-thinking-tools",
      author: "agent",
      blocks: [
        { type: "thinking", id: "thinking-1", body: "先判断。", status: "done" },
        completedAgentMessage.blocks[1]!,
        { type: "thinking", id: "thinking-2", body: "再判断。", status: "done" },
        {
          type: "tools",
          id: "tools-2",
          group: {
            id: "group-2",
            status: "done",
            label: "Agent 活动",
            calls: [{
              id: "call-2",
              kind: "read",
              title: "读取文件",
              status: "success",
              details: {
                type: "read",
                file: "README.md"
              }
            }]
          }
        },
        { type: "thinking", id: "thinking-3", body: "最后判断。", status: "running" }
      ]
    });

    expect(container.querySelectorAll(".lyra-agents-message-body > .lyra-agents-tool-group")).toHaveLength(1);
    const groupHead = container.querySelector(".lyra-agents-tool-group-head");
    expect(groupHead).toHaveAccessibleName("思考中");
    expect(groupHead).toHaveAttribute("aria-expanded", "true");

    const rows = [...container.querySelectorAll(".lyra-agents-tool-call")];
    expect(rows).toHaveLength(5);
    const firstThinking = rows[0] ?? null;
    const firstTool = rows[1] ?? null;
    const secondThinking = rows[2] ?? null;
    const secondTool = rows[3] ?? null;
    const thirdThinking = rows[4] ?? null;
    const runningThinkingTitle = thirdThinking?.querySelector(".lyra-agents-tool-call-title");

    expect(firstTool).toHaveTextContent("搜索代码");
    expect(secondTool).toHaveTextContent("读取文件");
    expect(runningThinkingTitle).toHaveAttribute("data-active", "true");
    expectBefore(firstThinking, firstTool);
    expectBefore(firstTool, secondThinking);
    expectBefore(secondThinking, secondTool);
    expectBefore(secondTool, thirdThinking);
  });

  test("moves the running tool shimmer into the expanded second level", () => {
    setLocale("zh-CN");
    const { container } = renderMessage({
      id: "agent-running-tool",
      author: "agent",
      blocks: [{
        type: "tools",
        id: "tools-running",
        group: {
          id: "group-running",
          status: "running",
          label: "Agent 活动",
          currentCallId: "call-running",
          calls: [{
            id: "call-running",
            kind: "read",
            title: "读取文件",
            status: "running",
            details: {
              type: "read",
              file: "README.md"
            }
          }]
        }
      }]
    }, true);

    const groupHead = container.querySelector(".lyra-agents-tool-group-head");
    const groupLabel = container.querySelector(".lyra-agents-tool-group-label");
    expect(groupLabel?.querySelector(".lyra-ui-shimmer")).toHaveAttribute("data-active", "true");
    expect(container.querySelector(".lyra-agents-tool-call")).toBeNull();

    fireEvent.click(groupHead!);

    const runningToolTitle = container.querySelector(
      ".lyra-agents-tool-call .lyra-agents-tool-call-title"
    );
    expect(groupLabel?.querySelector('.lyra-ui-shimmer[data-active="true"]')).toBeNull();
    expect(runningToolTitle).toHaveAttribute("data-active", "true");
  });

  test("folds a single thinking block into agent activity in message order", () => {
    setLocale("zh-CN");
    renderMessage({
      id: "agent-thinking-order",
      author: "agent",
      blocks: [
        { type: "thinking", id: "thinking-1", body: "先判断当前标签页。", status: "done" },
        { type: "text", id: "text-1", body: "当前打开了 13 个标签页。" }
      ]
    });

    const thinking = screen.getByRole("button", { name: "Agent 活动" });
    const iconClass = thinking
      .querySelector(".lyra-agents-tool-group-lead svg")
      ?.getAttribute("class") ?? "";
    const answer = screen.getByText("当前打开了 13 个标签页。");
    expect(iconClass).toContain("circle-check");
    expect(thinking.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("does not fold simple completed agent text", () => {
    setLocale("zh-CN");
    renderMessage({
      id: "agent-simple",
      author: "agent",
      blocks: [{ type: "text", id: "text-1", body: "普通回答" }]
    });

    expect(screen.queryByRole("button", { name: "已工作 2秒" })).not.toBeInTheDocument();
  });

  test("keeps an active turn expanded while it is still running", () => {
    setLocale("zh-CN");
    renderMessage(completedAgentMessage, true);

    expect(screen.queryByRole("button", { name: "已工作 2秒" })).not.toBeInTheDocument();
  });

  test("keeps an earlier completed process fold closed while a later turn is running", () => {
    setLocale("zh-CN");
    const data = createDataProviderValue({
      session,
      messages: [completedAgentMessage],
      isTurnRunning: true
    });
    const { container } = render(
      <DataContextProvider value={data}>
        <Message
          message={completedAgentMessage}
          showActivityIndicator={false}
          activityIndicatorMessage={null}
        />
      </DataContextProvider>
    );

    const toggle = screen.getByRole("button", { name: "已工作 2秒" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector(".lyra-agents-message-process-fold .lyra-agents-collapse")
    ).toHaveAttribute("data-open", "false");
    expect(screen.queryByText("我先检查项目结构。")).not.toBeInTheDocument();
  });

  test("keeps an empty pending agent message mounted while the turn is running", () => {
    const { container } = renderMessage({
      id: "agent-1",
      author: "agent",
      blocks: [{ type: "text", id: "text-1", body: "" }]
    }, true);

    expect(container.querySelector("[data-message-id=\"agent-1\"]")).not.toBeNull();
  });

  test("colors the activity fold by Lyra errors, work warnings, then success", () => {
    setLocale("zh-CN");
    const successCall: ToolCall = {
      id: "call-ok",
      kind: "search",
      title: "搜索代码",
      status: "success"
    };
    const warningCall: ToolCall = {
      id: "call-warn",
      kind: "shell",
      title: "运行测试",
      status: "warning"
    };
    const errorCall: ToolCall = {
      id: "call-err",
      kind: "search",
      title: "Inspect tool",
      status: "error"
    };
    const foldClass = (calls: ToolCall[]) => {
      const { container } = renderMessage({
        id: `agent-tone-${calls.map((call) => call.id).join("-")}`,
        author: "agent",
        blocks: [{
          type: "tools",
          id: "tools-tone",
          group: {
            id: "group-tone",
            status: "done",
            label: "Agent activity",
            calls
          }
        }]
      });
      return container.querySelector(".lyra-agents-tool-group")?.className ?? "";
    };

    expect(foldClass([successCall])).toContain("lyra-agents-mode-done");
    expect(foldClass([successCall, warningCall])).toContain("lyra-agents-mode-warning");
    expect(foldClass([successCall, warningCall, errorCall])).toContain("lyra-agents-mode-error");
  });
});
