import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useAiPanelThreadViewModel } from "../use-ai-panel-thread-view-model";

const labels = {
  runtimeQueued: "Queued",
  runtimeStarted: "Started",
  runtimeCompletedTurn: "Completed",
  runtimeFailedTurn: "Failed",
  runtimePhaseToolStarted: "Tool running",
  runtimePhaseToolFinished: "Tool finished",
  generatingReply: "Generating reply",
  pendingInteractions: "Pending interactions",
} as const;

const toolNameLabels = {
  search: "Search",
  readRange: "Read",
  list: "List",
  glob: "Glob",
  write: "Write",
  edit: "Edit",
  multiEdit: "MultiEdit",
  terminalSession: "Terminal Session",
  terminalRead: "Terminal Read",
  terminalInput: "Terminal Input",
  terminalClose: "Terminal Close",
  terminalExec: "Terminal Exec",
  collabSpawnAgent: "Spawn Agent",
  collabSendInput: "Send Input",
  collabResumeAgent: "Resume Agent",
  collabWait: "Wait",
  collabCloseAgent: "Close Agent",
  collabAgent: "Agent",
} as const;

const planArtifact = {
  planId: "plan-1",
  status: "proposed" as const,
  title: "Website plan",
  summary: "Website plan",
  objective: "Build the page",
  assumptions: [],
  steps: [{ id: "step-1", kind: "step", title: "Build", body: "Build the page" }],
  interfaces: [],
  risks: [],
  tests: [],
  acceptanceCriteria: [],
};

