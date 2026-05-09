import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { createTranslator } from "../../i18n";
import type { AgentSessionDetail } from "../agent-ui-types";
import { createSurfaceTextLabels } from "../surface-model";
import { AiPanelSurfaceView } from "../surface-view";
import type { AiPanelSurfaceProps } from "../types";
import type { AiPanelSurfaceRuntime } from "../use-ai-panel-surface-runtime";
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

  test("disables the composer while a clarification is pending", () => {
    const t = createTranslator("zh-CN");
    render(
      <AiPanelSurfaceView
        surfaceProps={createSurfaceProps()}
        locale="zh-CN"
        aiPanelSide="left"
        textLabels={createSurfaceTextLabels(t)}
        runtime={createSurfaceRuntimeWithPendingClarification()}
      />
    );

    const input = screen.getByRole("textbox", { name: "输入" });
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "等待澄清回复...");
  });

  test("keeps long work and follow process status out of the main surface", () => {
    const t = createTranslator("zh-CN");
    render(
      <AiPanelSurfaceView
        surfaceProps={createSurfaceProps()}
        locale="zh-CN"
        aiPanelSide="left"
        textLabels={createSurfaceTextLabels(t)}
        runtime={createSurfaceRuntime(createChromeDetail(), true)}
      />
    );

    expect(screen.getByLabelText("Agent todo")).toBeDefined();
    expect(screen.getAllByText("Current todo").length).toBeGreaterThan(0);
    expect(screen.queryByText("Long Work")).toBeNull();
    expect(screen.queryByLabelText("Follow process")).toBeNull();
  });
});

const createSurfaceProps = (): AiPanelSurfaceProps => ({
  variant: "sidebar",
  desktopApi: null,
  locale: "zh-CN",
  title: "AI 面板",
  newSessionTitle: "新会话",
  defaultModelNames: ["gpt-test"],
  composeAriaLabel: "输入",
  composePlaceholder: "输入内容",
  composeSendLabel: "发送",
  emptyThreadLabel: "暂无会话",
});

const createSurfaceRuntimeWithPendingClarification = (): AiPanelSurfaceRuntime => {
  const detail = createClarificationDetail();
  return createSurfaceRuntime(detail, false);
};

const createSurfaceRuntime = (detail: AgentSessionDetail, followEnabled: boolean): AiPanelSurfaceRuntime => {
  const noOp = vi.fn();
  const noOpAsync = vi.fn(async () => {});
  return {
    state: {
      threads: [],
      threadTabs: [
        {
          tabId: "tab-1",
          threadId: "session-1",
          title: "Project",
          openedAt: 1,
          updatedAt: 1,
          status: "running",
        },
      ],
      activeTabId: "tab-1",
      activeThreadId: "session-1",
      activeThread: null,
      activeDetail: detail,
      planModeEnabled: false,
      followEnabled,
      optimisticUserMessages: [],
      isLoadingThreads: false,
      isLoadingThread: false,
      isSending: false,
      isStreamActive: false,
      streamingTurnId: null,
      streamingAssistantText: "",
      runtimeError: null,
    },
    actions: {
      activateThreadTab: noOp,
      closeThreadTab: noOp,
      reorderThreadTab: noOp,
      openThreadTab: noOp,
      selectModelOptionValue: noOp,
      setSelectedReasoningEffort: noOp,
      setSelectedVerbosity: noOp,
      setPermissionMode: noOp,
      setExecutionTarget: noOp,
      setComposerHeight: noOp,
      createThread: noOpAsync,
      bindProject: noOpAsync,
      togglePlanMode: noOp,
      toggleFollow: noOp,
      enableFollow: noOp,
      interruptTurn: noOpAsync,
      applyPatch: vi.fn(),
      resolveApproval: vi.fn(),
      resolvePlanReview: vi.fn(),
      pauseFollow: noOpAsync,
      resumeFollow: noOpAsync,
      refreshActiveThread: noOpAsync,
      sendTurn: noOpAsync,
      steerActiveTurn: noOpAsync,
      startFileMentionSearch: noOpAsync,
      updateFileMentionSearch: noOpAsync,
      stopFileMentionSearch: noOpAsync,
      setExpandedPatchKey: noOp,
    },
    composerAppendRequest: null,
    composerReserveStyle: {},
    expandedPatchKey: null,
    modelOptions: [{ value: "gpt-test", label: "gpt-test", model: "gpt-test", modelProvider: "test" }],
    selectedModelOption: { value: "gpt-test", label: "gpt-test", model: "gpt-test", modelProvider: "test" },
    reasoningEffortOptions: [],
    selectedReasoningEffort: null,
    verbosityOptions: [],
    selectedVerbosity: null,
    agentEnvironment: {
      permissionMode: "sandbox",
      executionTarget: "host",
    },
    permissionModeOptions: [
      { value: "sandbox", label: "Sandbox" },
      { value: "full_access", label: "Full Access" },
    ],
    executionTargetOptions: [
      { value: "host", label: "Host" },
      { value: "agent_vm", label: "Agent VM" },
    ],
    fileMentionSearchRoots: [],
    fileMentionSearchResults: [],
    workbenchTabMentions: [],
    aiThreadMentions: [],
    boundProjectRootForActiveThread: "/repo",
    tabProjectRootById: new Map([["tab-1", "/repo"]]),
    isBindingProject: false,
    isCreatingThread: false,
    isBusy: false,
    isAgentAvailable: true,
  };
};

