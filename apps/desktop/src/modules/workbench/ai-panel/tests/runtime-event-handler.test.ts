import { describe, expect, test, vi } from "vitest";

import { handleAiPanelRuntimeEvent } from "../runtime/runtime-event-handler";

const createBaseParams = () => {
  const activeSessionIdRef = { current: "s-1" };
  const streamingTurnIdRef = { current: null as string | null };
  return {
    replacePendingInteractions: vi.fn(),
    mergePendingInteractionsForSession: vi.fn(),
    livePendingInteractionsRef: { current: {} as Record<string, readonly any[]> },
    activeSessionIdRef,
    interactionTextLabels: {
      toolTerminalSession: "Terminal Session",
      toolTerminalInput: "Terminal Input",
      toolTerminalExec: "Terminal",
      commandNeedsApproval: "Need approval",
      proposedPlanSummaryFallback: "Plan",
    },
    runtimeToolFallbackLabel: "Tool",
    toolNameLabels: {
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
      terminalExec: "Terminal Exec",
    },
    setLatestRuntimeEventByTurn: vi.fn(),
    setFinalizingTurnId: vi.fn(),
    streamingTurnIdRef,
    setStreamingAssistantText: vi.fn(),
    setIsStreamActive: vi.fn(),
    setStreamingTurnId: vi.fn(),
    setRuntimeError: vi.fn(),
    setRuntimeFeed: vi.fn(),
    setIsSending: vi.fn(),
    setIsInteractionSubmitting: vi.fn(),
    setTransientInteractionPanel: vi.fn(),
    setActiveInteractionId: vi.fn(),
    setOptimisticUserMessages: vi.fn(),
    openRuntimeTargetPath: vi.fn(async () => {}),
    loadSessionDetail: vi.fn(async () => {}),
    loadSessions: vi.fn(async () => {}),
  };
};

describe("runtime event handler", () => {
  test("handles assistant delta for active session", () => {
    let streamingText = "";
    const params = createBaseParams();
    params.setStreamingAssistantText = vi.fn((next: unknown) => {
      streamingText = typeof next === "function"
        ? (next as (current: string) => string)(streamingText)
        : String(next ?? "");
    });

    handleAiPanelRuntimeEvent({
      ...params,
      event: {
        phase: "assistant_delta",
        sessionId: "s-1",
        turnId: "t-1",
        timestamp: 1,
        payload: { delta: "hello" },
      } as any,
    });

    expect(params.setFinalizingTurnId).toHaveBeenCalledWith(null);
    expect(params.setIsStreamActive).toHaveBeenCalledWith(true);
    expect(params.setStreamingTurnId).toHaveBeenCalledWith("t-1");
    expect(params.streamingTurnIdRef.current).toBe("t-1");
    expect(streamingText).toBe("hello");
  });

  test("updates interaction queue even when session is not active", () => {
    const params = createBaseParams();
    params.activeSessionIdRef.current = "s-active-other";

    handleAiPanelRuntimeEvent({
      ...params,
      event: {
        phase: "interaction_queue_updated",
        sessionId: "s-1",
        turnId: "t-1",
        timestamp: 1,
        payload: {
          pendingInteractions: [{ id: "ia-1" }],
        },
      } as any,
    });

    expect(params.replacePendingInteractions).toHaveBeenCalledWith("s-1", [{ id: "ia-1" }]);
  });
});
