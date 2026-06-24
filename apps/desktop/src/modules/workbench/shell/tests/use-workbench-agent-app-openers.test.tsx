import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type { AgentPlanBoardModel } from "../../agent-plan-board";
import type { AgentProjectTreeModel } from "../../agent-project-tree";
import type { WorkspaceTabsModel } from "../../workspace-tabs";
import { useWorkbenchAgentAppOpeners } from "../use-workbench-agent-app-openers";

const createTabsModel = (): WorkspaceTabsModel => ({
  tabs: [],
  openAppTab: vi.fn(),
  updateAppTabMeta: vi.fn(),
  setActiveTab: vi.fn(),
} as unknown as WorkspaceTabsModel);

const createProjectTreeModel = (): AgentProjectTreeModel => ({
  getState: vi.fn(() => null),
  ensureInstance: vi.fn(),
  syncTabInstances: vi.fn(),
  revealPath: vi.fn(),
  openFile: vi.fn().mockResolvedValue(undefined),
  toggleDirectory: vi.fn(),
  updateRoot: vi.fn(),
});

const createPlanBoardModel = (): AgentPlanBoardModel => ({
  getState: vi.fn(() => null),
  ensureInstance: vi.fn(),
  ensureManagerInstance: vi.fn(),
  refreshManager: vi.fn().mockResolvedValue(undefined),
  openManagedPlan: vi.fn().mockResolvedValue(undefined),
  deleteManagedPlan: vi.fn().mockResolvedValue(undefined),
  revisePlan: vi.fn().mockResolvedValue(undefined),
  syncTabInstances: vi.fn(),
});

describe("useWorkbenchAgentAppOpeners", () => {
  test("opens file paths in the bound project tree editor even when requested as reveal", async () => {
    const tabsModel = createTabsModel();
    const agentProjectTreeModel = createProjectTreeModel();
    const agentPlanBoardModel = createPlanBoardModel();
    const desktopApi = {
      files: {
        statFile: vi.fn().mockResolvedValue({
          path: "/project/src/App.tsx",
          exists: true,
          isDirectory: false,
          readOnly: false,
          sizeBytes: 42,
        }),
      },
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() =>
      useWorkbenchAgentAppOpeners({
        desktopApi,
        tabsModel,
        agentProjectTreeModel,
        agentPlanBoardModel,
      })
    );

    await act(async () => {
      await result.current.onRevealAgentProjectPath({
        sessionId: "session-1",
        workingDir: "/project",
        path: "/project/src/App.tsx",
        mode: "reveal",
      });
    });

    expect(agentProjectTreeModel.openFile).toHaveBeenCalledWith(
      "agent-project-tree-session-1",
      "/project/src/App.tsx",
      undefined
    );
    expect(agentProjectTreeModel.revealPath).not.toHaveBeenCalled();
  });

  test("reveals directory paths in the bound project tree", async () => {
    const tabsModel = createTabsModel();
    const agentProjectTreeModel = createProjectTreeModel();
    const agentPlanBoardModel = createPlanBoardModel();
    const desktopApi = {
      files: {
        statFile: vi.fn().mockResolvedValue({
          path: "/project/src",
          exists: true,
          isDirectory: true,
          readOnly: false,
          sizeBytes: 0,
        }),
      },
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() =>
      useWorkbenchAgentAppOpeners({
        desktopApi,
        tabsModel,
        agentProjectTreeModel,
        agentPlanBoardModel,
      })
    );

    await act(async () => {
      await result.current.onRevealAgentProjectPath({
        sessionId: "session-1",
        workingDir: "/project",
        path: "/project/src",
        mode: "reveal",
      });
    });

    expect(agentProjectTreeModel.revealPath).toHaveBeenCalledWith(
      "agent-project-tree-session-1",
      "/project/src"
    );
    expect(agentProjectTreeModel.openFile).not.toHaveBeenCalled();
  });

  test("opens the project plan manager in its own workspace app instance", () => {
    const tabsModel = createTabsModel();
    const agentProjectTreeModel = createProjectTreeModel();
    const agentPlanBoardModel = createPlanBoardModel();

    const { result } = renderHook(() =>
      useWorkbenchAgentAppOpeners({
        desktopApi: null,
        tabsModel,
        agentProjectTreeModel,
        agentPlanBoardModel,
      })
    );

    act(() => {
      result.current.onOpenAgentProjectPlanManager({
        sessionId: "session-1",
        workingDir: "/project",
      });
    });

    expect(agentPlanBoardModel.ensureManagerInstance).toHaveBeenCalledWith(
      "agent-plan-board-manager-session-1-project",
      {
        agentSessionId: "session-1",
        workingDir: "/project",
        title: "Plans and Todos",
      }
    );
    expect(tabsModel.openAppTab).toHaveBeenCalledWith(expect.objectContaining({
      appId: "agent-plan-board",
      appInstanceId: "agent-plan-board-manager-session-1-project",
      title: "Plans and Todos",
    }));
  });
});