describe("useAiPanelThreadViewModel", () => {
  test("derives running streaming status from runtime feed", () => {
    const { result } = renderHook(() =>
      useAiPanelThreadViewModel({
        activeDetail: {
          messages: [],
          turns: [],
          toolCalls: [],
          runtimeEvents: [],
        } as any,
        optimisticUserMessages: [],
        runtimeFeed: [
          {
            id: "tool-1",
            turnId: "t-1",
            toolName: "filesystem.list",
            toolLabel: "List",
            target: "/tmp",
            icon: "list",
            status: "running",
            timestamp: 2,
          },
        ] as any,
        streamingTurnId: "t-1",
        latestRuntimeEventByTurn: {},
        activeInteractionPanel: null,
        isInteractionSubmitting: false,
        isSending: false,
        isStreamActive: false,
        streamingAssistantText: "",
        finalizingTurnId: null,
        toolNameLabels,
        runtimeToolFallbackLabel: "Tool",
        labels,
      })
    );

    expect(result.current.streamingStatus).not.toBeNull();
    expect(result.current.streamingStatus?.label).toBe("Tool running");
    expect(result.current.streamingStatus?.tone).toBe("running");
    expect(result.current.streamingTurnRuntimeFeed).toHaveLength(1);
  });

  test("does not surface a streaming status when nothing is active", () => {
    const { result } = renderHook(() =>
      useAiPanelThreadViewModel({
        activeDetail: {
          messages: [],
          turns: [],
          toolCalls: [],
          runtimeEvents: [],
        } as any,
        optimisticUserMessages: [],
        runtimeFeed: [],
        streamingTurnId: null,
        latestRuntimeEventByTurn: {},
        activeInteractionPanel: null,
        isInteractionSubmitting: false,
        isSending: false,
        isStreamActive: false,
        streamingAssistantText: "",
        finalizingTurnId: null,
        toolNameLabels,
        runtimeToolFallbackLabel: "Tool",
        labels,
      })
    );

    expect(result.current.streamingStatus).toBeNull();
  });

  test("does not duplicate plan approval as a generic waiting status", () => {
    const planApprovalPanel = {
      kind: "planApproval" as const,
      request: {
        id: "plan:t-plan",
        sessionId: "thread-1",
        turnId: "t-plan",
        planId: "plan-1",
        version: 2,
        status: "proposed" as const,
        summary: "Website plan",
        artifact: planArtifact,
      },
    };
    const { result } = renderHook(() =>
      useAiPanelThreadViewModel({
        activeDetail: {
          messages: [],
          turns: [],
          toolCalls: [],
          runtimeEvents: [],
        } as any,
        optimisticUserMessages: [],
        runtimeFeed: [],
        streamingTurnId: "t-plan",
        latestRuntimeEventByTurn: {
          "t-plan": {
            id: "event-1",
            sessionId: "thread-1",
            turnId: "t-plan",
            phase: "plan_approval_requested",
            timestamp: 1,
            payload: {},
          },
        } as any,
        activeInteractionPanel: planApprovalPanel,
        isInteractionSubmitting: false,
        isSending: false,
        isStreamActive: false,
        streamingAssistantText: "",
        finalizingTurnId: null,
        toolNameLabels,
        runtimeToolFallbackLabel: "Tool",
        labels,
      })
    );

    expect(result.current.streamingStatus).toBeNull();
  });

  test("hides optimistic user message after the same turn is persisted", () => {
    const { result } = renderHook(() =>
      useAiPanelThreadViewModel({
        activeDetail: {
          messages: [
            {
              id: "persisted-user",
              role: "user",
              content: "Hello",
              turnId: "turn-1",
              createdAt: 1,
            },
          ],
          turns: [],
          toolCalls: [],
          runtimeEvents: [],
        } as any,
        optimisticUserMessages: [
          {
            id: "optimistic-user",
            sessionId: "thread-1",
            turnId: "turn-1",
            role: "user",
            content: "Hello",
            createdAt: 2,
            optimistic: true,
          },
        ],
        runtimeFeed: [],
        streamingTurnId: null,
        latestRuntimeEventByTurn: {},
        activeInteractionPanel: null,
        isInteractionSubmitting: false,
        isSending: false,
        isStreamActive: false,
        streamingAssistantText: "",
        finalizingTurnId: null,
        toolNameLabels,
        runtimeToolFallbackLabel: "Tool",
        labels,
      })
    );

    expect(result.current.sortedMessages.map((message) => message.id)).toEqual(["persisted-user"]);
  });

  test("keeps optimistic attachment parts on persisted user messages", () => {
    const { result } = renderHook(() =>
      useAiPanelThreadViewModel({
        activeDetail: {
          messages: [
            {
              id: "persisted-user",
              role: "user",
              content: "What is this?",
              turnId: "turn-1",
              createdAt: 1,
            },
          ],
          turns: [],
          toolCalls: [],
          runtimeEvents: [],
        } as any,
        optimisticUserMessages: [
          {
            id: "optimistic-user",
            sessionId: "thread-1",
            turnId: "turn-1",
            role: "user",
            content: "What is this?[mention] README.md",
            contentParts: [
              { type: "text", text: "What is this? " },
              { type: "attachment", name: "README.md", path: "/repo/README.md", kind: "file" },
            ],
            createdAt: 2,
            optimistic: true,
          },
        ],
        runtimeFeed: [],
        streamingTurnId: null,
        latestRuntimeEventByTurn: {},
        activeInteractionPanel: null,
        isInteractionSubmitting: false,
        isSending: false,
        isStreamActive: false,
        streamingAssistantText: "",
        finalizingTurnId: null,
        toolNameLabels,
        runtimeToolFallbackLabel: "Tool",
        labels,
      })
    );

    expect(result.current.sortedMessages).toHaveLength(1);
    expect(result.current.sortedMessages[0]?.id).toBe("persisted-user");
    expect(result.current.sortedMessages[0]?.contentParts).toEqual([
      { type: "text", text: "What is this? " },
      { type: "attachment", name: "README.md", path: "/repo/README.md", kind: "file" },
    ]);
  });

  test("keeps only non-assistant-turn entries in orphan runtime feed", () => {
    const { result } = renderHook(() =>
      useAiPanelThreadViewModel({
        activeDetail: {
          messages: [
            {
              id: "m-1",
              role: "assistant",
              content: "Answer",
              turnId: "t-assistant",
              createdAt: 1,
            },
          ],
          turns: [],
          toolCalls: [],
          runtimeEvents: [],
        } as any,
        optimisticUserMessages: [],
        runtimeFeed: [
          {
            id: "tool-a",
            turnId: "t-assistant",
            toolName: "filesystem.list",
            toolLabel: "List",
            target: "/a",
            icon: "list",
            status: "completed",
            timestamp: 2,
          },
          {
            id: "tool-b",
            turnId: "t-other",
            toolName: "filesystem.search",
            toolLabel: "Search",
            target: "/b",
            icon: "search",
            status: "completed",
            timestamp: 3,
          },
        ] as any,
        streamingTurnId: null,
        latestRuntimeEventByTurn: {},
        activeInteractionPanel: null,
        isInteractionSubmitting: false,
        isSending: false,
        isStreamActive: false,
        streamingAssistantText: "",
        finalizingTurnId: null,
        toolNameLabels,
        runtimeToolFallbackLabel: "Tool",
        labels,
      })
    );

    expect(result.current.orphanRuntimeFeed.map((item) => item.id)).toEqual(["tool-b"]);
  });

  test("does not repeat streaming runtime feed after assistant content is persisted", () => {
    const { result } = renderHook(() =>
      useAiPanelThreadViewModel({
        activeDetail: {
          messages: [
            {
              id: "m-1",
              role: "assistant",
              content: "Done",
              turnId: "t-1",
              createdAt: 1,
            },
          ],
          turns: [],
          toolCalls: [],
          runtimeEvents: [],
        } as any,
        optimisticUserMessages: [],
        runtimeFeed: [
          {
            id: "tool-1",
            turnId: "t-1",
            toolName: "filesystem.write",
            toolLabel: "Write",
            target: "/tmp/app.ts",
            icon: "write",
            status: "completed",
            timestamp: 2,
          },
        ] as any,
        streamingTurnId: "t-1",
        latestRuntimeEventByTurn: {},
        activeInteractionPanel: null,
        isInteractionSubmitting: false,
        isSending: false,
        isStreamActive: true,
        streamingAssistantText: "",
        finalizingTurnId: null,
        toolNameLabels,
        runtimeToolFallbackLabel: "Tool",
        labels,
      })
    );

    expect(result.current.streamingTurnRuntimeFeed).toEqual([]);
    expect(result.current.runtimeFeedByTurn.get("t-1")).toHaveLength(1);
  });

  test("does not repeat persisted turn tools below later streaming assistant text", () => {
    const { result } = renderHook(() =>
      useAiPanelThreadViewModel({
        activeDetail: {
          messages: [
            {
              id: "m-1",
              role: "assistant",
              content: "I will write the files.",
              turnId: "t-1",
              createdAt: 1,
            },
          ],
          turns: [],
          toolCalls: [
            {
              id: "tool-1",
              sessionId: "thread-1",
              turnId: "t-1",
              toolName: "filesystem.write",
              input: { path: "/tmp/index.html" },
              output: { changes: [{ path: "/tmp/index.html" }] },
              status: "completed",
              startedAt: 2,
              finishedAt: 3,
            },
          ],
          runtimeEvents: [],
        } as any,
        optimisticUserMessages: [],
        runtimeFeed: [
          {
            id: "tool-1",
            turnId: "t-1",
            toolName: "filesystem.write",
            toolLabel: "Write",
            target: "/tmp/index.html",
            icon: "write",
            status: "completed",
            timestamp: 2,
          },
        ] as any,
        streamingTurnId: "t-1",
        latestRuntimeEventByTurn: {},
        activeInteractionPanel: null,
        isInteractionSubmitting: false,
        isSending: false,
        isStreamActive: true,
        streamingAssistantText: "CSS is done. I am creating JS now.",
        finalizingTurnId: null,
        toolNameLabels,
        runtimeToolFallbackLabel: "Tool",
        labels,
      })
    );

    expect(result.current.streamingTurnRuntimeFeed).toEqual([]);
    expect(result.current.turnTimelineByTurn.get("t-1")?.some((entry) =>
      entry.kind === "tool" && entry.tool.id === "tool-1"
    )).toBe(true);
  });

  test("uses ai panel timeline entries to preserve assistant tool and plan order", () => {
    const { result } = renderHook(() =>
      useAiPanelThreadViewModel({
        activeDetail: {
          messages: [
            {
              id: "assistant-late",
              role: "assistant",
              content: "Final answer",
              turnId: "turn-1",
              createdAt: 50,
            },
            {
              id: "assistant-first",
              role: "assistant",
              content: "I will inspect it",
              turnId: "turn-1",
              createdAt: 100,
            },
          ],
          turns: [],
          toolCalls: [
            {
              id: "tool-1",
              sessionId: "thread-1",
              turnId: "turn-1",
              toolName: "terminal.exec",
              input: { command: "pnpm test" },
              output: { aggregatedOutput: "ok\n" },
              status: "completed",
              startedAt: 120,
              finishedAt: 130,
            },
          ],
          runtimeEvents: [],
          aiPanelTimelineEntries: [
            {
              id: "timeline:turn-1:assistant:assistant-first",
              sessionId: "thread-1",
              turnId: "turn-1",
              kind: "assistantMessage",
              refId: "assistant-first",
              createdAtMs: 100,
            },
            {
              id: "timeline:turn-1:tool:tool-1",
              sessionId: "thread-1",
              turnId: "turn-1",
              kind: "toolCall",
              refId: "tool-1",
              createdAtMs: 110,
            },
            {
              id: "timeline:turn-1:plan:plan-1",
              sessionId: "thread-1",
              turnId: "turn-1",
              kind: "plan",
              refId: "plan-1",
              createdAtMs: 115,
            },
            {
              id: "timeline:turn-1:assistant:assistant-late",
              sessionId: "thread-1",
              turnId: "turn-1",
              kind: "assistantMessage",
              refId: "assistant-late",
              createdAtMs: 140,
            },
          ],
        } as any,
        optimisticUserMessages: [],
        runtimeFeed: [],
        streamingTurnId: null,
        latestRuntimeEventByTurn: {},
        activeInteractionPanel: null,
        isInteractionSubmitting: false,
        isSending: false,
        isStreamActive: false,
        streamingAssistantText: "",
        finalizingTurnId: null,
        planByTurn: {
          "turn-1": {
            turnId: "turn-1",
            artifact: planArtifact,
            updatedAt: 115,
          },
        },
        toolNameLabels,
        runtimeToolFallbackLabel: "Tool",
        labels,
      })
    );

    expect(result.current.turnTimelineByTurn.get("turn-1")?.map((entry) => {
      if (entry.kind === "assistant") {
        return `assistant:${entry.content}`;
      }
      if (entry.kind === "tool") {
        return `tool:${entry.tool.id}`;
      }
      return `plan:${entry.plan.artifact.planId}`;
    })).toEqual([
      "assistant:I will inspect it",
      "tool:tool-1",
      "plan:plan-1",
      "assistant:Final answer",
    ]);
  });
});
