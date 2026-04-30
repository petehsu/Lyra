import { describe, expect, test } from "vitest";

import {
  isTerminalToolName,
  isWriteToolName,
  mergeRuntimeFeedItem,
  normalizeToolName,
  toRuntimeFeedItem,
  type ToolNameLabelMap,
} from "../runtime/feed-utils";

const LABELS: ToolNameLabelMap = {
  search: "Search",
  readRange: "Read Range",
  list: "List",
  glob: "Glob",
  write: "Write",
  edit: "Edit",
  multiEdit: "Multi Edit",
  terminalSession: "Terminal Session",
  terminalRead: "Terminal Read",
  terminalInput: "Terminal Input",
  terminalClose: "Terminal Close",
  terminalExec: "Terminal",
  collabSpawnAgent: "Spawn Agent",
  collabSendInput: "Send Input",
  collabResumeAgent: "Resume Agent",
  collabWait: "Wait",
  collabCloseAgent: "Close Agent",
  collabAgent: "Agent",
};

describe("ai panel runtime feed utils", () => {
  test("normalizes tool labels and write/terminal predicates", () => {
    expect(normalizeToolName("filesystem.search", LABELS)).toBe("Search");
    expect(normalizeToolName("unknown.tool", LABELS)).toBe("unknown.tool");
    expect(isWriteToolName("filesystem.edit")).toBe(true);
    expect(isWriteToolName("filesystem.apply_patch")).toBe(true);
    expect(isWriteToolName("filesystem.search")).toBe(false);
    expect(isTerminalToolName("terminal.exec")).toBe(true);
    expect(isTerminalToolName("filesystem.edit")).toBe(false);
  });

  test("builds runtime feed item from tool events", () => {
    const feed = toRuntimeFeedItem({
      sessionId: "s1",
      turnId: "t1",
      phase: "tool_progress",
      timestamp: 100,
      payload: {
        toolName: "filesystem.write",
        toolCallId: "tc1",
        input: {
          path: "src/main.ts"
        },
        progress: {
          firstChangedLine: 12
        }
      }
    } as any, LABELS, "Tool");

    expect(feed).toMatchObject({
      id: "tc1",
      toolName: "filesystem.write",
      toolLabel: "Write",
      target: "src/main.ts",
      openPath: "src/main.ts",
      autoOpen: true,
      firstChangedLine: 12,
      status: "running"
    });
  });

  test("builds collab agent feed item with thread navigation target", () => {
    const feed = toRuntimeFeedItem({
      sessionId: "s1",
      turnId: "t1",
      phase: "tool_finished",
      timestamp: 100,
      payload: {
        toolName: "collab.spawnAgent",
        toolCallId: "agent-call-1",
        input: {
          receiverThreadIds: ["child-thread-1"],
          model: "gpt-5.4",
          prompt: "Inspect the failing test",
        },
        output: {
          receiverThreadIds: ["child-thread-1"],
        },
        status: "completed",
      },
    } as any, LABELS, "Tool");

    expect(feed).toMatchObject({
      id: "agent-call-1",
      toolName: "collab.spawnAgent",
      toolLabel: "Spawn Agent",
      target: "child-thread-1 · gpt-5.4 · Inspect the failing test",
      openThreadId: "child-thread-1",
      icon: "agent",
      status: "completed",
    });
  });

  test("marks read_range as follow-openable without opening search tools automatically", () => {
    const readFeed = toRuntimeFeedItem({
      sessionId: "s1",
      turnId: "t1",
      phase: "tool_started",
      timestamp: 100,
      payload: {
        toolName: "filesystem.read_range",
        toolCallId: "read-1",
        input: {
          path: "src/main.ts",
          startLine: 9,
          endLine: 12,
        },
      },
    } as any, LABELS, "Tool");
    const searchFeed = toRuntimeFeedItem({
      sessionId: "s1",
      turnId: "t1",
      phase: "tool_started",
      timestamp: 100,
      payload: {
        toolName: "filesystem.search",
        toolCallId: "search-1",
        input: {
          path: "src",
          query: "Follow",
        },
      },
    } as any, LABELS, "Tool");

    expect(readFeed).toMatchObject({
      openPath: "src/main.ts",
      autoOpen: true,
    });
    expect(searchFeed).toMatchObject({
      openPath: "src",
    });
    expect(searchFeed?.autoOpen).toBeUndefined();
  });

  test("does not expose dev null shell redirects as file targets", () => {
    const feed = toRuntimeFeedItem({
      sessionId: "s1",
      turnId: "t1",
      phase: "tool_finished",
      timestamp: 100,
      payload: {
        toolName: "filesystem.write",
        toolCallId: "write-1",
        output: {
          path: "/dev/null;",
          status: "completed",
        },
      },
    } as any, LABELS, "Tool");

    expect(feed).toMatchObject({
      id: "write-1",
      target: "Write",
      status: "completed",
    });
    expect(feed?.openPath).toBeUndefined();
  });

  test("builds terminal transcript feed item from streamed chunks", () => {
    const feed = toRuntimeFeedItem({
      sessionId: "s1",
      turnId: "t1",
      phase: "tool_progress",
      timestamp: 100,
      payload: {
        toolName: "terminal.exec",
        toolCallId: "cmd-1",
        input: {
          command: "pnpm test",
          cwd: "/repo",
        },
        output: {
          terminalChunks: [
            { stream: "stdout", text: "ok\n", timestamp: 101 },
            { stream: "stderr", text: "warn\n", timestamp: 102 },
          ],
        },
      },
    } as any, LABELS, "Tool");

    expect(feed).toMatchObject({
      id: "cmd-1",
      toolName: "terminal.exec",
      liveOutput: "ok\nwarn\n",
      terminalTranscript: {
        command: "pnpm test",
        cwd: "/repo",
        outputLength: 8,
      },
    });
    expect(feed?.terminalTranscript?.chunks).toHaveLength(2);
  });

  test("merges runtime feed status with stronger precedence", () => {
    const merged = mergeRuntimeFeedItem(
      {
        id: "tc1",
        turnId: "t1",
        toolName: "terminal.exec",
        toolLabel: "Terminal",
        target: "echo hi",
        icon: "tool",
        sessionId: "term-1",
        status: "running",
        timestamp: 10,
        liveOutput: "h"
      },
      {
        id: "tc1",
        turnId: "t1",
        toolName: "terminal.exec",
        toolLabel: "Terminal",
        target: "echo hi",
        icon: "tool",
        sessionId: "term-1",
        status: "completed",
        timestamp: 11,
        liveOutput: "hi"
      }
    );

    expect(merged.status).toBe("completed");
    expect(merged.liveOutput).toBe("hi");
  });
});
