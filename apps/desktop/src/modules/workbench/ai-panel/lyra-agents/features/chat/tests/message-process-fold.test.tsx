import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { ChatMessage, SessionMeta } from "../../../core/types";
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

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector(".lyra-agents-message-process-fold .lyra-agents-collapse")
    ).toHaveAttribute("data-open", "true");
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
    expect(screen.getAllByRole("button", { name: "Agent 活动" })).toHaveLength(1);
    const firstThinking = screen.getByText("先判断。").closest(".lyra-agents-tool-call");
    const firstTool = screen.getByRole("button", { name: "搜索代码" }).closest(".lyra-agents-tool-call");
    const secondThinking = screen.getByText("再判断。").closest(".lyra-agents-tool-call");
    const secondTool = screen.getByRole("button", { name: "读取文件" }).closest(".lyra-agents-tool-call");
    const thirdThinking = screen.getByText("最后判断。").closest(".lyra-agents-tool-call");
    expectBefore(firstThinking, firstTool);
    expectBefore(firstTool, secondThinking);
    expectBefore(secondThinking, secondTool);
    expectBefore(secondTool, thirdThinking);
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
    const answer = screen.getByText("当前打开了 13 个标签页。");
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
});
