import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { GlobalDialogOpenRequest } from "../../global-dialog";
import { subscribeThreadSelected } from "../../thread-selection-events";
import { AiHistorySurface } from "../view";

type LyraRequest = { readonly method?: unknown; readonly params?: Record<string, unknown> };

type ThreadFixture = {
  readonly id: string;
  readonly name?: string | null;
  readonly preview: string;
  readonly modelProvider: string;
  readonly cwd?: string | null;
  readonly boundProjectRoot?: string | null;
  readonly updatedAt: number;
};

const fixtureThreads: readonly ThreadFixture[] = [
  {
    id: "thread-a",
    name: "Refactor agent runtime",
    preview: "Start refactor agent runtime",
    modelProvider: "lp-openai",
    cwd: "/Users/dev/project-a",
    boundProjectRoot: "/Users/dev/project-a",
    updatedAt: 1_700_000_300
  },
  {
    id: "thread-b",
    name: null,
    preview: "Brainstorm ideas",
    modelProvider: "lp-openai",
    cwd: "/Users/dev",
    boundProjectRoot: null,
    updatedAt: 1_700_000_200
  },
  {
    id: "thread-c",
    name: null,
    preview: "Review PR for project a",
    modelProvider: "lp-openai",
    cwd: "/Users/dev/project-a",
    boundProjectRoot: "/Users/dev/project-a",
    updatedAt: 1_700_000_100
  },
  {
    id: "thread-d",
    name: "Explore dataset",
    preview: "Look at new dataset",
    modelProvider: "lp-openai",
    cwd: "/Users/dev/project-b",
    boundProjectRoot: "/Users/dev/project-b",
    updatedAt: 1_700_000_050
  }
];

const createThreadDetail = (threadId: string): Record<string, unknown> | null => {
  const thread = fixtureThreads.find((entry) => entry.id === threadId);
  if (thread === undefined) {
    return null;
  }
  return {
    ...thread,
    createdAt: thread.updatedAt - 60,
    turns: [
      {
        id: `${thread.id}-turn`,
        status: "completed",
        startedAt: thread.updatedAt - 30,
        completedAt: thread.updatedAt,
        items: [
          {
            id: `${thread.id}-user`,
            type: "userMessage",
            content: [{ type: "text", text: thread.preview }]
          },
          {
            id: `${thread.id}-assistant`,
            type: "agentMessage",
            text: `Reply for ${thread.preview}`
          }
        ]
      }
    ]
  };
};

const createDesktopApi = () => {
  const request = vi.fn(async (payload: LyraRequest) => {
    if (payload.method === "thread/list") {
      return { data: payload.params?.archived === true ? [] : fixtureThreads };
    }
    if (payload.method === "thread/read") {
      return { thread: createThreadDetail(String(payload.params?.threadId ?? "")) };
    }
    return {};
  });

  return {
    api: {
      lyra: {
        request,
        resolveServerRequest: vi.fn(),
        rejectServerRequest: vi.fn(),
        health: vi.fn(),
        notify: vi.fn(),
        onEvent: () => () => undefined
      }
    } as never,
    request
  };
};

const baseLabels = {
  title: "历史",
  newSessionTitle: "新建会话",
  newConversationLabel: "新建会话",
  openConversationLabel: "打开会话",
  deleteConversationLabel: "删除会话",
  archiveConversationLabel: "归档会话",
  archivedConversationLabel: "已归档会话",
  archivedProjectLabel: "已归档项目会话",
  deleteArchivedConversationTitle: "永久删除已归档会话？",
  deleteArchivedConversationDescription: "删除后无法恢复",
  deleteArchivedConversationConfirm: "永久删除",
  deleteArchivedConversationCancel: "取消",
  profileLabel: "配置",
  sessionIdLabel: "Session ID",
  loadingSessionsLabel: "加载中",
  emptyStateTitle: "空",
  emptyStateDescription: "暂无会话",
  scopeGlobalLabel: "全部会话",
  scopeProjectLabel: "项目会话",
  noProjectSessionsEmptyLabel: "还没有历史会话",
  noProjectsEmptyLabel: "还没有绑定到项目的会话",
  projectSessionCountLabel: "个会话",
  backToProjectsLabel: "返回项目列表",
  projectPathLabel: "项目路径",
  threadPreviewEmptyLabel: "未命名会话",
  previewEmptyTitle: "选择一个会话",
  previewEmptyDescription: "点击左侧会话预览",
  previewLoadingLabel: "正在加载预览"
} as const;

