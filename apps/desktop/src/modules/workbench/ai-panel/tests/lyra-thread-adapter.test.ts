import { describe, expect, test } from "vitest";

import {
  attachThreadAiPanelViewModel,
  lyraThreadToAgentDetail,
  readThreadAiPanelViewModel,
  readLyraThread,
} from "../lyra-thread-adapter";

const planArtifact = {
  planId: "plan-1",
  status: "proposed",
  title: "Plan",
  summary: "1. Check",
  objective: "Check the implementation.",
  assumptions: [],
  steps: [{ id: "step-1", kind: "step", title: "Check", body: "Check the implementation." }],
  interfaces: [],
  risks: [],
  tests: [],
  acceptanceCriteria: [],
};

describe("lyra thread adapter", () => {
  test("maps app-server thread items into messages and tool calls", () => {
    const thread = readLyraThread({
      id: "thread-1",
      preview: "Build the panel",
      name: "Panel work",
      modelProvider: "lp-openai",
      cwd: "/repo",
      boundProjectRoot: "/repo",
      createdAt: 100,
      updatedAt: 120,
      turns: [
        {
          id: "turn-1",
          status: "completed",
          collaborationMode: "plan",
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
    expect(detail.session.collaborationMode).toBe("plan");
    expect(detail.session.projectRoot).toBe("/repo");
    expect(detail.session.projectName).toBe("repo");
    expect(detail.turns[0]?.collaborationMode).toBe("plan");
    expect(detail.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Implement this"],
      ["assistant", "Checked the failing path"],
      ["assistant", "Implemented."],
    ]);
    expect(detail.toolCalls.map((call) => [call.toolName, call.status])).toEqual([
      ["terminal.exec", "completed"],
      ["filesystem.write", "completed"],
      ["workbench.document.read", "completed"],
      ["mcp.github.list_issues", "completed"],
    ]);
  });

  test("does not treat runtime cwd as a project binding", () => {
    const thread = readLyraThread({
      id: "thread-global",
      preview: "Global task",
      modelProvider: "lp-openai",
      cwd: "/Users/dev/Lyra",
      createdAt: 100,
      updatedAt: 120,
      turns: [],
    });

    expect(thread).not.toBeNull();
    const detail = lyraThreadToAgentDetail(thread!);
    expect(detail.session.projectRoot).toBeUndefined();
    expect(detail.session.projectName).toBeUndefined();
  });

  test("preserves inline user attachment order", () => {
    const thread = readLyraThread({
      id: "thread-attachments",
      preview: "Read files",
      modelProvider: "lp-openai",
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
              content: [
                { type: "text", text: "你看一下 " },
                { type: "mention", name: "Fast Prompt.txt", path: "/tmp/Fast Prompt.txt" },
                { type: "text", text: " 是什么？然后 " },
                { type: "mention", name: "README.md", path: "/tmp/README.md" },
                { type: "text", text: " 有什么关系" },
              ],
            },
          ],
        },
      ],
    });

    expect(thread).not.toBeNull();
    const detail = lyraThreadToAgentDetail(thread!);

    expect(detail.messages[0]?.contentParts).toEqual([
      { type: "text", text: "你看一下 " },
      { type: "attachment", name: "Fast Prompt.txt", path: "/tmp/Fast Prompt.txt", kind: "file" },
      { type: "text", text: " 是什么？然后 " },
      { type: "attachment", name: "README.md", path: "/tmp/README.md", kind: "file" },
      { type: "text", text: " 有什么关系" },
    ]);
  });

  test("preserves image inputs and collab agent calls", () => {
    const thread = readLyraThread({
      id: "thread-images",
      preview: "Inspect image",
      modelProvider: "lp-openai",
      createdAt: 100,
      updatedAt: 140,
      turns: [
        {
          id: "turn-1",
          status: "completed",
          startedAt: 101,
          completedAt: 139,
          items: [
            {
              type: "userMessage",
              id: "user-1",
              content: [
                { type: "text", text: "Compare " },
                { type: "localImage", path: "/tmp/screen.png" },
                { type: "text", text: " with " },
                { type: "image", url: "data:image/png;base64,abc" },
              ],
            },
            {
              type: "collabAgentToolCall",
              id: "collab-1",
              tool: "spawnAgent",
              status: "completed",
              senderThreadId: "thread-images",
              receiverThreadIds: ["thread-child"],
              prompt: "Inspect image details",
              model: "gpt-5.4",
              reasoningEffort: "medium",
              agentsStates: {
                "thread-child": "completed",
              },
            },
          ],
        },
      ],
    });

    expect(thread).not.toBeNull();
    const detail = lyraThreadToAgentDetail(thread!);

    expect(detail.messages[0]?.contentParts).toEqual([
      { type: "text", text: "Compare " },
      { type: "attachment", name: "screen.png", path: "/tmp/screen.png", kind: "local_image" },
      { type: "text", text: " with " },
      { type: "attachment", name: "image", path: "data:image/png;base64,abc", kind: "image" },
    ]);
    expect(detail.toolCalls[0]).toMatchObject({
      toolName: "collab.spawnAgent",
      status: "completed",
      input: {
        senderThreadId: "thread-images",
        receiverThreadIds: ["thread-child"],
        prompt: "Inspect image details",
        model: "gpt-5.4",
        reasoningEffort: "medium",
      },
      output: {
        receiverThreadIds: ["thread-child"],
      },
    });
  });

  test("maps rust ai panel view model directly into session detail", () => {
    const thread = readLyraThread({
      id: "thread-projected",
      preview: "Projected",
      modelProvider: "lp-openai",
      cwd: "/repo",
      createdAt: 100,
      updatedAt: 120,
      turns: [],
    });
    const viewModel = readThreadAiPanelViewModel({
      messages: [
        {
          id: "user-1",
          sessionId: "thread-projected",
          turnId: "turn-1",
          role: "user",
          content: "Hello",
          contentParts: [{ type: "text", text: "Hello" }],
          createdAtMs: 101000,
        },
        {
          id: "assistant-1",
          sessionId: "thread-projected",
          turnId: "turn-1",
          role: "assistant",
          content: "Hi",
          displayContent: "Hi",
          createdAtMs: 102000,
        },
      ],
      turns: [
        {
          id: "turn-1",
          sessionId: "thread-projected",
          status: "completed",
          collaborationMode: "plan",
          createdAtMs: 101000,
          updatedAtMs: 103000,
          durationMs: 2000,
        },
      ],
      toolCalls: [
        {
          id: "tool-1",
          sessionId: "thread-projected",
          turnId: "turn-1",
          toolName: "terminal.exec",
          input: { command: "echo hi" },
          output: { aggregatedOutput: "hi\n" },
          status: "completed",
          startedAtMs: 101500,
          finishedAtMs: 101512,
        },
      ],
      plans: [
        {
          turnId: "turn-1",
          artifact: planArtifact,
          updatedAtMs: 102500,
        },
      ],
      pendingInteractions: [
        {
          id: "plan:turn-1",
          sessionId: "thread-projected",
          turnId: "turn-1",
          kind: "planApproval",
          status: "pending",
          payload: {
            raw: {
              planId: "plan-1",
              version: 2,
              status: "proposed",
              summary: "1. Check",
              artifact: planArtifact,
            },
          },
          createdAtMs: 102500,
          updatedAtMs: 102500,
        },
        {
          id: "request-1",
          sessionId: "thread-projected",
          turnId: "turn-1",
          kind: "commandExecutionApproval",
          status: "pending",
          payload: {
            requestId: "request-1",
            agentCoreMethod: "item/commandExecution/requestApproval",
            raw: {
              command: "echo hi",
              toolName: "terminal.exec",
              input: { command: "echo hi" },
              metadata: { riskLevel: "medium" },
            },
          },
          createdAtMs: 102600,
          updatedAtMs: 102600,
        },
      ],
      timelineEntries: [
        {
          id: "timeline:turn-1:user:user-1",
          sessionId: "thread-projected",
          turnId: "turn-1",
          kind: "userMessage",
          refId: "user-1",
          createdAtMs: 101000,
        },
        {
          id: "timeline:turn-1:assistant:assistant-1",
          sessionId: "thread-projected",
          turnId: "turn-1",
          kind: "assistantMessage",
          refId: "assistant-1",
          createdAtMs: 102000,
        },
        {
          id: "timeline:turn-1:tool:tool-1",
          sessionId: "thread-projected",
          turnId: "turn-1",
          kind: "toolCall",
          refId: "tool-1",
          createdAtMs: 101500,
        },
        {
          id: "timeline:turn-1:plan:plan-1",
          sessionId: "thread-projected",
          turnId: "turn-1",
          kind: "plan",
          refId: "plan-1",
          createdAtMs: 102500,
        },
      ],
      turnMeta: [
        {
          turnId: "turn-1",
          sessionId: "thread-projected",
          firstAssistantMessageId: "assistant-1",
          lastAssistantMessageId: "assistant-1",
          assistantOrder: 1,
          hasAssistantDisplay: true,
        },
      ],
    });

    expect(thread).not.toBeNull();
    expect(viewModel).not.toBeNull();
    const detail = lyraThreadToAgentDetail(attachThreadAiPanelViewModel(thread!, viewModel));

    expect(detail.messages.map((message) => [message.id, message.content])).toEqual([
      ["user-1", "Hello"],
      ["assistant-1", "Hi"],
    ]);
    expect(detail.turns[0]).toMatchObject({
      id: "turn-1",
      collaborationMode: "plan",
      status: "completed",
      createdAt: 101000,
      updatedAt: 103000,
    });
    expect(detail.session.collaborationMode).toBe("plan");
    expect(detail.toolCalls[0]).toMatchObject({
      id: "tool-1",
      toolName: "terminal.exec",
      status: "completed",
      startedAt: 101500,
      finishedAt: 101512,
    });
    expect(detail.aiPanelTurnMeta?.[0]?.assistantOrder).toBe(1);
    expect(detail.aiPanelTimelineEntries?.map((entry) => [entry.kind, entry.refId])).toEqual([
      ["userMessage", "user-1"],
      ["assistantMessage", "assistant-1"],
      ["toolCall", "tool-1"],
      ["plan", "plan-1"],
    ]);
    expect(detail.pendingInteractions[0]).toMatchObject({
      id: "plan:turn-1",
      kind: "plan_approval",
      status: "pending",
      turnId: "turn-1",
    });
    expect(detail.pendingInteractions[1]).toMatchObject({
      id: "request-1",
      kind: "command_execution_approval",
      status: "pending",
      turnId: "turn-1",
    });
  });
});
