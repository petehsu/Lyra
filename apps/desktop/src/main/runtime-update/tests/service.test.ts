import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import type { InstalledComponentV1 } from "../../components/registry";
import type { ModuleDataSchemaTransaction } from "../../components/data-schema";
import type { LyraRuntimeClient } from "../../runtime-client";
import { createRuntimeUpdateCoordinator } from "../coordinator";
import {
  createRuntimeComponentUpdateService,
  resolveRuntimeStartupEntry
} from "../service";

const component = (input: {
  readonly active: string;
  readonly previous?: string;
  readonly pending?: string;
}): InstalledComponentV1 => {
  const versions = [input.active, input.previous, input.pending]
    .filter((value): value is string => value !== undefined);
  return {
    componentId: "lyra.runtime",
    kind: "runtime",
    active: input.active,
    ...(input.previous === undefined ? {} : { previous: input.previous }),
    ...(input.pending === undefined ? {} : { pending: input.pending }),
    versions: Object.fromEntries(versions.map((version) => [version, {
      installedAt: "2026-07-30T00:00:00.000Z",
      target: "darwin-arm64",
      manifest: {
        schemaVersion: 1,
        componentId: "lyra.runtime",
        kind: "runtime",
        version,
        target: "darwin-arm64",
        entry: "bin/lyrad",
        activation: "runtime-idle",
        dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
        permissions: [],
        publisher: "lyra",
        keyId: "test",
        signature: "A".repeat(86) + "==",
        files: [{ path: "bin/lyrad", size: 1, sha256: "a".repeat(64) }]
      }
    }]))
  };
};

const runtimeClient = (health: () => Promise<unknown>): LyraRuntimeClient => ({
  request: async <T>() => await health() as T,
  registerRequestHandler: vi.fn(),
  unregisterRequestHandler: vi.fn(),
  subscribe: () => () => undefined,
  dispose: vi.fn()
});

