import type { LyraAppModule, LyraHostApiV1 } from "@lyra/app-runtime";
import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import {
  BUILTIN_PRODUCT_COMPONENTS,
  createWorkspaceAppInstance,
  registerWorkspaceAppModule
} from "../../workspace-apps";
import {
  AGENT_CORE_HOST_COMMANDS,
  useWorkspaceAgentCommandBus
} from "../use-workspace-agent-command-bus";

const sessionSnapshot = {
  id: "session-1",
  title: "Modularize",
  sessionKind: "persistent",
  agentMode: "solo" as const,
  oma: null,
  workingDir: "/workspace",
  projectBound: true,
  messages: [{
    id: "message-1",
    role: "assistant" as const,
    text: "Ready",
    createdAt: "2026-07-31T00:00:00.000Z"
  }],
  tools: [{
    id: "tool-1",
    name: "read",
    label: "Read",
    status: "completed" as const,
    input: {},
    startedAt: "2026-07-31T00:00:00.000Z"
  }],
  todos: [],
  turnStatus: "idle" as const,
  follow: { running: false },
  updatedAt: "2026-07-31T00:00:00.000Z"
};

describe("workspace Agent command bridge", () => {
  test("keeps the complete static Agent surface as the production readiness gate", () => {
    expect(
      BUILTIN_PRODUCT_COMPONENTS.find(({ componentId }) => componentId === "lyra.agent")
    ).toMatchObject({
      surfaceReadiness: "preview",
      appIds: [
        "agent-solo",
        "agent-oma",
        "agent-project-tree",
        "agent-plan-board",
        "agent-git",
        "agent-session-history"
      ]
    });
  });

  test("projects Agent sessions, app models, and Git through permission-checked JSON commands", async () => {
    let moduleHost: LyraHostApiV1 | null = null;
    const module: LyraAppModule = {
      id: "lyra.test-agent-bridge",
      version: "1.0.0",
      activate: (host) => { moduleHost = host; },
      create: ({ instanceId }) => ({ instanceId }),
      restore: ({ instanceId }) => ({ instanceId }),
      snapshot: () => ({}),
      close: () => undefined,
      deactivate: () => undefined
    };
    const unregister = registerWorkspaceAppModule(module, {
      allowedCapabilities: new Set(["agent:read", "agent:write", "agent:git"])
    });
    const readSession = vi.fn(async () => sessionSnapshot);
    const sendTurn = vi.fn(async () => ({
      sessionId: "session-1",
      status: "running" as const
    }));
    const readGitStatus = vi.fn(async () => ({
      workingDir: "/workspace",
      isRepository: true,
      branch: "main",
      ahead: 0,
      behind: 0,
      entries: [],
      summary: { changed: 0, staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
      updatedAt: "2026-07-31T00:00:00.000Z"
    }));
    const readDirectory = vi.fn(async () => ({
      location: { id: "/workspace", title: "workspace", kind: "directory", path: "/workspace" },
      entries: [{ id: "src", name: "src", path: "/workspace/src", kind: "directory" }]
    }));
    const previousDesktopApi = Object.getOwnPropertyDescriptor(window, "lyraDesktop");
    Object.defineProperty(window, "lyraDesktop", {
      configurable: true,
      value: {
        agent: {
          readSession,
          sendTurn,
          readGitStatus
        },
        files: { readDirectory }
      }
    });
    const projectTreeState = {
      instanceId: "tree-1",
      agentSessionId: "session-1",
      rootPath: "/workspace",
      title: "workspace",
      selectedPath: null,
      selectedFilePath: null,
      editorInstanceId: null,
      expandedPaths: ["/workspace"]
    };
    const agentProjectTreeModel = {
      getState: vi.fn(() => projectTreeState),
      toggleDirectory: vi.fn(),
      openFile: vi.fn(async () => undefined)
    };
    const planState = {
      mode: "manager" as const,
      instanceId: "plan-1",
      agentSessionId: "session-1",
      workingDir: "/workspace",
      title: "Plans",
      view: "both" as const,
      projectKey: "workspace",
      plans: [],
      loading: false,
      error: null,
      selectedPlan: null,
      selectedProjectTodo: null
    };
    const agentPlanBoardModel = {
      getState: vi.fn(() => planState),
      refreshManager: vi.fn(async () => undefined),
      openManagedPlan: vi.fn(async () => undefined),
      deleteManagedPlan: vi.fn(async () => undefined),
      revisePlan: vi.fn(async () => undefined)
    };
    const tabsModel = {
      tabs: [{
        id: "git-tab",
        title: "Git",
        pageKind: "app",
        inputValue: "",
        displayAddress: "lyra://app/agent-git/git-1",
        appId: "agent-git",
        appInstanceId: "git-1",
        filePath: "/workspace",
        fileSessionId: "session-1"
      }]
    };
    const hook = renderHook(() => useWorkspaceAgentCommandBus({
      tabsModel: tabsModel as never,
      agentProjectTreeModel: agentProjectTreeModel as never,
      agentPlanBoardModel: agentPlanBoardModel as never
    }));
    const instance = await createWorkspaceAppInstance({
      appId: "test-agent-bridge",
      componentId: module.id,
      instanceId: "test-agent-bridge-instance",
      route: "/"
    });
    try {
      const host = moduleHost as LyraHostApiV1 | null;
      if (host === null) throw new Error("Agent bridge test module did not activate.");
      await expect(host.executeCommand(AGENT_CORE_HOST_COMMANDS.readSession, {
        sessionId: "session-1"
      })).resolves.toMatchObject({
        id: "session-1",
        messages: [{ id: "message-1", text: "Ready" }],
        tools: [{ id: "tool-1", label: "Read" }]
      });
      await host.executeCommand(AGENT_CORE_HOST_COMMANDS.sendTurn, {
        sessionId: "session-1",
        text: "Continue"
      });
      expect(sendTurn).toHaveBeenCalledWith({
        sessionId: "session-1",
        text: "Continue"
      });

      await expect(host.executeCommand(AGENT_CORE_HOST_COMMANDS.readProjectTree, {
        instanceId: "tree-1"
      })).resolves.toMatchObject({
        rootPath: "/workspace",
        entries: [{ path: "/workspace/src", kind: "directory" }]
      });
      expect(readDirectory).toHaveBeenCalledWith({ path: "/workspace" });

      await host.executeCommand(AGENT_CORE_HOST_COMMANDS.refreshPlans, {
        instanceId: "plan-1"
      });
      expect(agentPlanBoardModel.refreshManager).toHaveBeenCalledWith("plan-1");

      await expect(host.executeCommand(AGENT_CORE_HOST_COMMANDS.readGit, {
        instanceId: "git-1"
      })).resolves.toMatchObject({ workingDir: "/workspace", branch: "main" });
      expect(readGitStatus).toHaveBeenCalledWith({ workingDir: "/workspace" });
    } finally {
      hook.unmount();
      await instance.close();
      await unregister();
      if (previousDesktopApi === undefined) {
        Reflect.deleteProperty(window, "lyraDesktop");
      } else {
        Object.defineProperty(window, "lyraDesktop", previousDesktopApi);
      }
    }
  });

  test("does not expose Agent reads without the signed component capability grant", async () => {
    let moduleHost: LyraHostApiV1 | null = null;
    const module: LyraAppModule = {
      id: "lyra.test-agent-denied",
      version: "1.0.0",
      activate: (host) => { moduleHost = host; },
      create: ({ instanceId }) => ({ instanceId }),
      restore: ({ instanceId }) => ({ instanceId }),
      snapshot: () => ({}),
      close: () => undefined,
      deactivate: () => undefined
    };
    const unregister = registerWorkspaceAppModule(module);
    const hook = renderHook(() => useWorkspaceAgentCommandBus({
      tabsModel: { tabs: [] } as never,
      agentProjectTreeModel: { getState: () => null } as never,
      agentPlanBoardModel: { getState: () => null } as never
    }));
    const instance = await createWorkspaceAppInstance({
      appId: "test-agent-denied",
      componentId: module.id,
      instanceId: "test-agent-denied-instance",
      route: "/"
    });
    try {
      const host = moduleHost as LyraHostApiV1 | null;
      if (host === null) throw new Error("Denied Agent test module did not activate.");
      await expect(host.executeCommand(AGENT_CORE_HOST_COMMANDS.readSession, {}))
        .rejects.toThrow("not granted");
    } finally {
      hook.unmount();
      await instance.close();
      await unregister();
    }
  });
});