const createClarificationDetail = (): AgentSessionDetail => ({
  session: {
    id: "session-1",
    title: "Project",
    profileId: "profile-1",
    projectRoot: "/repo",
    projectName: "repo",
    collaborationMode: "default",
    createdAt: 1,
    updatedAt: 1,
  },
  pendingInteractions: [
    {
      id: "clarification-1",
      sessionId: "session-1",
      turnId: "turn-1",
      kind: "clarification",
      status: "pending",
      payload: {
        questionTicketId: "question-1",
        title: "Clarification",
        question: "Which file should be edited?",
        options: [
          { id: "A", label: "A", description: "Use README" },
          { id: "B", label: "B", description: "Use docs" },
          { id: "C", label: "C", description: "Use source" },
          { id: "D", label: "D", description: "Use tests" },
        ],
        allowCustomAnswer: true,
      },
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  turns: [
    {
      id: "turn-1",
      sessionId: "session-1",
      profileId: "profile-1",
      status: "paused",
      collaborationMode: "default",
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  messages: [],
  runtimeEvents: [],
});

const createChromeDetail = (): AgentSessionDetail => ({
  session: {
    id: "session-1",
    title: "Project",
    profileId: "profile-1",
    projectRoot: "/repo",
    projectName: "repo",
    collaborationMode: "default",
    createdAt: 1,
    updatedAt: 1,
  },
  pendingInteractions: [],
  turns: [],
  messages: [],
  runtimeEvents: [],
  activeTodo: {
    todoListId: "todo-list-1",
    sessionId: "session-1",
    kind: "mini",
    status: "running",
    title: "Current todo",
    source: {},
    items: [{
      todoItemId: "todo-item-1",
      todoListId: "todo-list-1",
      status: "running",
      title: "Current todo",
      actions: [],
      expectedTools: ["/tools/filesystem/read_file"],
      riskLevel: "low",
      completionCriteria: [],
      evidenceRefs: [],
      blockers: [],
      source: {},
      createdAt: 1,
      updatedAt: 2,
    }],
    createdAt: 1,
    updatedAt: 2,
  },
  longWorkSummary: {
    longWorkRunId: "long-work-1",
    goalId: "goal-1",
    sessionId: "session-1",
    todoListId: "todo-list-1",
    executionRunId: "execution-1",
    status: "running",
    objectiveSummary: "Keep working",
    todoProgress: {
      total: 1,
      completed: 0,
      blocked: 0,
      failed: 0,
    },
    createdAt: 1,
    updatedAt: 2,
  },
  followSummary: {
    followSessionId: "follow-1",
    sessionId: "session-1",
    status: "auto_following",
    activeTargetId: "target-1",
    activeTarget: {
      followTargetId: "target-1",
      kind: "file",
      title: "src/app.ts",
      workspaceUri: "src/app.ts",
      status: "active",
      artifactRefs: [],
      evidenceRefs: [],
      updatedAt: 2,
    },
    targets: [],
    recentEvents: [],
    updatedAt: 2,
  },
});
