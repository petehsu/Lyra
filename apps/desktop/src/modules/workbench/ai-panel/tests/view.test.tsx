import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AiPanelSurface } from "../view";

describe("ai panel surface topbar", () => {
  test("does not render the generic panel title and keeps icon actions accessible", () => {
    render(
      <AiPanelSurface
        variant="sidebar"
        desktopApi={null}
        locale="zh-CN"
        title="AI 面板"
        newSessionTitle="新会话"
        defaultModelNames={[]}
        openHistoryLabel="历史记录"
        openMcpLabel="MCP"
        openSkillsLabel="技能"
        bindProjectLabel="绑定项目"
        composeAriaLabel="输入"
        composePlaceholder="输入内容"
        composeSendLabel="发送"
        emptyThreadLabel="暂无会话"
        onOpenHistory={vi.fn()}
        onOpenMcp={vi.fn()}
        onOpenSkills={vi.fn()}
        onRequestProjectBind={vi.fn(async () => null)}
      />
    );

    expect(screen.queryByText("AI 面板")).toBeNull();
    expect(screen.getByRole("button", { name: "新会话" })).toBeDefined();
    expect(screen.getByRole("button", { name: "历史记录" })).toBeDefined();
    expect(screen.getByRole("button", { name: "更多操作" })).toBeDefined();
    expect(screen.getByRole("button", { name: "绑定项目" })).toBeDisabled();
  });

  test("new conversation button creates a local draft tab", async () => {
    render(
      <AiPanelSurface
        variant="sidebar"
        desktopApi={null}
        locale="zh-CN"
        title="AI 面板"
        newSessionTitle="新会话"
        defaultProviderId="lp-openai"
        defaultModelNames={["gpt-test"]}
        composeAriaLabel="输入"
        composePlaceholder="输入内容"
        composeSendLabel="发送"
        emptyThreadLabel="暂无会话"
      />
    );

    expect(screen.getAllByRole("tab")).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新会话" }));
    });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });
});
