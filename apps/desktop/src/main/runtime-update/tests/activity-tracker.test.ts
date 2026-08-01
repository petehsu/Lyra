import { describe, expect, test, vi } from "vitest";

import type {
  LyraRuntimeClient,
  RuntimeEventListener
} from "../../runtime-client";
import { RUNTIME_CLIENT_LIFECYCLE_EVENT } from "../../runtime-client";
import { createRuntimeActivityTrackingClient } from "../activity-tracker";
import {
  RuntimeUpdatePendingError,
  createRuntimeUpdateCoordinator
} from "../coordinator";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createRuntime = () => {
  const listeners = new Set<RuntimeEventListener>();
  const request = vi.fn(async (method: string, payload: unknown): Promise<unknown> => {
    if (method === "agent.turn.send") {
      return { sessionId: "agent-1", turnId: "turn-1", status: "running" };
    }
    if (method === "terminal.sessions.create") {
      return { sessionId: "terminal-1", shell: "zsh" };
    }
    if (method === "download.list") {
      return {
        tasks: [{ id: "restored-download", state: "downloading" }]
      };
    }
    return payload;
  });
  const client: LyraRuntimeClient = {
    request: async <T>(method: string, payload: unknown): Promise<T> =>
      await request(method, payload) as T,
    registerRequestHandler: vi.fn(),
    unregisterRequestHandler: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: vi.fn()
  };
  return {
    client,
    request,
    emit: (event: string, payload: unknown) => {
      for (const listener of listeners) {
        listener(event, payload);
      }
    }
  };
};

