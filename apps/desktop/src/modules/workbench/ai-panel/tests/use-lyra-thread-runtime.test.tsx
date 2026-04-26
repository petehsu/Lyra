import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { LyraRuntimeEvent } from "../../../../shared/desktop-bridge";
import { resetWorkbenchStateStorageForTests } from "../../state-storage";
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
    if (payload.method === "turn/steer") {
      return { turnId: "turn-1" };
    }
    if (payload.method === "thread/fork") {
      return {
        thread: {
          id: "thread-2",
          preview: "Forked",
          modelProvider: "lp-openai",
          cwd: "/repo",
          createdAt: 200,
          updatedAt: 200,
          turns: [
            { id: "turn-1", status: "completed", startedAt: 101, completedAt: 110, items: [] },
            { id: "turn-2", status: "completed", startedAt: 111, completedAt: 120, items: [] },
            { id: "turn-3", status: "completed", startedAt: 121, completedAt: 130, items: [] },
          ],
        },
      };
    }
    if (payload.method === "thread/rollback") {
      const threadId = payload.params?.threadId === "thread-2" ? "thread-2" : "thread-1";
      return {
        thread: {
          id: threadId,
          preview: "",
          modelProvider: "lp-openai",
          cwd: "/repo",
          createdAt: 100,
          updatedAt: 120,
          turns: [],
        },
      };
    }
    if (payload.method === "review/start") {
      return {
        reviewThreadId: "thread-1",
        turn: {
          id: "review-turn-1",
          status: "inProgress",
          items: [],
          startedAt: 121,
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
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
  });

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
          method: "item/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            item: {
              type: "agentMessage",
              id: "assistant-1",
              text: "Hi",
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.state.streamingAssistantText).toBe("");
      expect(result.current.state.activeDetail?.messages.at(-1)?.content).toBe("Hi");
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
      expect(result.current.state.streamingAssistantText).toBe("");
      expect(result.current.state.activeDetail?.messages.at(-1)?.content).toBe("Hi there");
      expect(result.current.state.optimisticUserMessages).toHaveLength(0);
    });
  });

  test("thread list summaries do not clear hydrated active thread turns", async () => {
    const request = vi.fn(async (payload: { method?: unknown }) => {
      if (payload.method === "thread/list") {
        return {
          data: [
            {
              id: "thread-1",
              preview: "Hello",
              modelProvider: "lp-openai",
              cwd: "/repo",
              createdAt: 100,
              updatedAt: 120,
              turns: [],
            },
          ],
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
    const desktopApi = {
      lyra: {
        request,
        resolveServerRequest: vi.fn(),
        rejectServerRequest: vi.fn(),
        health: vi.fn(),
        notify: vi.fn(),
        onEvent: () => () => {},
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

    act(() => {
      result.current.actions.selectThread("thread-1");
    });

    await waitFor(() => {
      expect(result.current.state.activeDetail?.messages.at(-1)?.content).toBe("Hi there");
    });

    await act(async () => {
      await result.current.actions.loadThreads();
    });

    expect(result.current.state.activeDetail?.messages.at(-1)?.content).toBe("Hi there");
  });

  test("stale thread tabs are removed instead of surfacing raw thread unavailable RPC errors", async () => {
    const request = vi.fn(async (payload: { method?: unknown; params?: Record<string, unknown> }) => {
      if (payload.method === "thread/list") {
        return { data: [] };
      }
      if (payload.method === "thread/read") {
        throw new Error(
          `Error invoking remote method 'lyra:lyra/runtime/request': Error: thread not loaded: ${String(payload.params?.threadId)}`
        );
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
        onEvent: () => () => {},
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

    act(() => {
      result.current.actions.selectThread("thread-missing");
    });

    await waitFor(() => {
      expect(result.current.state.activeThreadId).toBeNull();
    });
    expect(result.current.state.runtimeError).toBeNull();
  });

  test("sending from a stale loaded tab creates a fresh thread instead of surfacing thread-not-loaded", async () => {
    const request = vi.fn(async (payload: { method?: unknown; params?: Record<string, unknown> }) => {
      if (payload.method === "thread/list") {
        return {
          data: [{
            id: "stale-thread",
            preview: "Old",
            modelProvider: "lp-openai",
            cwd: "/repo",
            createdAt: 100,
            updatedAt: 100,
            turns: [],
          }],
        };
      }
      if (payload.method === "thread/read") {
        return {
          thread: {
            id: "stale-thread",
            preview: "Old",
            modelProvider: "lp-openai",
            cwd: "/repo",
            createdAt: 100,
            updatedAt: 100,
            turns: [],
          },
        };
      }
      if (payload.method === "turn/start" && payload.params?.threadId === "stale-thread") {
        throw new Error(
          "Error invoking remote method 'lyra:lyra/runtime/request': Error: thread not loaded: stale-thread"
        );
      }
      if (payload.method === "thread/start") {
        return {
          thread: {
            id: "fresh-thread",
            preview: "",
            modelProvider: "lp-openai",
            cwd: "/repo",
            createdAt: 200,
            updatedAt: 200,
            turns: [],
          },
        };
      }
      if (payload.method === "turn/start" && payload.params?.threadId === "fresh-thread") {
        return {
          turn: {
            id: "fresh-turn",
            status: "inProgress",
            items: [],
            startedAt: 201,
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
        onEvent: () => () => {},
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

    act(() => {
      result.current.actions.selectThread("stale-thread");
    });

    await waitFor(() => {
      expect(result.current.state.activeThreadId).toBe("stale-thread");
    });

    await act(async () => {
      await result.current.actions.sendTurn("Hello", {
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
      });
    });

    await waitFor(() => {
      expect(result.current.state.activeThreadId).toBe("fresh-thread");
    });
    expect(result.current.state.runtimeError).toBeNull();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "turn/start",
      params: expect.objectContaining({ threadId: "stale-thread" }),
    }));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "turn/start",
      params: expect.objectContaining({ threadId: "fresh-thread" }),
    }));
  });

  test("sends collaboration mode with turn/start when plan mode is requested", async () => {
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
      await result.current.actions.sendTurn("Plan this", {
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
        collaborationMode: "plan",
      });
    });

    expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "turn/start",
      params: expect.objectContaining({
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-test",
            reasoning_effort: null,
            developer_instructions: null,
          },
        },
      }),
    }));
  });

  test("sends permission mode fields on thread/start and turn/start", async () => {
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
      await result.current.actions.sendTurn("Use full access", {
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxMode: "danger-full-access",
      });
    });

    expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "thread/start",
      params: expect.objectContaining({
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: "danger-full-access",
      }),
    }));
    expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "turn/start",
      params: expect.objectContaining({
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      }),
    }));
  });

  test("tracks streamed plan deltas and checklist updates", async () => {
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
      await result.current.actions.sendTurn("Plan", {
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
      });
    });

    act(() => {
      desktop.emit({
        kind: "notification",
        notification: {
          method: "item/plan/delta",
          params: {
            threadId: "thread-1",
            turnId: "turn-plan",
            itemId: "plan-1",
            delta: "- inspect\n",
          },
        },
      });
      desktop.emit({
        kind: "notification",
        notification: {
          method: "turn/plan/updated",
          params: {
            threadId: "thread-1",
            turnId: "turn-plan",
            explanation: "tracking",
            plan: [
              { step: "inspect", status: "completed" },
              { step: "patch", status: "inProgress" },
            ],
          },
        },
      });
    });

    expect(result.current.state.planByTurn["turn-plan"]?.draftText).toBe("- inspect\n");
    expect(result.current.state.planByTurn["turn-plan"]?.steps.map((step) => step.status)).toEqual([
      "completed",
      "inProgress",
    ]);
    expect(result.current.state.latestPlanTurnId).toBe("turn-plan");
  });

  test("exposes steer, fork, rollback, and review runtime actions", async () => {
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

    await act(async () => {
      await result.current.actions.steerTurn("focus on tests");
      await result.current.actions.cleanBackgroundTerminals();
      await result.current.actions.startReview();
    });

    expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "turn/steer",
      params: expect.objectContaining({
        threadId: "thread-1",
        expectedTurnId: "turn-1",
      }),
    }));
    expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "thread/backgroundTerminals/clean",
      params: {
        threadId: "thread-1",
      },
    }));
    expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "review/start",
      params: expect.objectContaining({
        threadId: "thread-1",
        target: { type: "uncommittedChanges" },
        delivery: "inline",
      }),
    }));

    let forkedFromTurnId = "";
    await act(async () => {
      forkedFromTurnId = await result.current.actions.forkThreadFromTurn("turn-1", 2, {
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
      });
    });
    expect(forkedFromTurnId).toBe("thread-2");
    expect(result.current.state.activeThreadId).toBe("thread-2");
    expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "thread/rollback",
      params: {
        threadId: "thread-2",
        turnId: "turn-2",
        restoreFiles: false,
      },
    }));

    act(() => {
      result.current.actions.selectThread("thread-1");
    });
    await waitFor(() => {
      expect(result.current.state.activeThreadId).toBe("thread-1");
    });

    let forkedId = "";
    await act(async () => {
      forkedId = await result.current.actions.forkThread({
        model: "gpt-test",
        modelProvider: "lp-openai",
        cwd: "/repo",
      });
    });
    expect(forkedId).toBe("thread-2");
    expect(result.current.state.activeThreadId).toBe("thread-2");

    act(() => {
      result.current.actions.selectThread("thread-1");
    });
    await waitFor(() => {
      expect(result.current.state.activeThreadId).toBe("thread-1");
    });

    await act(async () => {
      await result.current.actions.rollbackThread("turn-1");
    });
    expect(desktop.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "thread/rollback",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        restoreFiles: true,
      },
    }));
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
      await result.current.actions.createThread();
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
      await result.current.actions.sendTurn("Hello", {
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
