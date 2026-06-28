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