describe("runtime activity tracking client", () => {
  test("tracks agent turns and terminal sessions until terminal runtime events", async () => {
    const runtime = createRuntime();
    const coordinator = createRuntimeUpdateCoordinator();
    const tracked = createRuntimeActivityTrackingClient(runtime.client, coordinator);

    await tracked.client.request("agent.turn.send", { sessionId: "agent-1" });
    await tracked.client.request("terminal.sessions.create", {});
    expect(coordinator.readStatus().blockers.map(({ kind, id }) => `${kind}:${id}`))
      .toEqual([
        "agent-turn:agent-1:turn-1",
        "terminal-session:terminal-1"
      ]);

    runtime.emit("agent.runtime", {
      kind: "turnFinished",
      sessionId: "agent-1",
      turnId: "turn-1",
      status: "finished"
    });
    runtime.emit("terminal.runtime", {
      kind: "exit",
      sessionId: "terminal-1",
      exitCode: 0
    });
    expect(coordinator.readStatus().blockers).toEqual([]);
    tracked.dispose();
  });

  test("only active download execution blocks a runtime update", async () => {
    const runtime = createRuntime();
    const coordinator = createRuntimeUpdateCoordinator();
    const tracked = createRuntimeActivityTrackingClient(runtime.client, coordinator);

    runtime.emit("download.runtime", {
      kind: "snapshot",
      snapshot: {
        tasks: [
          { id: "queued", state: "queued" },
          { id: "active", state: "downloading" },
          { id: "extracting", state: "completed", postProcessingState: "running" }
        ]
      }
    });
    expect(coordinator.readStatus().blockers.map(({ id }) => id)).toEqual([
      "active",
      "extracting"
    ]);

    runtime.emit("download.runtime", {
      kind: "task-updated",
      task: { id: "active", state: "paused" }
    });
    runtime.emit("download.runtime", {
      kind: "task-removed",
      taskId: "extracting"
    });
    expect(coordinator.readStatus().blockers).toEqual([]);
    tracked.dispose();
  });

  test("does not resurrect a short-lived terminal when exit arrives before create response", async () => {
    const runtime = createRuntime();
    const coordinator = createRuntimeUpdateCoordinator();
    const tracked = createRuntimeActivityTrackingClient(runtime.client, coordinator);
    const createResult = deferred<unknown>();
    runtime.request.mockImplementationOnce(() => createResult.promise);

    const create = tracked.client.request("terminal.sessions.create", {});
    runtime.emit("terminal.runtime", {
      kind: "exit",
      sessionId: "terminal-fast",
      exitCode: 0
    });
    createResult.resolve({ sessionId: "terminal-fast", shell: "zsh" });
    await create;

    expect(coordinator.readStatus().blockers).toEqual([]);
    tracked.dispose();
  });

  test("keeps the latest LSP document content and replays it after restart", async () => {
    const runtime = createRuntime();
    const coordinator = createRuntimeUpdateCoordinator();
    const tracked = createRuntimeActivityTrackingClient(runtime.client, coordinator);
    const base = {
      sessionId: "editor-1",
      filePath: "/repo/main.ts",
      languageId: "typescript",
      version: 1,
      content: "const value = 1;"
    } as const;

    await tracked.client.request("lsp.documents.open", base);
    await tracked.client.request("lsp.documents.change", {
      ...base,
      version: 2,
      content: "const value = 2;"
    });
    expect(coordinator.readStatus().restartable).toHaveLength(1);

    runtime.request.mockClear();
    await tracked.replayLspDocuments();
    expect(runtime.request).toHaveBeenCalledOnce();
    expect(runtime.request).toHaveBeenCalledWith(
      "lsp.documents.open",
      expect.objectContaining({ version: 2, content: "const value = 2;" })
    );
    tracked.dispose();
  });

  test("recovers restartable state and refreshes downloads after daemon reconnect", async () => {
    const runtime = createRuntime();
    const coordinator = createRuntimeUpdateCoordinator();
    const tracked = createRuntimeActivityTrackingClient(runtime.client, coordinator);
    const document = {
      sessionId: "editor-1",
      filePath: "/repo/main.rs",
      languageId: "rust",
      version: 1,
      content: "fn main() {}"
    } as const;

    await tracked.client.request("lsp.documents.open", document);
    await tracked.client.request("agent.turn.send", {});
    await tracked.client.request("terminal.sessions.create", {});
    runtime.emit("download.runtime", {
      kind: "task-updated",
      task: { id: "lost-download", state: "downloading" }
    });

    runtime.emit(RUNTIME_CLIENT_LIFECYCLE_EVENT, {
      kind: "disconnected",
      generation: 1
    });
    expect(coordinator.readStatus().blockers).toEqual([]);
    expect(coordinator.readStatus().restartable).toHaveLength(1);

    runtime.request.mockClear();
    runtime.emit(RUNTIME_CLIENT_LIFECYCLE_EVENT, {
      kind: "connected",
      generation: 2,
      recovered: true
    });

    await vi.waitFor(() => {
      expect(runtime.request).toHaveBeenCalledWith("lsp.documents.open", document);
      expect(runtime.request).toHaveBeenCalledWith("download.list", {});
      expect(coordinator.readStatus().blockers).toEqual([{
        kind: "download-task",
        id: "restored-download",
        restartable: false
      }]);
    });
    tracked.dispose();
  });

  test("stops admitting new work once a staged update waits for a safe point", async () => {
    const runtime = createRuntime();
    const coordinator = createRuntimeUpdateCoordinator();
    const tracked = createRuntimeActivityTrackingClient(runtime.client, coordinator);
    coordinator.markActive({ kind: "terminal-session", id: "shell", restartable: false });
    const update = coordinator.applyUpdate({
      stage: async () => undefined,
      activate: async () => undefined,
      restart: async () => undefined,
      healthCheck: async () => undefined,
      rollback: async () => undefined
    });
    await vi.waitFor(() => {
      expect(coordinator.readStatus().phase).toBe("waiting-for-safe-point");
    });

    await expect(tracked.client.request("agent.turn.send", {}))
      .rejects.toBeInstanceOf(RuntimeUpdatePendingError);
    expect(runtime.request).not.toHaveBeenCalled();

    coordinator.markIdle("terminal-session", "shell");
    await update;
    tracked.dispose();
  });
});
