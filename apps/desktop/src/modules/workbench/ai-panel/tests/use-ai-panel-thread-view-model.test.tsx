import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useAiPanelThreadViewModel } from "../use-ai-panel-thread-view-model";

const labels = {
  runtimeRunningPrefix: "Running",
  pendingInteractions: "Pending",
  waitingPhraseFinalizingReply: "Finalizing",
  runtimeFailedTurn: "Failed",
  runtimeQueued: "Queued",
  runtimeStarted: "Started",
  runtimePhaseToolStarted: "Tool Started",
  runtimePhaseToolFinished: "Tool Finished",
  generatingReply: "Generating",
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
} as const;

describe("useAiPanelThreadViewModel", () => {
  test("derives running streaming status from runtime feed", () => {
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
    expect(result.current.streamingStatus?.label).toBe("Running List");
    expect(result.current.streamingStatus?.tone).toBe("running");
    expect(result.current.streamingTurnRuntimeFeed).toHaveLength(1);
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
});
