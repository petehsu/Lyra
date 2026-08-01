import { describe, expect, test, vi } from "vitest";

import {
  RuntimeSafePointTimeoutError,
  RuntimeUpdateAlreadyRunningError,
  RuntimeUpdatePendingError,
  RuntimeUpdateRecoveryError,
  createRuntimeUpdateCoordinator
} from "../coordinator";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("runtime update coordinator", () => {
  test("stages immediately but waits for agent, terminal, and download safe points", async () => {
    const coordinator = createRuntimeUpdateCoordinator();
    coordinator.markActive({ kind: "agent-turn", id: "session:turn", restartable: false });
    coordinator.markActive({ kind: "terminal-session", id: "terminal-1", restartable: false });
    coordinator.markActive({ kind: "download-task", id: "download-1", restartable: false });
    coordinator.markActive({
      kind: "lsp-document",
      id: "editor:file.ts",
      restartable: true,
      metadata: { filePath: "/repo/file.ts" }
    });

    const calls: string[] = [];
    const update = coordinator.applyUpdate({
      stage: async () => {
        calls.push("stage");
        return "staged";
      },
      activate: async () => {
        calls.push("activate");
        return "activated";
      },
      restart: async () => {
        calls.push("restart");
      },
      healthCheck: async () => {
        calls.push("health");
      },
      replayRestartable: async (activities) => {
        calls.push(`replay:${activities.map(({ id }) => id).join(",")}`);
      },
      rollback: async () => {
        calls.push("rollback");
      }
    });

    await vi.waitFor(() => {
      expect(coordinator.readStatus().phase).toBe("waiting-for-safe-point");
    });
    expect(calls).toEqual(["stage"]);
    expect(() => coordinator.assertAdmission("agent-turn")).toThrow(
      RuntimeUpdatePendingError
    );
    expect(() => coordinator.assertAdmission("lsp-document")).not.toThrow();

    coordinator.markIdle("agent-turn", "session:turn");
    coordinator.markIdle("terminal-session", "terminal-1");
    await Promise.resolve();
    expect(calls).toEqual(["stage"]);

    coordinator.markIdle("download-task", "download-1");
    await expect(update).resolves.toBe("activated");
    expect(calls).toEqual([
      "stage",
      "activate",
      "restart",
      "health",
      "replay:editor:file.ts"
    ]);
    expect(coordinator.readStatus()).toMatchObject({
      phase: "idle",
      admissionOpen: true
    });
  });

  test("rolls back, restarts the previous runtime, and replays LSP after health failure", async () => {
    const coordinator = createRuntimeUpdateCoordinator();
    coordinator.markActive({
      kind: "lsp-document",
      id: "editor:file.rs",
      restartable: true,
      metadata: { filePath: "/repo/file.rs" }
    });
    const calls: string[] = [];
    let healthAttempt = 0;

    const update = coordinator.applyUpdate({
      stage: async () => "staged",
      activate: async () => {
        calls.push("activate-new");
        return "new";
      },
      restart: async () => {
        calls.push("restart");
      },
      healthCheck: async () => {
        healthAttempt += 1;
        calls.push(`health-${healthAttempt}`);
        if (healthAttempt === 1) {
          throw new Error("new runtime unhealthy");
        }
      },
      replayRestartable: async () => {
        calls.push("replay");
      },
      rollback: async (_staged, cause) => {
        expect(cause).toBeInstanceOf(Error);
        calls.push("rollback-old");
      }
    });

    await expect(update).rejects.toThrow("new runtime unhealthy");
    expect(calls).toEqual([
      "activate-new",
      "restart",
      "health-1",
      "rollback-old",
      "restart",
      "health-2",
      "replay"
    ]);
    expect(coordinator.readStatus()).toMatchObject({
      phase: "failed",
      admissionOpen: true,
      lastError: "new runtime unhealthy"
    });
  });

  test("reports recovery failure separately from the update failure", async () => {
    const coordinator = createRuntimeUpdateCoordinator();
    const update = coordinator.applyUpdate({
      stage: async () => undefined,
      activate: async () => {
        throw new Error("activation failed");
      },
      restart: async () => undefined,
      healthCheck: async () => undefined,
      rollback: async () => {
        throw new Error("rollback failed");
      }
    });

    await expect(update).rejects.toBeInstanceOf(RuntimeUpdateRecoveryError);
  });

  test("times out without activation when a blocking task never becomes idle", async () => {
    const coordinator = createRuntimeUpdateCoordinator();
    coordinator.markActive({ kind: "terminal-session", id: "shell", restartable: false });
    const activate = vi.fn();

    const update = coordinator.applyUpdate({
      stage: async () => undefined,
      activate,
      restart: async () => undefined,
      healthCheck: async () => undefined,
      rollback: async () => undefined,
      safePointTimeoutMs: 10
    });

    await expect(update).rejects.toBeInstanceOf(RuntimeSafePointTimeoutError);
    expect(activate).not.toHaveBeenCalled();
  });

  test("rejects a second update while the first one is staging", async () => {
    const coordinator = createRuntimeUpdateCoordinator();
    const stage = deferred<void>();
    const first = coordinator.applyUpdate({
      stage: () => stage.promise,
      activate: async () => undefined,
      restart: async () => undefined,
      healthCheck: async () => undefined,
      rollback: async () => undefined
    });

    const second = coordinator.applyUpdate({
      stage: async () => undefined,
      activate: async () => undefined,
      restart: async () => undefined,
      healthCheck: async () => undefined,
      rollback: async () => undefined
    });
    await expect(second).rejects.toBeInstanceOf(RuntimeUpdateAlreadyRunningError);

    stage.resolve();
    await expect(first).resolves.toBeUndefined();
  });

  test("does not activate a staged update after the coordinator is disposed", async () => {
    const coordinator = createRuntimeUpdateCoordinator();
    coordinator.markActive({ kind: "terminal-session", id: "shell", restartable: false });
    const activate = vi.fn(async () => undefined);
    const update = coordinator.applyUpdate({
      stage: async () => undefined,
      activate,
      restart: async () => undefined,
      healthCheck: async () => undefined,
      rollback: async () => undefined
    });
    await vi.waitFor(() => {
      expect(coordinator.readStatus().phase).toBe("waiting-for-safe-point");
    });

    coordinator.dispose();
    await expect(update).rejects.toThrow("coordinator is disposed");
    expect(activate).not.toHaveBeenCalled();
  });
});
