import { describe, expect, test } from "vitest";

import {
  lyraThreadToAgentDetail,
  readLyraThread,
} from "../lyra-thread-adapter";

describe("lyra thread adapter", () => {
  test("maps app-server thread items into messages and tool calls", () => {
    const thread = readLyraThread({
      id: "thread-1",
      preview: "Build the panel",
      name: "Panel work",
      modelProvider: "lp-openai",
      cwd: "/repo",
      createdAt: 100,
      updatedAt: 120,
      turns: [
        {
          id: "turn-1",
          status: "completed",
          startedAt: 101,
          completedAt: 119,
          items: [
            {
              type: "userMessage",
              id: "user-1",
              content: [{ type: "text", text: "Implement this" }],
            },
            {
              type: "commandExecution",
              id: "cmd-1",
              command: "pnpm test",
              cwd: "/repo",
              status: "completed",
              aggregatedOutput: "ok",
              exitCode: 0,
            },
            {
              type: "fileChange",
              id: "file-1",
              status: "applied",
              changes: [{ path: "/repo/src/app.ts", operation: "update" }],
            },
            {
              type: "dynamicToolCall",
              id: "dyn-1",
              tool: "workbench.document.read",
              status: "completed",
              arguments: { path: "/repo/src/app.ts" },
              success: true,
            },
            {
              type: "mcpToolCall",
              id: "mcp-1",
              server: "github",
              tool: "list_issues",
              status: "completed",
              arguments: { repo: "lyra" },
              result: { count: 1 },
            },
            {
              type: "reasoning",
              id: "reason-1",
              summary: ["Checked the failing path"],
            },
            {
              type: "plan",
              id: "plan-1",
              text: "1. Fix the runtime chain",
            },
            {
              type: "agentMessage",
              id: "assistant-1",
              text: "Implemented.",
            },
          ],
        },
      ],
    });

    expect(thread).not.toBeNull();
    const detail = lyraThreadToAgentDetail(thread!);

    expect(detail.session.title).toBe("Panel work");
    expect(detail.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Implement this"],
      ["assistant", "Checked the failing path"],
      ["assistant", "1. Fix the runtime chain"],
      ["assistant", "Implemented."],
    ]);
    expect(detail.toolCalls.map((call) => [call.toolName, call.status])).toEqual([
      ["terminal.exec", "completed"],
      ["filesystem.write", "completed"],
      ["workbench.document.read", "completed"],
      ["mcp.github.list_issues", "completed"],
    ]);
  });
});
