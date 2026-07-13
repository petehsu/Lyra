import { describe, expect, test } from "vitest";

import type { AgentSessionSnapshot } from "../../../shared/agent";
import {
  applyAgentRuntimeEventToSnapshot,
  mergeRunningSessionSnapshot,
  normalizeAgentSessionSnapshot
} from "./runtime-reducer";

const session = (
  overrides: Partial<AgentSessionSnapshot> = {}
): AgentSessionSnapshot => ({
  id: "session-1",
  title: "Session",
  sessionKind: "normal",
  agentMode: "solo",
  oma: null,
  workingDir: "/tmp",
  projectBound: false,
  messages: [],
  tools: [],
  todos: [],

  turnStatus: "idle",
  activeTurnId: null,
  follow: { running: false, activity: null },
  updatedAt: "2026-06-05T00:00:00.000Z",
  ...overrides
});

describe("applyAgentRuntimeEventToSnapshot", () => {
  test("normalizes legacy Oma collections omitted from persisted session snapshots", () => {
    const normalized = normalizeAgentSessionSnapshot({
      ...session({
        agentMode: "oma"
      }),
      oma: {
        enabled: true,
        activeChannelId: "group:default",
        agents: [],
        channels: []
      }
    } as unknown as AgentSessionSnapshot);

    expect(normalized.oma).toMatchObject({
      activeChannelId: "group:default",
      agents: [],
      availableAgents: [],
      channels: [],
      team: null
    });
  });

  test("ignores events for another session", () => {
    const current = session();
    const next = applyAgentRuntimeEventToSnapshot(current, {
      kind: "todoUpdated",
      sessionId: "session-2",
      todos: [{
        id: "todo-1",
        content: "Do work",
        status: "pending",
        priority: "normal"
      }]
    });

    expect(next).toBe(current);
  });

  test("updates message text and the addressed text block together", () => {
    const current = session({
      messages: [{
        id: "message-1",
        role: "assistant",
        text: "Hello",
        blocks: [{ type: "text", id: "text-1", text: "Hello" }],
        createdAt: "2026-06-05T00:00:00.000Z"
      }]
    });

    const next = applyAgentRuntimeEventToSnapshot(current, {
      kind: "messageDelta",
      sessionId: "session-1",
      messageId: "message-1",
      blockId: "text-1",
      delta: " world"
    });

    expect(next.messages[0]?.text).toBe("Hello world");
    expect(next.messages[0]?.blocks).toEqual([
      {
        type: "text",
        id: "text-1",
        text: "Hello world"
      }
    ]);
  });

  test("keeps reasoning blocks in stream order between text blocks", () => {
    const current = session({
      messages: [{
        id: "message-1",
        role: "assistant",
        text: "First.",
        blocks: [{ type: "text", id: "text-0", text: "First." }],
        createdAt: "2026-06-05T00:00:00.000Z"
      }]
    });

    const withReasoning = applyAgentRuntimeEventToSnapshot(current, {
      kind: "messageReasoningDelta",
      sessionId: "session-1",
      messageId: "message-1",
      blockId: "thinking-1",
      delta: "Think."
    });
    const next = applyAgentRuntimeEventToSnapshot(withReasoning, {
      kind: "messageDelta",
      sessionId: "session-1",
      messageId: "message-1",
      blockId: "text-2",
      delta: " Second."
    });

    expect(next.messages[0]?.blocks).toEqual([
      { type: "text", id: "text-0", text: "First." },
      { type: "thinking", id: "thinking-1", text: "Think.", status: "thinking" },
      { type: "text", id: "text-2", text: " Second." }
    ]);
  });

  test("keeps legacy assistant text when reasoning adds the first block", () => {
    const current = session({
      messages: [{
        id: "message-1",
        role: "assistant",
        text: "First.",
        createdAt: "2026-06-05T00:00:00.000Z"
      }]
    });

    const next = applyAgentRuntimeEventToSnapshot(current, {
      kind: "messageReasoningDelta",
      sessionId: "session-1",
      messageId: "message-1",
      blockId: "thinking-1",
      delta: "Think."
    });

    expect(next.messages[0]?.blocks).toEqual([
      { type: "text", id: "text-0", text: "First." },
      { type: "thinking", id: "thinking-1", text: "Think.", status: "thinking" }
    ]);
  });

  test("completed artifacted edit output replaces running preview", () => {
    const current = session({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "",
        blocks: [{ type: "tool", id: "tool-tool-1", toolId: "tool-1" }],
        createdAt: "2026-06-05T00:00:00.000Z"
      }],
      tools: [{
        id: "tool-1",
        name: "write_file",
        label: "Write file",
        status: "running",
        input: { path: "/tools/runtime/write_file", args: { path: "index.html" } },
        output: {
          raw: {
            preview: true,
            changedFiles: [{ path: "index.html" }],
            diff: ["--- index.html", "+++ index.html", "@@ -0,0 +12 @@", "+a"].join("\n")
          }
        },
        startedAt: "2026-06-05T00:00:01.000Z"
      }]
    });

    const next = applyAgentRuntimeEventToSnapshot(current, {
      kind: "toolFinished",
      sessionId: "session-1",
      tool: {
        id: "tool-1",
        name: "write_file",
        label: "Write file",
        status: "completed",
        input: { path: "/tools/runtime/write_file", args: { path: "column-site/index.html" } },
        output: {
          raw: {
            kind: "tool_raw_ref",
            changedFiles: [{
              path: "column-site/index.html",
              additions: 715,
              deletions: 0
            }],
            diffArtifactRef: { artifactId: "diff-1" }
          }
        },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:03.000Z"
      }
    });

    expect(next.tools[0]?.status).toBe("completed");
    expect(next.tools[0]?.output).toMatchObject({
      raw: {
        changedFiles: [{
          path: "column-site/index.html",
          additions: 715,
          deletions: 0
        }]
      }
    });
  });

  test("merges same-session snapshots even when current turn is idle", () => {
    const current = session({
      turnStatus: "idle",
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "Hello complete text",
        blocks: [{ type: "text", id: "text-1", text: "Hello complete text" }],
        createdAt: "2026-06-05T00:00:00.000Z"
      }]
    });

    const next = applyAgentRuntimeEventToSnapshot(current, {
      kind: "sessionSnapshot",
      snapshot: session({
        messages: [{
          id: "assistant-1",
          role: "assistant",
          text: "Hello",
          blocks: [{ type: "text", id: "text-1", text: "Hello" }],
          createdAt: "2026-06-05T00:00:00.000Z"
        }]
      })
    });

    expect(next.messages[0]?.text).toBe("Hello complete text");
    expect(next.messages[0]?.blocks?.[0]).toEqual({
      type: "text",
      id: "text-1",
      text: "Hello complete text"
    });
  });

  test("prefers incoming metadata when message content is equally rich", () => {
    const current = session({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "Hello",
        blocks: [{ type: "text", id: "text-1", text: "Hello" }],
        createdAt: "2026-06-05T00:00:00.000Z"
      }]
    });

    const next = mergeRunningSessionSnapshot(current, session({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "Hello",
        blocks: [{ type: "text", id: "text-1", text: "Hello" }],
        metadata: { oma: { channelId: "direct:reviewer" } },
        createdAt: "2026-06-05T00:00:00.000Z"
      }]
    }));

    expect(next.messages[0]?.metadata).toEqual({
      oma: { channelId: "direct:reviewer" }
    });
  });

  test("replaces committed messages in place", () => {
    const current = session({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "first",
          blocks: [{ type: "text", id: "text-1", text: "first" }],
          createdAt: "2026-06-05T00:00:00.000Z"
        },
        {
          id: "assistant-2",
          role: "assistant",
          text: "second",
          blocks: [{ type: "text", id: "text-2", text: "second" }],
          createdAt: "2026-06-05T00:00:01.000Z"
        }
      ]
    });

    const next = applyAgentRuntimeEventToSnapshot(current, {
      kind: "messageCommitted",
      sessionId: "session-1",
      message: {
        id: "assistant-1",
        role: "assistant",
        text: "first final",
        blocks: [{ type: "text", id: "text-1", text: "first final" }],
        createdAt: "2026-06-05T00:00:00.000Z"
      }
    });

    expect(next.messages.map((message) => message.id)).toEqual([
      "assistant-1",
      "assistant-2"
    ]);
    expect(next.messages[0]?.text).toBe("first final");
  });

  test("adds a tool block once while upserting tool activity", () => {
    const current = session({
      messages: [{
        id: "message-1",
        role: "assistant",
        text: "",
        blocks: [],
        createdAt: "2026-06-05T00:00:00.000Z"
      }]
    });
    const event = {
      kind: "toolStarted" as const,
      sessionId: "session-1",
      messageId: "message-1",
      tool: {
        id: "tool-1",
        name: "tool_fs_run",
        label: "Run tool",
        status: "running" as const,
        input: {},
        startedAt: "2026-06-05T00:00:01.000Z"
      }
    };

    const once = applyAgentRuntimeEventToSnapshot(current, event);
    const twice = applyAgentRuntimeEventToSnapshot(once, event);

    expect(twice.tools).toHaveLength(1);
    expect(twice.messages[0]?.blocks).toEqual([
      { type: "tool", id: "tool-tool-1", toolId: "tool-1" }
    ]);
  });

  test("updates plan snapshot from plan events", () => {
    const current = session();
    const plan = {
      activePlanId: "plan-1",
      activeVersionId: "version-1",
      projectKey: "project-1",
      title: "Implement plan mode",
      phase: "reviewing" as const,
      markdown: "# Plan",
      annotations: [],
      review: { status: "pending" as const, summary: "Ready" },
      reason: "Complex work",
      scope: "Runtime and UI"
    };

    const next = applyAgentRuntimeEventToSnapshot(current, {
      kind: "planReviewRequested",
      sessionId: "session-1",
      plan
    });

    expect(next.plan).toEqual(plan);
  });

  test("updates project todo and compatibility todos from project todo events", () => {
    const current = session();
    const todo = {
      todoListId: "todo-list-1",
      planId: "plan-1",
      versionId: "version-1",
      status: "running" as const,
      currentIndex: 0,
      todos: [{
        id: "todo-1",
        content: "Build runtime support",
        status: "in_progress",
        priority: "normal"
      }],
      summary: null
    };

    const next = applyAgentRuntimeEventToSnapshot(current, {
      kind: "projectTodoUpdated",
      sessionId: "session-1",
      todo
    });

    expect(next.projectTodo).toEqual(todo);
    expect(next.todos).toEqual(todo.todos);
  });

  test("appends toolStarted to last assistant message when messageId is missing", () => {
    const current = session({
      messages: [{
        id: "message-1",
        role: "assistant",
        text: "",
        blocks: [],
        createdAt: "2026-06-05T00:00:00.000Z"
      }]
    });
    const updated = applyAgentRuntimeEventToSnapshot(current, {
      kind: "toolStarted",
      sessionId: "session-1",
      tool: {
        id: "tool-stream-1",
        name: "apply_patch",
        label: "Apply patch",
        status: "running",
        input: { patch: "*** Begin Patch\n*** Update File: src/main.ts\n" },
        output: {
          raw: {
            diff: "--- src/main.ts\n+++ src/main.ts\n@@ -0,0 +1 @@\n+export const x = 1;"
          }
        },
        startedAt: "2026-06-05T00:00:01.000Z"
      }
    });

    expect(updated.messages[0]?.blocks).toEqual([
      { type: "tool", id: "tool-tool-stream-1", toolId: "tool-stream-1" }
    ]);
  });

  test("mergeRunningSessionSnapshot keeps streaming tool diff over stale snapshot", () => {
    const current = session({
      tools: [{
        id: "tool-1",
        name: "apply_patch",
        label: "Apply patch",
        status: "running",
        input: { patch: "*** Begin Patch\n*** Update File: src/main.ts\n" },
        output: {
          raw: {
            diff: "--- src/main.ts\n+++ src/main.ts\n@@ -0,0 +1,3 @@\n+line1\n+line2\n+line3",
            preview: true
          }
        },
        startedAt: "2026-06-05T00:00:01.000Z"
      }]
    });
    const incoming = session({
      tools: [{
        id: "tool-1",
        name: "apply_patch",
        label: "Apply patch",
        status: "running",
        input: { patch: "*** Begin Patch\n*** Update File: src/main.ts\n" },
        output: {
          content: "Editing src/main.ts"
        },
        startedAt: "2026-06-05T00:00:01.000Z"
      }]
    });

    const merged = mergeRunningSessionSnapshot(current, incoming);
    expect(merged.tools[0]?.output).toMatchObject({
      raw: {
        diff: expect.stringContaining("+line3")
      }
    });
  });

  test("upserts running tool diff on toolUpdated", () => {
    const current = session({
      tools: [{
        id: "tool-1",
        name: "apply_patch",
        label: "Apply patch",
        status: "running",
        input: { patch: "*** Begin Patch\n*** Update File: src/main.ts\n" },
        output: {
          raw: {
            diff: "--- src/main.ts\n+++ src/main.ts\n@@ -1 +1,2 @@\n-old\n+new"
          }
        },
        startedAt: "2026-06-05T00:00:01.000Z"
      }]
    });
    const updated = applyAgentRuntimeEventToSnapshot(current, {
      kind: "toolUpdated",
      sessionId: "session-1",
      turnId: "turn-1",
      tool: {
        id: "tool-1",
        name: "apply_patch",
        label: "Apply patch",
        status: "running",
        input: { patch: "*** Begin Patch\n*** Update File: src/main.ts\n" },
        output: {
          raw: {
            diff: [
              "--- src/main.ts",
              "+++ src/main.ts",
              "@@ -1 +1,3 @@",
              "-old",
              "+new",
              "+line"
            ].join("\n")
          }
        },
        startedAt: "2026-06-05T00:00:01.000Z"
      }
    });

    expect(updated.tools[0]?.output).toMatchObject({
      raw: {
        diff: expect.stringContaining("+line")
      }
    });
  });

  test("does not re-anchor an already linked running tool to a later assistant message", () => {
    const current = session({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "先检查目录。",
          blocks: [
            { type: "text", id: "text-1", text: "先检查目录。" },
            { type: "tool", id: "tool-tool-1", toolId: "tool-1" }
          ],
          createdAt: "2026-06-05T00:00:00.000Z"
        },
        {
          id: "assistant-2",
          role: "assistant",
          text: "目录为空，直接创建。",
          blocks: [{ type: "text", id: "text-2", text: "目录为空，直接创建。" }],
          createdAt: "2026-06-05T00:00:02.000Z"
        }
      ],
      tools: [{
        id: "tool-1",
        name: "write_file",
        label: "Write file",
        status: "running",
        input: { path: "index.html" },
        output: {
          raw: {
            diff: "--- index.html\n+++ index.html\n@@ -0,0 +1 @@\n+<html>",
            preview: true
          }
        },
        startedAt: "2026-06-05T00:00:01.000Z"
      }]
    });

    const updated = applyAgentRuntimeEventToSnapshot(current, {
      kind: "toolUpdated",
      sessionId: "session-1",
      turnId: "turn-1",
      tool: {
        id: "tool-1",
        name: "write_file",
        label: "Write file",
        status: "running",
        input: { path: "index.html" },
        output: {
          raw: {
            diff: "--- index.html\n+++ index.html\n@@ -0,0 +1,2 @@\n+<html>\n+<body>",
            preview: true
          }
        },
        startedAt: "2026-06-05T00:00:01.000Z"
      }
    });

    expect(updated.messages[0]?.blocks).toContainEqual({
      type: "tool",
      id: "tool-tool-1",
      toolId: "tool-1"
    });
    expect(updated.messages[1]?.blocks).toEqual([
      { type: "text", id: "text-2", text: "目录为空，直接创建。" }
    ]);
    expect(updated.tools[0]?.output).toMatchObject({
      raw: {
        diff: expect.stringContaining("+<body>")
      }
    });
  });

  test("keeps streaming edit preview through duplicate toolStarted and finishes with terminal status", () => {
    const current = session({
      messages: [{
        id: "assistant-1",
        role: "assistant",
        text: "",
        blocks: [{ type: "tool", id: "tool-tool-1", toolId: "tool-1" }],
        createdAt: "2026-06-05T00:00:00.000Z"
      }],
      tools: [{
        id: "tool-1",
        name: "write_file",
        label: "Write file",
        status: "running",
        input: { path: "index.html", content: "<html>" },
        output: {
          raw: {
            diff: "--- index.html\n+++ index.html\n@@ -0,0 +1 @@\n+<html>",
            preview: true
          }
        },
        startedAt: "2026-06-05T00:00:01.000Z"
      }]
    });

    const duplicateStarted = applyAgentRuntimeEventToSnapshot(current, {
      kind: "toolStarted",
      sessionId: "session-1",
      messageId: "assistant-1",
      tool: {
        id: "tool-1",
        name: "write_file",
        label: "Write file",
        status: "running",
        input: { path: "index.html", content: "<html>" },
        startedAt: "2026-06-05T00:00:01.000Z"
      }
    });

    expect(duplicateStarted.tools[0]?.output).toMatchObject({
      raw: {
        diff: expect.stringContaining("+<html>")
      }
    });

    const finished = applyAgentRuntimeEventToSnapshot(duplicateStarted, {
      kind: "toolFinished",
      sessionId: "session-1",
      tool: {
        id: "tool-1",
        name: "write_file",
        label: "Write file",
        status: "completed",
        input: { path: "index.html", content: "<html>" },
        output: {
          raw: {
            diff: "--- index.html\n+++ index.html\n@@ -0,0 +1,2 @@\n+<html>\n+</html>"
          }
        },
        startedAt: "2026-06-05T00:00:01.000Z",
        finishedAt: "2026-06-05T00:00:03.000Z"
      }
    });

    expect(finished.tools[0]?.status).toBe("completed");
    expect(finished.tools[0]?.finishedAt).toBe("2026-06-05T00:00:03.000Z");
    expect(finished.tools[0]?.output).toMatchObject({
      raw: {
        diff: expect.stringContaining("+</html>")
      }
    });
  });

  test("maps terminal turn states and clears completed turns", () => {
    const running = applyAgentRuntimeEventToSnapshot(session(), {
      kind: "turnStateChanged",
      sessionId: "session-1",
      turnId: "turn-1",
      state: "waiting_for_tool"
    });
    const completed = applyAgentRuntimeEventToSnapshot(running, {
      kind: "turnStateChanged",
      sessionId: "session-1",
      turnId: "turn-1",
      state: "completed"
    });

    expect(running.turnStatus).toBe("running");
    expect(running.activeTurnId).toBe("turn-1");
    expect(completed.turnStatus).toBe("idle");
    expect(completed.activeTurnId).toBeNull();
    expect(completed.follow.running).toBe(false);
  });

  test("maps backend cancelled turn state as terminal", () => {
    const current = session({
      turnStatus: "running",
      activeTurnId: "turn-1",
      follow: { running: true, activity: "calling_model" }
    });

    const cancelled = applyAgentRuntimeEventToSnapshot(current, {
      kind: "turnStateChanged",
      sessionId: "session-1",
      turnId: "turn-1",
      state: "cancelled"
    });

    expect(cancelled.turnStatus).toBe("cancelled");
    expect(cancelled.activeTurnId).toBeNull();
    expect(cancelled.follow.running).toBe(false);
  });
});
