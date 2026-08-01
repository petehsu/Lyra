import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import * as React from "react";
import * as ReactDomClient from "react-dom/client";
import * as ReactJsxRuntime from "react/jsx-runtime";

import type {
  HostHandlerV1,
  JsonValue,
  LyraHostApiV1
} from "../../packages/app-runtime/src/index.ts";
import { installFirstPartyUiRuntime } from "../../packages/workbench-ui-runtime/src/host.ts";
import {
  parseAgentGitDiffProjection,
  parseAgentGitProjection,
  parseAgentHistoryProjection,
  parseAgentPlanProjection,
  parseAgentProjectTreeProjection,
  parseAgentSessionProjection
} from "../../apps/lyra-agent/src/model.ts";

installFirstPartyUiRuntime({
  react: React,
  reactDomClient: ReactDomClient,
  jsxRuntime: ReactJsxRuntime
});

test("validates the bounded Agent session and history projections", () => {
  const session = parseAgentSessionProjection({
    id: "session-1",
    title: "Fix tests",
    agentMode: "oma",
    workingDir: "/workspace",
    projectBound: true,
    turnStatus: "idle",
    updatedAt: "2026-07-31T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        text: "Done",
        createdAt: "2026-07-31T00:00:00.000Z",
        rollbackAvailable: true
      },
      { id: "invalid", role: "tool", text: "hidden" }
    ],
    tools: [{ id: "tool-1", name: "read", label: "Read file", status: "completed" }],
    todos: [{ id: "todo-1", content: "Run tests", status: "completed", priority: "high" }],
    oma: {
      activeChannelId: "channel-1",
      agents: [{
        sessionAgentId: "member-1",
        agentId: "builder",
        name: "Builder",
        role: "developer",
        status: "idle"
      }],
      availableAgents: [],
      channels: [{
        id: "channel-1",
        name: "General",
        kind: "group",
        memberAgentIds: ["member-1"],
        archived: false
      }]
    },
    plan: null,
    projectTodo: null
  });
  assert.equal(session?.id, "session-1");
  assert.equal(session?.messages.length, 1);
  assert.equal(session?.messages[0]?.rollbackAvailable, true);
  assert.equal(session?.oma?.agents[0]?.agentId, "builder");

  const history = parseAgentHistoryProjection({
    sessionsDir: "/data/sessions",
    sessions: [{
      id: "session-1",
      title: "Fix tests",
      status: "idle",
      messageCount: 2,
      updatedAt: "2026-07-31T00:00:00.000Z",
      saved: true,
      archived: false,
      workingDir: "/workspace"
    }]
  });
  assert.deepEqual(history.sessions.map(({ id }) => id), ["session-1"]);
  assert.equal(history.sessions[0]?.saved, true);
});

test("validates project, plan, and Git projections without trusting malformed entries", () => {
  const tree = parseAgentProjectTreeProjection({
    instanceId: "tree-1",
    agentSessionId: "session-1",
    rootPath: "/workspace",
    title: "workspace",
    selectedPath: null,
    expandedPaths: ["/workspace"],
    entries: [
      { id: "src", name: "src", path: "/workspace/src", kind: "directory" },
      { id: "bad", name: "bad", path: "/workspace/bad", kind: "socket" }
    ]
  });
  assert.equal(tree?.entries.length, 1);
  assert.equal(tree?.entries[0]?.kind, "directory");

  const plan = parseAgentPlanProjection({
    mode: "manager",
    instanceId: "plan-1",
    agentSessionId: "session-1",
    title: "Plans",
    workingDir: "/workspace",
    plans: [{
      planId: "plan-a",
      title: "Modularize",
      status: "executing_todo",
      updatedAtIso: "2026-07-31T00:00:00.000Z"
    }],
    loading: false,
    error: null,
    selectedPlan: { title: "Modularize", markdown: "# Plan" },
    selectedProjectTodo: null
  });
  assert.equal(plan?.plans[0]?.planId, "plan-a");
  assert.equal(plan?.selectedPlan?.markdown, "# Plan");

  const git = parseAgentGitProjection({
    workingDir: "/workspace",
    isRepository: true,
    branch: "main",
    ahead: 1,
    behind: 0,
    updatedAt: "2026-07-31T00:00:00.000Z",
    summary: { changed: 1, staged: 0, unstaged: 1, untracked: 0, conflicts: 0 },
    entries: [{
      path: "src/index.ts",
      status: "modified",
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false
    }]
  });
  assert.equal(git.entries[0]?.path, "src/index.ts");
  assert.deepEqual(parseAgentGitDiffProjection({
    path: "src/index.ts",
    scope: "unstaged",
    diff: "@@ -1 +1 @@",
    isBinary: false
  }), {
    path: "src/index.ts",
    scope: "unstaged",
    diff: "@@ -1 +1 @@",
    isBinary: false
  });
});

test("loads all six Agent surfaces and delegates declared commands through Host API", async () => {
  const entry = path.resolve("apps/lyra-agent/dist/index.mjs");
  const source = await readFile(entry, "utf8");
  assert.equal(source.includes("@lyra/first-party-app-kit"), false);
  assert.equal(/from\s+["']react(?:-dom)?/u.test(source), false);

  const commands = new Map<string, HostHandlerV1>();
  const executions: Array<{ readonly commandId: string; readonly input: JsonValue }> = [];
  const host: LyraHostApiV1 = {
    apiVersion: "1.0.0",
    executeCommand: async (commandId, input) => {
      executions.push({ commandId, input });
      return null;
    },
    invokeCapability: async () => null,
    registerCommand: (commandId, handler) => {
      commands.set(commandId, handler);
      return {
        dispose: () => {
          if (commands.get(commandId) === handler) commands.delete(commandId);
        }
      };
    },
    registerCapability: () => ({ dispose() {} }),
    subscribeEvent: () => ({ dispose() {} })
  };
  const namespace = await import(`${pathToFileURL(entry).href}?agent-suite=${Date.now()}`);
  const module = namespace.lyraAppModule ?? namespace.default;
  const packageDocument = JSON.parse(
    await readFile(path.resolve("apps/lyra-agent/package.json"), "utf8")
  ) as { readonly version: string };
  assert.equal(module.id, "lyra.agent");
  assert.equal(module.version, packageDocument.version);
  await module.activate(host);

  const appIds = [
    "agent-solo",
    "agent-oma",
    "agent-project-tree",
    "agent-plan-board",
    "agent-git",
    "agent-session-history"
  ];
  const instances = [];
  for (const appId of appIds) {
    const instance = await module.restore({
      host,
      appId,
      instanceId: `agent-test-${appId}`,
      route: "/",
      opaqueState: { selected: appId }
    });
    assert.deepEqual(await module.snapshot(instance), { selected: appId });
    instances.push(instance);
  }

  await commands.get("lyra.agent.new-session")?.({ mode: "oma" });
  assert.deepEqual(executions.at(-1), {
    commandId: "lyra.core.agent.session.create",
    input: { mode: "oma" }
  });
  await commands.get("lyra.agent.refresh-git")?.({ instanceId: "git-1" });
  assert.deepEqual(executions.at(-1), {
    commandId: "lyra.core.agent.git.read",
    input: { instanceId: "git-1" }
  });

  for (const instance of instances) await module.close(instance);
  await module.deactivate();
  assert.equal(commands.size, 0);
});
