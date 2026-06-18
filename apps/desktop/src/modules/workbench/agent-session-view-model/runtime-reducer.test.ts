import { describe, expect, test } from "vitest";

import type { AgentSessionSnapshot } from "../../../shared/agent";
import { applyAgentRuntimeEventToSnapshot } from "./runtime-reducer";

const session = (
  overrides: Partial<AgentSessionSnapshot> = {}
): AgentSessionSnapshot => ({
  id: "session-1",
  title: "Session",
  sessionKind: "normal",
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
      { type: "text", id: "text-1", text: "Hello world" }
    ]);
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
    expect(completed.turnStatus).toBe("finished");
    expect(completed.activeTurnId).toBeNull();
    expect(completed.follow.running).toBe(false);
  });
});
