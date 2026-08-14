import type { ComponentManifestV1 } from "@lyra/app-runtime";
import { describe, expect, test, vi } from "vitest";

import type { LyraRuntimeClient } from "../runtime-client";
import { createRuntimeUpdateCoordinator } from "../runtime-update/coordinator";
import type {
  ComponentRegistryStore,
  InstalledComponentV1
} from "./registry";
import type { ModuleDataSchemaTransaction } from "./data-schema";
import type {
  ResourceComponentManager,
  ResolvedResourceComponent
} from "./resource-components";
import {
  createResourceComponentUpdateService,
  recoverUnhealthyActiveResourceComponents
} from "./resource-update";

const manifest = (
  componentId: string,
  version: string
): ComponentManifestV1 => ({
  schemaVersion: 1,
  componentId,
  kind: "resource",
  version,
  target: "darwin-arm64",
  entry: "resource.json",
  activation: "resource-idle",
  dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
  permissions: [],
  publisher: "Lyra",
  files: [{
    path: "resource.json",
    size: 1,
    sha256: "0".repeat(64)
  }],
  keyId: "test",
  signature: `${"A".repeat(86)}==`
});

const createComponent = (componentId: string): InstalledComponentV1 => ({
  componentId,
  kind: "resource",
  active: "1.0.0",
  pending: "2.0.0",
  versions: {
    "1.0.0": {
      manifest: manifest(componentId, "1.0.0"),
      installedAt: "2026-07-30T00:00:00.000Z",
      target: "darwin-arm64"
    },
    "2.0.0": {
      manifest: manifest(componentId, "2.0.0"),
      installedAt: "2026-07-31T00:00:00.000Z",
      target: "darwin-arm64"
    }
  }
});

const createMutableRegistry = (
  initial: InstalledComponentV1
): {
  readonly registry: ComponentRegistryStore;
  readonly readCurrent: () => InstalledComponentV1;
} => {
  let current = initial;
  const restore = (activation: {
    readonly active?: string;
    readonly previous?: string;
    readonly pending?: string;
  }): InstalledComponentV1 => {
    const {
      active: _active,
      previous: _previous,
      pending: _pending,
      ...base
    } = current;
    current = {
      ...base,
      ...(activation.active === undefined ? {} : { active: activation.active }),
      ...(activation.previous === undefined ? {} : { previous: activation.previous }),
      ...(activation.pending === undefined ? {} : { pending: activation.pending })
    };
    return current;
  };
  return {
    readCurrent: () => current,
    registry: {
      list: async () => [current],
      read: async (componentId) =>
        componentId === current.componentId ? current : null,
      verifyInstalledVersion: async (_componentId, version) => current.versions[version]!,
      installFromDirectory: async () => current,
      activate: async () => {
        if (current.pending === undefined) {
          return current;
        }
        const target = current.pending;
        current = restore({
          active: target,
          ...(current.active === undefined ? {} : { previous: current.active })
        });
        return current;
      },
      rollback: async () => {
        if (current.previous === undefined) {
          return current;
        }
        const target = current.previous;
        current = restore({
          active: target,
          ...(current.active === undefined ? {} : { previous: current.active })
        });
        return current;
      },
      restoreActivation: async (_componentId, activation) => restore(activation),
      uninstallVersion: async () => undefined,
      recordKeyringSequence: async () => undefined,
      recordCatalogSequence: async () => undefined
    }
  };
};

const createResourceManager = (
  onLockState?: (locked: boolean) => void,
  healthCheck: (resource: ResolvedResourceComponent) => Promise<void> =
    async () => undefined
): ResourceComponentManager => {
  const resolve = (
    componentId: string,
    version: string
  ): ResolvedResourceComponent => ({
    componentId,
    version,
    installedAt: "2026-07-31T00:00:00.000Z",
    rootPath: `/components/${componentId}/${version}`,
    entryPath: `/components/${componentId}/${version}/resource.json`,
    runtimePath: `/components/${componentId}/${version}/resource.json`,
    family: componentId.startsWith("lyra.language.") ? "language" : "generic",
    manifest: manifest(componentId, version)
  });
  return {
    resolveActive: async () => null,
    resolveVersion: async (componentId, version) => resolve(componentId, version),
    acquire: async () => {
      throw new Error("not used");
    },
    withResource: async () => {
      throw new Error("not used");
    },
    acquireExclusive: async (componentId) => {
      onLockState?.(true);
      return {
        componentId,
        release: () => onLockState?.(false)
      };
    },
    assertHealthy: healthCheck,
    listReferences: () => [],
    dispose: () => undefined
  };
};

const createRuntimeClient = (
  identity: () => unknown
): LyraRuntimeClient => ({
  request: async <T>() => identity() as T,
  registerRequestHandler: () => undefined,
  unregisterRequestHandler: () => undefined,
  subscribe: () => () => undefined,
  dispose: () => undefined
});