describe("runtime component update service", () => {
  test("activates and restarts the pending runtime entry", async () => {
    const componentsRoot = "/tmp/lyra-components";
    const coordinator = createRuntimeUpdateCoordinator();
    const restartRuntime = vi.fn(async () => undefined);
    const replayLspDocuments = vi.fn(async () => undefined);
    const service = createRuntimeComponentUpdateService({
      componentsRoot,
      coordinator,
      runtimeClient: runtimeClient(async () => ({
        componentVersion: "1.1.0",
        buildId: "runtime-1.1.0"
      })),
      restartRuntime,
      replayLspDocuments,
      validateRuntimeEntry: async () => undefined
    });
    const staged = component({ active: "1.0.0", pending: "1.1.0" });
    const activated = component({ active: "1.1.0", previous: "1.0.0" });

    await expect(service.activatePending({
      component: staged,
      activate: async () => activated,
      rollback: async () => staged,
      read: async () => activated
    })).resolves.toBe(activated);

    expect(restartRuntime).toHaveBeenCalledWith(
      path.join(componentsRoot, "lyra.runtime", "1.1.0", "darwin-arm64", "bin/lyrad"),
      "1.1.0"
    );
  });

  test("switches the restart target back before recovering from a failed health check", async () => {
    const componentsRoot = "/tmp/lyra-components";
    const coordinator = createRuntimeUpdateCoordinator();
    const restartPaths: string[] = [];
    let healthAttempt = 0;
    const service = createRuntimeComponentUpdateService({
      componentsRoot,
      coordinator,
      runtimeClient: runtimeClient(async () => {
        healthAttempt += 1;
        if (healthAttempt === 1) {
          throw new Error("bad runtime");
        }
        return { componentVersion: "1.0.0", buildId: "runtime-1.0.0" };
      }),
      restartRuntime: async (runtimeBinaryPath) => {
        restartPaths.push(runtimeBinaryPath);
      },
      replayLspDocuments: async () => undefined,
      validateRuntimeEntry: async () => undefined
    });
    const staged = component({ active: "1.0.0", pending: "1.1.0" });
    const activated = component({ active: "1.1.0", previous: "1.0.0" });
    const restored = component({ active: "1.0.0", previous: "1.1.0" });
    let current = staged;
    const recoveryOrder: string[] = [];
    const rollback = vi.fn(async () => {
      expect(recoveryOrder).toEqual(["data"]);
      current = restored;
      return restored;
    });
    const beforeData = {
      schemaVersion: 1 as const,
      componentId: "lyra.runtime",
      dataSchema: 1,
      updatedAt: "2026-07-30T00:00:00.000Z"
    };
    const dataTransaction: ModuleDataSchemaTransaction = {
      componentId: "lyra.runtime",
      before: beforeData,
      prepared: {
        ...beforeData,
        dataSchema: 2,
        updatedAt: "2026-07-31T00:00:00.000Z"
      },
      changed: true,
      commit: vi.fn(async () => ({
        ...beforeData,
        dataSchema: 2
      })),
      rollback: vi.fn(async (restoreActivation) => {
        recoveryOrder.push("data");
        expect(current.active).toBe("1.1.0");
        await restoreActivation?.();
        recoveryOrder.push("version");
        return beforeData;
      })
    };

    await expect(service.activatePending({
      component: staged,
      activate: async () => {
        current = activated;
        return activated;
      },
      rollback,
      read: async () => current,
      dataTransaction
    })).rejects.toThrow("bad runtime");

    expect(rollback).toHaveBeenCalledOnce();
    expect(dataTransaction.rollback).toHaveBeenCalledOnce();
    expect(dataTransaction.commit).not.toHaveBeenCalled();
    expect(recoveryOrder).toEqual(["data", "version"]);
    expect(restartPaths).toEqual([
      path.join(componentsRoot, "lyra.runtime", "1.1.0", "darwin-arm64", "bin/lyrad"),
      path.join(componentsRoot, "lyra.runtime", "1.0.0", "darwin-arm64", "bin/lyrad")
    ]);
  });

  test("uses the same safe restart path for an explicit runtime rollback", async () => {
    const componentsRoot = "/tmp/lyra-components";
    const coordinator = createRuntimeUpdateCoordinator();
    const restartRuntime = vi.fn(async () => undefined);
    const service = createRuntimeComponentUpdateService({
      componentsRoot,
      coordinator,
      runtimeClient: runtimeClient(async () => ({
        componentVersion: "1.0.0",
        buildId: "runtime-1.0.0"
      })),
      restartRuntime,
      replayLspDocuments: async () => undefined,
      validateRuntimeEntry: async () => undefined
    });
    const current = component({ active: "1.1.0", previous: "1.0.0" });
    const rolledBack = component({ active: "1.0.0", previous: "1.1.0" });

    await expect(service.rollbackActive({
      component: current,
      rollback: async () => rolledBack,
      restore: async () => current,
      read: async () => rolledBack
    })).resolves.toBe(rolledBack);

    expect(restartRuntime).toHaveBeenCalledWith(
      path.join(componentsRoot, "lyra.runtime", "1.0.0", "darwin-arm64", "bin/lyrad"),
      "1.0.0"
    );
  });

  test("preflights the target executable before changing activation pointers", async () => {
    const coordinator = createRuntimeUpdateCoordinator();
    const activate = vi.fn(async () => component({
      active: "1.1.0",
      previous: "1.0.0"
    }));
    const service = createRuntimeComponentUpdateService({
      componentsRoot: "/tmp/lyra-components",
      coordinator,
      runtimeClient: runtimeClient(async () => ({
        componentVersion: "1.1.0",
        buildId: "runtime-1.1.0"
      })),
      restartRuntime: async () => undefined,
      replayLspDocuments: async () => undefined,
      validateRuntimeEntry: async () => {
        throw new Error("runtime entry is not executable");
      }
    });
    const staged = component({ active: "1.0.0", pending: "1.1.0" });

    await expect(service.activatePending({
      component: staged,
      activate,
      rollback: async () => staged,
      read: async () => staged
    })).rejects.toThrow("runtime entry is not executable");
    expect(activate).not.toHaveBeenCalled();
  });
});

describe("runtime startup selection", () => {
  test("requires a signed active Runtime in packaged builds", () => {
    expect(() => resolveRuntimeStartupEntry({
      componentsRoot: "/components",
      component: null,
      allowDevelopmentFallback: false
    })).toThrow("requires an active, signed lyra.runtime");
  });

  test("keeps repository discovery only for development", () => {
    expect(resolveRuntimeStartupEntry({
      componentsRoot: "/components",
      component: null,
      allowDevelopmentFallback: true
    })).toBeUndefined();
  });

  test("prefers the freshly built repository Runtime during development", () => {
    expect(resolveRuntimeStartupEntry({
      componentsRoot: "/components",
      component: component({ active: "1.0.0" }),
      allowDevelopmentFallback: true,
      preferDevelopmentFallback: true
    })).toBeUndefined();
  });
});
