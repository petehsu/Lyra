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
  test("maps persisted thread items into messages", () => {
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
              type: "reasoning",
              id: "reason-1",
              summary: ["Checked the failing path"],
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
    expect(detail.aiPanelTurnMeta?.[0]?.assistantOrder).toBe(1);
    expect(detail.aiPanelTimelineEntries?.map((entry) => [entry.kind, entry.refId])).toEqual([
      ["userMessage", "user-1"],
      ["assistantMessage", "assistant-1"],
      ["plan", "plan-1"],
    ]);
    expect(detail.pendingInteractions[0]).toMatchObject({
      id: "plan:turn-1",
      kind: "plan_approval",
      status: "pending",
      turnId: "turn-1",
    });
  });
});
