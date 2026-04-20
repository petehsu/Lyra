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
  terminalExec: "Terminal"
};

describe("ai panel runtime feed utils", () => {
  test("normalizes tool labels and write/terminal predicates", () => {
    expect(normalizeToolName("filesystem.search", LABELS)).toBe("Search");
    expect(normalizeToolName("unknown.tool", LABELS)).toBe("unknown.tool");
    expect(isWriteToolName("filesystem.edit")).toBe(true);
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
