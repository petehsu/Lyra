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
  test("shows the user message immediately while a new thread is being created", async () => {
    let resolveThreadStart: ((value: unknown) => void) | null = null;
    let listener: ((event: LyraRuntimeEvent) => void) | null = null;
    const request = vi.fn(async (payload: { method?: unknown }) => {
      if (payload.method === "thread/list") {
        return { data: [] };
      }
      if (payload.method === "thread/start") {
        return new Promise((resolve) => {
          resolveThreadStart = resolve;
        });
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
      return {};
    });
    const desktopApi = {
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
    } as never;
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi,
        interactionTextLabels: labels,
      })
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: "thread/list" }));
    });

    let sendPromise: Promise<void> | null = null;
    act(() => {
      sendPromise = result.current.actions.sendTurn("Hello", {
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
      });
    });

    await waitFor(() => {
      expect(result.current.state.optimisticUserMessages.map((message) => message.content)).toEqual(["Hello"]);
    });
    expect(result.current.state.isSending).toBe(true);
    expect(result.current.state.activeThread).toBeNull();
    expect(listener).toBeDefined();

    await act(async () => {
      resolveThreadStart?.({
        thread: {
          id: "thread-1",
          preview: "",
          modelProvider: "lp-openai",
          cwd: "/repo",
          createdAt: 100,
          updatedAt: 100,
          turns: [],
        },
      });
      await sendPromise;
    });

    expect(result.current.state.optimisticUserMessages[0]?.sessionId).toBe("thread-1");
    expect(result.current.state.optimisticUserMessages[0]?.turnId).toBe("turn-1");
  });

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
      expect(result.current.state.optimisticUserMessages).toHaveLength(0);
    });
  });

  test("createThread resets streaming state", async () => {
    const desktop = makeDesktopApi();
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi: desktop.api as never,
        interactionTextLabels: labels,
      })
    );

    await waitFor(() => {
      expect(desktop.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: "thread/list" })
      );
    });

    await act(async () => {
      await result.current.actions.sendTurn("Hello", {
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
      });
    });

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
      expect(result.current.state.finalizingTurnId).toBe("turn-1");
    });

    await act(async () => {
      await result.current.actions.createThread({
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
      });
    });

    expect(result.current.state.finalizingTurnId).toBeNull();
    expect(result.current.state.streamingTurnId).toBeNull();
    expect(result.current.state.streamingAssistantText).toBe("");
    expect(result.current.state.isStreamActive).toBe(false);
  });

  test("selectThread clears streaming residue from the previous thread", async () => {
    const desktop = makeDesktopApi();
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi: desktop.api as never,
        interactionTextLabels: labels,
      })
    );

    await waitFor(() => {
      expect(desktop.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: "thread/list" })
      );
    });

    await act(async () => {
      await result.current.actions.sendTurn("Hello", {
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
      });
    });

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
      expect(result.current.state.finalizingTurnId).toBe("turn-1");
    });

    act(() => {
      result.current.actions.selectThread(null);
    });

    expect(result.current.state.finalizingTurnId).toBeNull();
    expect(result.current.state.streamingTurnId).toBeNull();
    expect(result.current.state.streamingAssistantText).toBe("");
    expect(result.current.state.isStreamActive).toBe(false);
  });

  test("archiving the active thread clears the panel state", async () => {
    const desktop = makeDesktopApi();
    const { result } = renderHook(() =>
      useLyraThreadRuntime({
        desktopApi: desktop.api as never,
        interactionTextLabels: labels,
      })
    );

    await waitFor(() => {
      expect(desktop.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: "thread/list" })
      );
    });

    await act(async () => {
      await result.current.actions.createThread({
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
      });
    });

    expect(result.current.state.activeThreadId).toBe("thread-1");
    expect(result.current.state.activeThread).not.toBeNull();

    act(() => {
      desktop.emit({
        kind: "notification",
        notification: {
          method: "thread/archived",
          params: {
            threadId: "thread-1",
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.state.activeThreadId).toBeNull();
      expect(result.current.state.activeThread).toBeNull();
      expect(result.current.state.threads).toHaveLength(0);
    });
  });
});