describe("resource component update service", () => {
  test("restores language activation pointers when cache reload fails", async () => {
    const component = createComponent("lyra.language.test-fr");
    const { registry, readCurrent } = createMutableRegistry(component);
    let resourceLocked = false;
    const reload = vi.fn()
      .mockImplementationOnce(async () => {
        expect(resourceLocked).toBe(false);
        throw new Error("invalid language bundle");
      })
      .mockImplementationOnce(async () => {
        expect(resourceLocked).toBe(false);
      });
    const service = createResourceComponentUpdateService({
      registry,
      manager: createResourceManager((locked) => {
        resourceLocked = locked;
      }),
      runtimeClient: createRuntimeClient(() => ({ buildId: "runtime" })),
      runtimeCoordinator: createRuntimeUpdateCoordinator(),
      restartRuntime: async () => undefined,
      replayLspDocuments: async () => undefined,
      applyRuntimeEnvironment: async () => undefined,
      reloadLanguageResources: reload
    });

    await expect(service.activatePending(component.componentId)).rejects.toThrow(
      "invalid language bundle"
    );
    expect(readCurrent()).toMatchObject({
      active: "1.0.0",
      pending: "2.0.0"
    });
    expect(readCurrent().previous).toBeUndefined();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test("restarts the previous runtime environment after a failed backend health check", async () => {
    const component = createComponent("lyra.resource.playwright");
    const { registry, readCurrent } = createMutableRegistry(component);
    let healthChecks = 0;
    const restartRuntime = vi.fn(async () => undefined);
    const applyEnvironment = vi.fn(async () => undefined);
    const recoveryOrder: string[] = [];
    const beforeData = {
      schemaVersion: 1 as const,
      componentId: component.componentId,
      dataSchema: 1,
      updatedAt: "2026-07-30T00:00:00.000Z"
    };
    const dataTransaction: ModuleDataSchemaTransaction = {
      componentId: component.componentId,
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
        expect(readCurrent().active).toBe("2.0.0");
        await restoreActivation?.();
        recoveryOrder.push("version");
        return beforeData;
      })
    };
    const service = createResourceComponentUpdateService({
      registry,
      manager: createResourceManager(),
      runtimeClient: createRuntimeClient(() => {
        healthChecks += 1;
        return healthChecks === 1 ? {} : { buildId: "restored-runtime" };
      }),
      runtimeCoordinator: createRuntimeUpdateCoordinator(),
      restartRuntime,
      replayLspDocuments: async () => undefined,
      applyRuntimeEnvironment: applyEnvironment,
      reloadLanguageResources: async () => undefined
    });

    await expect(service.activatePending(
      component.componentId,
      dataTransaction
    )).rejects.toThrow(
      "Runtime did not pass"
    );
    expect(readCurrent()).toMatchObject({
      active: "1.0.0",
      pending: "2.0.0"
    });
    expect(readCurrent().previous).toBeUndefined();
    expect(restartRuntime).toHaveBeenCalledTimes(2);
    expect(applyEnvironment).toHaveBeenCalledTimes(2);
    expect(dataTransaction.rollback).toHaveBeenCalledOnce();
    expect(dataTransaction.commit).not.toHaveBeenCalled();
    expect(recoveryOrder).toEqual(["data", "version"]);
  });

  test("restores the previous healthy resource after an interrupted activation", async () => {
    const staged = createComponent("lyra.resource.playwright");
    const { registry, readCurrent } = createMutableRegistry(staged);
    await registry.activate(staged.componentId);
    expect(readCurrent()).toMatchObject({
      active: "2.0.0",
      previous: "1.0.0"
    });
    const manager = createResourceManager(
      undefined,
      async (resource) => {
        if (resource.version === "2.0.0") {
          throw new Error("new resource is unhealthy");
        }
      }
    );

    await expect(recoverUnhealthyActiveResourceComponents({
      registry,
      manager
    })).resolves.toEqual([{
      componentId: staged.componentId,
      fromVersion: "2.0.0",
      status: "rolled-back",
      activeVersion: "1.0.0",
      error: "new resource is unhealthy"
    }]);
    expect(readCurrent()).toMatchObject({
      active: "1.0.0",
      previous: "2.0.0"
    });
  });

  test("runs signed first-use installation only inside the Runtime and resource safe point", async () => {
    const component = createComponent("lyra.resource.playwright");
    const { registry, readCurrent } = createMutableRegistry(component);
    const coordinator = createRuntimeUpdateCoordinator();
    let resourceLocked = false;
    const restartRuntime = vi.fn(async () => undefined);
    const applyEnvironment = vi.fn(async () => undefined);
    const install = vi.fn(async () => {
      expect(resourceLocked).toBe(true);
      expect(coordinator.readStatus().phase).toBe("activating");
      expect(coordinator.readStatus().admissionOpen).toBe(false);
      return { installed: component.componentId };
    });
    const service = createResourceComponentUpdateService({
      registry,
      manager: createResourceManager((locked) => {
        resourceLocked = locked;
      }),
      runtimeClient: createRuntimeClient(() => ({ buildId: "runtime" })),
      runtimeCoordinator: coordinator,
      restartRuntime,
      replayLspDocuments: async () => undefined,
      applyRuntimeEnvironment: applyEnvironment,
      reloadLanguageResources: async () => undefined
    });

    await expect(service.installOrRepairAtSafePoint(
      component.componentId,
      install
    )).resolves.toMatchObject({
      component: { active: "2.0.0", previous: "1.0.0" },
      result: { installed: component.componentId }
    });
    expect(readCurrent()).toMatchObject({ active: "2.0.0", previous: "1.0.0" });
    expect(resourceLocked).toBe(false);
    expect(restartRuntime).toHaveBeenCalledOnce();
    expect(applyEnvironment).toHaveBeenCalledOnce();
  });
});