describe("AiHistorySurface", () => {
  test("shows all threads by default and keeps project groups available", async () => {
    const desktop = createDesktopApi();
    render(
      <AiHistorySurface
        desktopApi={desktop.api}
        locale="en-US"
        {...baseLabels}
      />
    );

    await waitFor(() => {
      expect(desktop.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: "thread/list" })
      );
    });

    const globalTab = screen.getByRole("tab", { name: /^全部会话/u });
    const projectTab = screen.getByRole("tab", { name: /^项目会话/u });
    expect(globalTab.getAttribute("aria-selected")).toBe("true");
    expect(within(globalTab).getByText("4")).toBeDefined();
    expect(within(projectTab).getByText("2")).toBeDefined();

    expect(screen.getByText("Brainstorm ideas")).toBeDefined();
    expect(screen.getByText("Refactor agent runtime")).toBeDefined();
  });

  test("clicking a thread previews it and the open icon emits threadSelected", async () => {
    const desktop = createDesktopApi();
    const captured: string[] = [];
    const unsubscribe = subscribeThreadSelected((threadId) => {
      captured.push(threadId);
    });

    render(
      <AiHistorySurface
        desktopApi={desktop.api}
        locale="en-US"
        {...baseLabels}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Brainstorm ideas")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Brainstorm ideas"));

    await waitFor(() => {
      expect(desktop.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "thread/read",
          params: { threadId: "thread-b", includeTurns: true }
        })
      );
    });
    expect(screen.getByText("Reply for Brainstorm ideas")).toBeDefined();
    expect(captured).toEqual([]);

    const row = screen.getAllByText("Brainstorm ideas")[0]?.closest(".lyra-ai-history-row");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "打开会话" }));

    expect(captured).toEqual(["thread-b"]);
    unsubscribe();
  });

  test("project scope shows project cards; clicking drills into the project", async () => {
    const desktop = createDesktopApi();
    const captured: string[] = [];
    const unsubscribe = subscribeThreadSelected((threadId) => {
      captured.push(threadId);
    });

    render(
      <AiHistorySurface
        desktopApi={desktop.api}
        locale="en-US"
        {...baseLabels}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^项目会话/u })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: /^项目会话/u }));

    const projectAHeader = await screen.findByText("project-a");
    expect(projectAHeader).toBeDefined();
    expect(screen.getByText("project-b")).toBeDefined();

    act(() => {
      fireEvent.click(projectAHeader);
    });

    expect(screen.getByRole("button", { name: /返回项目列表/u })).toBeDefined();
    expect(screen.getByText("Refactor agent runtime")).toBeDefined();
    expect(screen.getByText("Review PR for project a")).toBeDefined();
    expect(screen.queryByText("Explore dataset")).toBeNull();

    const refactorRow = screen.getByText("Refactor agent runtime").closest(".lyra-ai-history-row");
    expect(refactorRow).not.toBeNull();
    fireEvent.click(screen.getByText("Refactor agent runtime"));
    await screen.findByText("Reply for Start refactor agent runtime");
    fireEvent.click(within(refactorRow as HTMLElement).getByRole("button", { name: "打开会话" }));
    expect(captured).toEqual(["thread-a"]);

    fireEvent.click(screen.getByRole("button", { name: /返回项目列表/u }));
    expect(screen.getByText("project-a")).toBeDefined();
    expect(screen.getByText("project-b")).toBeDefined();

    unsubscribe();
  });

	 test("shows project-bound sessions in the default all-sessions scope", async () => {
    const requestImpl = vi.fn(async (payload: LyraRequest) => {
      if (payload.method === "thread/list") {
        if (payload.params?.archived === true) {
          return { data: [] };
        }
        return {
          data: [
            {
              id: "thread-only-project",
              name: "Only project",
              preview: "",
              modelProvider: "lp-openai",
              cwd: "/Users/dev/project-a",
              boundProjectRoot: "/Users/dev/project-a",
              updatedAt: 1_700_000_500
            }
          ]
        };
      }
      return {};
    });

    render(
      <AiHistorySurface
        desktopApi={{
          lyra: {
            request: requestImpl,
            resolveServerRequest: vi.fn(),
            rejectServerRequest: vi.fn(),
            health: vi.fn(),
            notify: vi.fn(),
            onEvent: () => () => undefined
          }
        } as never}
        locale="en-US"
        {...baseLabels}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Only project")).toBeDefined();
    });
    expect(screen.queryByText("还没有历史会话")).toBeNull();
  });

  test("archived scope permanently deletes after dialog confirmation", async () => {
    const archivedThread = {
      id: "thread-archived",
      name: "Archived thread",
      preview: "Archived preview",
      modelProvider: "lp-openai",
      cwd: "/Users/dev/project-a",
      boundProjectRoot: "/Users/dev/project-a",
      updatedAt: 1_700_000_600
    };
    const request = vi.fn(async (payload: LyraRequest) => {
      if (payload.method === "thread/list") {
        return { data: payload.params?.archived === true ? [archivedThread] : [] };
      }
      return {};
    });
    const dialogRequests: GlobalDialogOpenRequest[] = [];

    render(
      <AiHistorySurface
        desktopApi={{
          lyra: {
            request,
            resolveServerRequest: vi.fn(),
            rejectServerRequest: vi.fn(),
            health: vi.fn(),
            notify: vi.fn(),
            onEvent: () => () => undefined
          }
        } as never}
        locale="en-US"
        {...baseLabels}
        openDialog={(requestPayload) => {
          dialogRequests.push(requestPayload);
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^已归档会话/u })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: /^已归档会话/u }));
    await screen.findByText("Archived thread");
    fireEvent.click(screen.getByRole("button", { name: "删除会话" }));

    const dialogRequest = dialogRequests[0];
    expect(dialogRequest?.title).toBe("永久删除已归档会话？");
    await act(async () => {
      dialogRequest?.actions?.find((action) => action.id === "ai-archive-delete-confirm")?.onSelect?.();
    });

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "thread/delete",
          params: { threadId: "thread-archived" }
        })
      );
    });
  });
});
