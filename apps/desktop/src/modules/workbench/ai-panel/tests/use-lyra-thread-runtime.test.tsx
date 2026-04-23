import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraRuntimeEvent } from "../../../../shared/desktop-bridge";
import { useLyraThreadRuntime } from "../use-lyra-thread-runtime";

const labels = {
  toolTerminalSession: "Terminal session",
  toolTerminalInput: "Terminal input",
  toolTerminalExec: "Terminal",
  commandNeedsApproval: "Needs approval",
  proposedPlanSummaryFallback: "Plan",
};

const makeDesktopApi = () => {
  let listener: ((event: LyraRuntimeEvent) => void) | null = null;
  const request = vi.fn(async (payload: { method?: unknown; params?: Record<string, unknown> }) => {
    if (payload.method === "thread/list") {
      return { data: [] };
    }
    if (payload.method === "thread/start") {
      return {
        thread: {
          id: "thread-1",
          preview: "",
          modelProvider: "lp-openai",
          cwd: "/repo",
          createdAt: 100,
          updatedAt: 100,
          turns: [],
        },
      };
    }
    if (payload.method === "turn/start") {
      return {
        turn: {
          id: "turn-1",
          status: "inProgress",
          items: [],
          startedAt: 101,
        },
      };
    }
    if (payload.method === "thread/read") {
      return {
        thread: {
          id: "thread-1",
          preview: "Hello",
          modelProvider: "lp-openai",
          cwd: "/repo",
          createdAt: 100,
          updatedAt: 110,
          turns: [
            {
              id: "turn-1",
              status: "completed",
              startedAt: 101,
              completedAt: 110,
              items: [
                {
                  type: "userMessage",
                  id: "user-1",
                  content: [{ type: "text", text: "Hello" }],
                },
                {
                  type: "agentMessage",
                  id: "assistant-1",
                  text: "Hi there",
                },
              ],
            },
          ],
        },
      };
    }
    return {};
  });

  return {
    api: {
      lyra: {
        request,
        resolveServerRequest: vi.fn(),
        rejectServerRequest: vi.fn(),
        health: vi.fn(),
        notify: vi.fn(),
        onEvent: (nextListener: (event: LyraRuntimeEvent) => void) => {
          listener = nextListener;
          return () => {
            listener = null;
          };
        },
      },
    },
    emit: (event: LyraRuntimeEvent) => {
      listener?.(event);
    },
    request,
  };
};

describe("useLyraThreadRuntime", () => {
  test("starts a thread, streams assistant deltas, then refreshes final truth", async () => {
    const desktop = makeDesktopApi();
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi: desktop.api as never,
        interactionTextLabels: labels,
      })
    );

    await waitFor(() => {
      expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({ method: "thread/list" }));
    });

    await act(async () => {
      await result.current.actions.sendTurn("Hello", {
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
      });
    });

    expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({ method: "thread/start" }));
    expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({ method: "turn/start" }));
    expect(result.current.state.streamingTurnId).toBe("turn-1");

    act(() => {
      desktop.emit({
        kind: "notification",
        notification: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "assistant-1",
            delta: "Hi",
          },
        },
      });
    });

    expect(result.current.state.streamingAssistantText).toBe("Hi");

    act(() => {
      desktop.emit({
        kind: "notification",
        notification: {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: { id: "turn-1", status: "completed", items: [] },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.state.streamingAssistantText).toBe("");
      expect(result.current.state.activeDetail?.messages.at(-1)?.content).toBe("Hi there");
    });
  });
});
