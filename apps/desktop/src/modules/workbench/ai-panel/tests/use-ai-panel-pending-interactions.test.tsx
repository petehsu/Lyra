import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test } from "vitest";

import { useAiPanelPendingInteractions } from "../use-ai-panel-pending-interactions";

describe("useAiPanelPendingInteractions", () => {
  test("merges interactions and keeps queue sorted", () => {
    const { result } = renderHook(() => {
      const [activeDetail, setActiveDetail] = useState<any>(null);
      const [isSending, setIsSending] = useState(true);
      const [isStreamActive, setIsStreamActive] = useState(true);

      const interactions = useAiPanelPendingInteractions({
        agentApi: undefined,
        activeSessionId: "s-1",
        activeDetail,
        interactionTextLabels: {
          toolTerminalSession: "Terminal Session",
          toolTerminalInput: "Terminal Input",
          toolTerminalExec: "Terminal",
          commandNeedsApproval: "Need approval",
          proposedPlanSummaryFallback: "Plan"
        },
        setActiveDetail,
        setIsSending,
        setIsStreamActive,
      });

      return {
        interactions,
        isSending,
        isStreamActive,
      };
    });

    act(() => {
      result.current.interactions.mergePendingInteractionsForSession("s-1", [
        {
          id: "ia-late",
          sessionId: "s-1",
          turnId: "t-2",
          kind: "plan_approval",
          status: "pending",
          payload: {
            proposedMarkdown: "## Plan\n- step"
          },
          createdAt: 20,
          updatedAt: 20
        } as any,
        {
          id: "ia-early",
          sessionId: "s-1",
          turnId: "t-1",
          kind: "command_approval",
          status: "pending",
          payload: {
            toolName: "terminal.exec",
            input: { command: "ls -la" },
            metadata: {}
          },
          createdAt: 10,
          updatedAt: 10
        } as any,
      ]);
    });

    expect(result.current.interactions.pendingInteractionQueue.map((entry) => entry.request.id)).toEqual([
      "ia-early",
      "ia-late"
    ]);
    expect(result.current.interactions.activeInteractionPanel?.request.id).toBe("ia-early");
    expect(result.current.isSending).toBe(false);
    expect(result.current.isStreamActive).toBe(false);
  });
});
