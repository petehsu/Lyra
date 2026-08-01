import { useEffect } from "react";

import type { JsonValue } from "@lyra/app-runtime";

import type { AgentPlanBoardModel } from "../agent-plan-board";
import type { AgentProjectTreeModel } from "../agent-project-tree";
import { registerWorkspaceCoreCommand } from "../workspace-apps";
import type { WorkspaceTab, WorkspaceTabsModel } from "../workspace-tabs";
import { getDesktopApi } from "./service";

export const AGENT_CORE_HOST_COMMANDS = {
  readSession: "lyra.core.agent.session.read",
  createSession: "lyra.core.agent.session.create",
  sendTurn: "lyra.core.agent.session.send-turn",
  cancelTurn: "lyra.core.agent.session.cancel-turn",
  setMode: "lyra.core.agent.session.set-mode",
  addOmaAgent: "lyra.core.agent.oma.add-agent",
  removeOmaAgent: "lyra.core.agent.oma.remove-agent",
  setOmaChannel: "lyra.core.agent.oma.set-channel",
  listHistory: "lyra.core.agent.history.list",
  readHistorySession: "lyra.core.agent.history.read-session",
  renameHistorySession: "lyra.core.agent.history.rename",
  saveHistorySession: "lyra.core.agent.history.save",
  archiveHistorySession: "lyra.core.agent.history.archive",
  deleteHistorySession: "lyra.core.agent.history.delete",
  readProjectTree: "lyra.core.agent.project-tree.read",
  readProjectDirectory: "lyra.core.agent.project-tree.read-directory",
  toggleProjectDirectory: "lyra.core.agent.project-tree.toggle-directory",
  openProjectFile: "lyra.core.agent.project-tree.open-file",
  readPlan: "lyra.core.agent.plan.read",
  refreshPlans: "lyra.core.agent.plan.refresh",
  openPlan: "lyra.core.agent.plan.open",
  deletePlan: "lyra.core.agent.plan.delete",
  revisePlan: "lyra.core.agent.plan.revise",
  readGit: "lyra.core.agent.git.read",
  readGitDiff: "lyra.core.agent.git.read-diff",
  stageGitFile: "lyra.core.agent.git.stage",
  unstageGitFile: "lyra.core.agent.git.unstage",
  discardGitFile: "lyra.core.agent.git.discard"
} as const;

const asRecord = (value: JsonValue): Readonly<Record<string, JsonValue>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent Core command input must be an object.");
  }
  return value as Readonly<Record<string, JsonValue>>;
};

