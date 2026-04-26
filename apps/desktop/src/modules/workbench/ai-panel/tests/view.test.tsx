import { render, screen } from "@testing-library/react";
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
        description="AI 面板描述"
        themeSignature="test-theme"
        newSessionTitle="新会话"
        defaultProfileName="Lyra Agent"
        defaultModelNames={[]}
        profileLabel="配置"
        modelLabel="模型"
        modelsLabel="模型列表"
        openHistoryLabel="历史记录"
        openMcpLabel="MCP"
        openSkillsLabel="技能"
        bindProjectLabel="绑定项目"
        composeAriaLabel="输入"
        composePlaceholder="输入内容"
        composeSendLabel="发送"
        emptyStateTitle="空状态"
        emptyStateDescription="暂无内容"
        readOnlyBannerLabel="只读"
        loadingSessionLabel="加载中"
        emptyThreadLabel="暂无会话"
        turnNoToolCallsLabel="无工具调用"
        turnWorkingLabel="处理中"
        turnFailedLabel="失败"
        turnWorkedForPrefix="耗时"
        runtimeQueuedLabel="已排队"
        runtimeStartedLabel="已开始"
        runtimeRunningPrefix="运行中"
        runtimeCompletedPrefix="已完成"
        runtimeFailedPrefix="失败"
        runtimeCompletedTurnLabel="回合完成"
        runtimeFailedTurnLabel="回合失败"
        runtimePhasePrefixLabel="阶段"
        runtimePhaseIdleLabel="空闲"
        runtimePhaseAcceptedLabel="已接受"
        runtimePhaseStartedLabel="已开始"
        runtimePhaseToolStartedLabel="工具开始"
        runtimePhaseToolFinishedLabel="工具完成"
        runtimePhaseCompletedLabel="已完成"
        runtimePhaseFailedLabel="失败"
        runtimeToolFallbackLabel="工具"
        toolNameSearchLabel="搜索"
        toolNameReadRangeLabel="读取范围"
        toolNameListLabel="列表"
        toolNameGlobLabel="匹配"
        toolNameWriteLabel="写入"
        toolNameEditLabel="编辑"
        toolNameMultiEditLabel="批量编辑"
        toolStatusRunningLabel="运行中"
        toolStatusCompletedLabel="已完成"
        toolStatusFailedLabel="失败"
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
});