const optionalString = (
  input: Readonly<Record<string, JsonValue>>,
  key: string
): string | undefined => {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const requiredString = (
  input: Readonly<Record<string, JsonValue>>,
  key: string
): string => {
  const value = optionalString(input, key);
  if (value === undefined) {
    throw new Error(`Agent Core command field is required: ${key}`);
  }
  return value;
};

const toJsonValue = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const appTabForInstance = (
  tabsModel: WorkspaceTabsModel,
  instanceId: string,
  appId?: string
): WorkspaceTab | undefined =>
  tabsModel.tabs.find((tab) =>
    tab.pageKind === "app"
    && tab.appInstanceId === instanceId
    && (appId === undefined || tab.appId === appId)
  );

const projectSession = (snapshot: {
  readonly id: string;
  readonly title: string;
  readonly agentMode: "solo" | "oma";
  readonly workingDir: string;
  readonly projectBound: boolean;
  readonly messages: readonly {
    readonly id: string;
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
    readonly createdAt: string;
    readonly rollback?: { readonly available: boolean } | null;
  }[];
  readonly tools: readonly {
    readonly id: string;
    readonly name: string;
    readonly label: string;
    readonly status: string;
  }[];
  readonly todos: readonly {
    readonly id: string;
    readonly content: string;
    readonly status: string;
    readonly priority: string;
  }[];
  readonly oma: {
    readonly activeChannelId: string;
    readonly agents: readonly {
      readonly sessionAgentId?: string | null;
      readonly agentId: string;
      readonly name: string;
      readonly role: string;
      readonly status: string;
      readonly temporary?: boolean;
    }[];
    readonly availableAgents: readonly {
      readonly sessionAgentId?: string | null;
      readonly agentId: string;
      readonly name: string;
      readonly role: string;
      readonly status: string;
      readonly temporary?: boolean;
    }[];
    readonly channels: readonly {
      readonly id: string;
      readonly name: string;
      readonly kind: string;
      readonly memberAgentIds: readonly string[];
      readonly archived: boolean;
    }[];
  } | null;
  readonly plan?: unknown;
  readonly projectTodo?: unknown;
  readonly turnStatus: string;
  readonly activeTurnId?: string | null;
  readonly updatedAt: string;
}): JsonValue => toJsonValue({
  id: snapshot.id,
  title: snapshot.title,
  agentMode: snapshot.agentMode,
  workingDir: snapshot.workingDir,
  projectBound: snapshot.projectBound,
  messages: snapshot.messages.slice(-200).map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    rollbackAvailable: message.rollback?.available === true
  })),
  tools: snapshot.tools.slice(-200).map((tool) => ({
    id: tool.id,
    name: tool.name,
    label: tool.label,
    status: tool.status
  })),
  todos: snapshot.todos,
  oma: snapshot.oma === null
    ? null
    : {
        activeChannelId: snapshot.oma.activeChannelId,
        agents: snapshot.oma.agents.map((agent) => ({
          sessionAgentId: agent.sessionAgentId ?? agent.agentId,
          agentId: agent.agentId,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          temporary: agent.temporary === true
        })),
        availableAgents: snapshot.oma.availableAgents.map((agent) => ({
          sessionAgentId: agent.sessionAgentId ?? agent.agentId,
          agentId: agent.agentId,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          temporary: agent.temporary === true
        })),
        channels: snapshot.oma.channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          kind: channel.kind,
          memberAgentIds: channel.memberAgentIds,
          archived: channel.archived
        }))
      },
  plan: snapshot.plan ?? null,
  projectTodo: snapshot.projectTodo ?? null,
  turnStatus: snapshot.turnStatus,
  activeTurnId: snapshot.activeTurnId ?? null,
  updatedAt: snapshot.updatedAt
});

const requireAgent = () => {
  const agent = getDesktopApi()?.agent;
  if (agent === undefined) {
    throw new Error("Lyra Agent runtime is unavailable.");
  }
  return agent;
};

const sessionIdFromInput = (
  tabsModel: WorkspaceTabsModel,
  input: Readonly<Record<string, JsonValue>>
): string | undefined => {
  const explicit = optionalString(input, "sessionId");
  if (explicit !== undefined) return explicit;
  const instanceId = optionalString(input, "instanceId");
  if (instanceId === undefined) return undefined;
  return appTabForInstance(tabsModel, instanceId)?.fileSessionId;
};

const gitContext = (
  tabsModel: WorkspaceTabsModel,
  input: Readonly<Record<string, JsonValue>>
): { readonly workingDir: string; readonly sessionId?: string } => {
  const explicitWorkingDir = optionalString(input, "workingDir");
  const instanceId = optionalString(input, "instanceId");
  const tab = instanceId === undefined
    ? undefined
    : appTabForInstance(tabsModel, instanceId, "agent-git");
  const workingDir = explicitWorkingDir ?? tab?.filePath?.trim();
  if (workingDir === undefined || workingDir.length === 0) {
    throw new Error("Agent Git working directory is unavailable.");
  }
  const sessionId = optionalString(input, "sessionId") ?? tab?.fileSessionId?.trim();
  return {
    workingDir,
    ...(sessionId === undefined || sessionId.length === 0 ? {} : { sessionId })
  };
};

export const useWorkspaceAgentCommandBus = ({
  tabsModel,
  agentProjectTreeModel,
  agentPlanBoardModel
}: {
  readonly tabsModel: WorkspaceTabsModel;
  readonly agentProjectTreeModel: AgentProjectTreeModel;
  readonly agentPlanBoardModel: AgentPlanBoardModel;
}): void => {
  useEffect(() => {
    const registrations = [
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.readSession, async (value) => {
        const input = asRecord(value);
        const sessionId = sessionIdFromInput(tabsModel, input);
        const snapshot = await requireAgent().readSession(
          sessionId === undefined ? {} : { sessionId }
        );
        return projectSession(snapshot);
      }, "agent:read"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.createSession, async (value) => {
        const input = asRecord(value);
        const mode = optionalString(input, "mode");
        if (mode !== undefined && mode !== "solo" && mode !== "oma") {
          throw new Error(`Agent mode is invalid: ${mode}`);
        }
        const title = optionalString(input, "title");
        const workingDir = optionalString(input, "workingDir");
        const snapshot = await requireAgent().createSession({
          ...(title === undefined ? {} : { title }),
          ...(workingDir === undefined ? {} : { workingDir }),
          ...(mode === undefined ? {} : { agentMode: mode })
        });
        return projectSession(snapshot);
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.sendTurn, async (value) => {
        const input = asRecord(value);
        const sessionId = requiredString(input, "sessionId");
        const channelId = optionalString(input, "channelId");
        await requireAgent().sendTurn({
          sessionId,
          text: requiredString(input, "text"),
          ...(channelId === undefined ? {} : { channelId })
        });
        return projectSession(await requireAgent().readSession({ sessionId }));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.cancelTurn, async (value) => {
        const sessionId = requiredString(asRecord(value), "sessionId");
        await requireAgent().cancelTurn({ sessionId });
        return projectSession(await requireAgent().readSession({ sessionId }));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.setMode, async (value) => {
        const input = asRecord(value);
        const mode = requiredString(input, "mode");
        if (mode !== "solo" && mode !== "oma") {
          throw new Error(`Agent mode is invalid: ${mode}`);
        }
        return projectSession(await requireAgent().setAgentMode({
          sessionId: requiredString(input, "sessionId"),
          mode
        }));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.addOmaAgent, async (value) => {
        const input = asRecord(value);
        return projectSession(await requireAgent().addOmaAgent({
          sessionId: requiredString(input, "sessionId"),
          agentId: requiredString(input, "agentId")
        }));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.removeOmaAgent, async (value) => {
        const input = asRecord(value);
        return projectSession(await requireAgent().removeOmaAgent({
          sessionId: requiredString(input, "sessionId"),
          agentId: requiredString(input, "agentId")
        }));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.setOmaChannel, async (value) => {
        const input = asRecord(value);
        return projectSession(await requireAgent().setOmaActiveChannel({
          sessionId: requiredString(input, "sessionId"),
          channelId: requiredString(input, "channelId")
        }));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.listHistory, async (value) => {
        const input = asRecord(value);
        const rawLimit = input.limit;
        const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(1_000, Math.floor(rawLimit)))
          : 200;
        return toJsonValue(await requireAgent().listSessions({ limit }));
      }, "agent:read"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.readHistorySession, async (value) => {
        const sessionId = requiredString(asRecord(value), "sessionId");
        return projectSession(await requireAgent().readSession({ sessionId }));
      }, "agent:read"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.renameHistorySession, async (value) => {
        const input = asRecord(value);
        return toJsonValue(await requireAgent().renameSession({
          sessionId: requiredString(input, "sessionId"),
          title: optionalString(input, "title") ?? null
        }));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.saveHistorySession, async (value) => {
        const input = asRecord(value);
        const saved = input.saved !== false;
        const agent = requireAgent();
        return toJsonValue(saved
          ? await agent.saveSession({
              sessionId: requiredString(input, "sessionId"),
              label: optionalString(input, "label") ?? null
            })
          : await agent.unsaveSession({ sessionId: requiredString(input, "sessionId") }));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.archiveHistorySession, async (value) => {
        const input = asRecord(value);
        return toJsonValue(await requireAgent().archiveSession({
          sessionId: requiredString(input, "sessionId"),
          archived: input.archived === true
        }));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.deleteHistorySession, async (value) => {
        return toJsonValue(await requireAgent().deleteSession({
          sessionId: requiredString(asRecord(value), "sessionId")
        }));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.readProjectTree, async (value) => {
        const instanceId = requiredString(asRecord(value), "instanceId");
        const state = agentProjectTreeModel.getState(instanceId);
        if (state === null) return null;
        const directory = await getDesktopApi()?.files.readDirectory({ path: state.rootPath });
        return toJsonValue({
          ...state,
          entries: directory?.entries ?? []
        });
      }, "agent:read"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.readProjectDirectory, async (value) => {
        const path = requiredString(asRecord(value), "path");
        const files = getDesktopApi()?.files;
        if (files === undefined) {
          throw new Error("Lyra file service is unavailable.");
        }
        return toJsonValue(await files.readDirectory({ path }));
      }, "agent:read"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.toggleProjectDirectory, async (value) => {
        const input = asRecord(value);
        const instanceId = requiredString(input, "instanceId");
        agentProjectTreeModel.toggleDirectory(instanceId, requiredString(input, "path"));
        return toJsonValue(agentProjectTreeModel.getState(instanceId));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.openProjectFile, async (value) => {
        const input = asRecord(value);
        const instanceId = requiredString(input, "instanceId");
        await agentProjectTreeModel.openFile(instanceId, requiredString(input, "path"));
        return toJsonValue(agentProjectTreeModel.getState(instanceId));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.readPlan, async (value) => {
        return toJsonValue(agentPlanBoardModel.getState(
          requiredString(asRecord(value), "instanceId")
        ));
      }, "agent:read"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.refreshPlans, async (value) => {
        const instanceId = requiredString(asRecord(value), "instanceId");
        await agentPlanBoardModel.refreshManager(instanceId);
        return toJsonValue(agentPlanBoardModel.getState(instanceId));
      }, "agent:read"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.openPlan, async (value) => {
        const input = asRecord(value);
        const instanceId = requiredString(input, "instanceId");
        await agentPlanBoardModel.openManagedPlan(instanceId, requiredString(input, "planId"));
        return toJsonValue(agentPlanBoardModel.getState(instanceId));
      }, "agent:read"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.deletePlan, async (value) => {
        const input = asRecord(value);
        const instanceId = requiredString(input, "instanceId");
        await agentPlanBoardModel.deleteManagedPlan(instanceId, requiredString(input, "planId"));
        return toJsonValue(agentPlanBoardModel.getState(instanceId));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.revisePlan, async (value) => {
        const input = asRecord(value);
        const instanceId = requiredString(input, "instanceId");
        const current = agentPlanBoardModel.getState(instanceId);
        const plan = current?.mode === "detail" ? current.plan : current?.selectedPlan;
        if (plan === null || plan === undefined) {
          throw new Error("Agent plan is unavailable.");
        }
        await agentPlanBoardModel.revisePlan(instanceId, {
          markdown: requiredString(input, "markdown"),
          annotations: plan.annotations,
          source: "user_edit",
          summary: optionalString(input, "summary") ?? null
        });
        return toJsonValue(agentPlanBoardModel.getState(instanceId));
      }, "agent:write"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.readGit, async (value) => {
        const context = gitContext(tabsModel, asRecord(value));
        return toJsonValue(await requireAgent().readGitStatus({
          workingDir: context.workingDir
        }));
      }, "agent:git"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.readGitDiff, async (value) => {
        const input = asRecord(value);
        const context = gitContext(tabsModel, input);
        const scope = optionalString(input, "scope");
        if (scope !== undefined && scope !== "auto" && scope !== "staged" && scope !== "unstaged") {
          throw new Error(`Agent Git diff scope is invalid: ${scope}`);
        }
        return toJsonValue(await requireAgent().readGitDiff({
          workingDir: context.workingDir,
          path: requiredString(input, "path"),
          ...(scope === undefined ? {} : { scope })
        }));
      }, "agent:git"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.stageGitFile, async (value) => {
        const input = asRecord(value);
        const context = gitContext(tabsModel, input);
        return toJsonValue((await requireAgent().stageGitFile({
          workingDir: context.workingDir,
          path: requiredString(input, "path")
        })).snapshot);
      }, "agent:git"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.unstageGitFile, async (value) => {
        const input = asRecord(value);
        const context = gitContext(tabsModel, input);
        return toJsonValue((await requireAgent().unstageGitFile({
          workingDir: context.workingDir,
          path: requiredString(input, "path")
        })).snapshot);
      }, "agent:git"),
      registerWorkspaceCoreCommand(AGENT_CORE_HOST_COMMANDS.discardGitFile, async (value) => {
        const input = asRecord(value);
        const context = gitContext(tabsModel, input);
        return toJsonValue((await requireAgent().discardGitFile({
          workingDir: context.workingDir,
          path: requiredString(input, "path")
        })).snapshot);
      }, "agent:git")
    ];
    return () => {
      for (const registration of registrations) registration.dispose();
    };
  }, [agentPlanBoardModel, agentProjectTreeModel, tabsModel]);
};
