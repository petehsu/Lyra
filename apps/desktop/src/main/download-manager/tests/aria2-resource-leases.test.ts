import { describe, expect, test, vi } from "vitest";

import {
  ARIA2_RESOURCE_COMPONENT_ID,
  ResourceComponentUpdatePendingError,
  ResourceConsumerBindingError,
  ResourceConsumerUnavailableError,
  type ResolvedResourceComponent,
  type ResourceComponentLease,
  type ResourceComponentManager
} from "../../components";
import {
  type LyraRuntimeClient,
  type RuntimeEventListener,
  type RuntimeRequestHandler
} from "../../runtime-client";
import {
  ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD,
  ARIA2_RESOURCE_LEASE_RELEASE_METHOD,
  createAria2ResourceLeaseHostService
} from "../aria2-resource-leases";

const runtimePath = "/components/lyra.resource.aria2/1.37.0/linux-x64/bin/aria2c";

const resource = {
  componentId: ARIA2_RESOURCE_COMPONENT_ID,
  version: "1.37.0",
  installedAt: "2026-07-31T00:00:00.000Z",
  rootPath: "/components/lyra.resource.aria2/1.37.0/linux-x64",
  entryPath: "/components/lyra.resource.aria2/1.37.0/linux-x64/manifest.json",
  runtimePath,
  family: "aria2",
  manifest: {}
} as ResolvedResourceComponent;

const acquirePayload = {
  componentId: ARIA2_RESOURCE_COMPONENT_ID,
  taskId: "download-a",
  runtimePath,
  componentVersion: resource.version
};

const createRuntimeHarness = () => {
  const handlers = new Map<string, RuntimeRequestHandler>();
  const listeners = new Set<RuntimeEventListener>();
  const runtimeClient = {
    request: vi.fn(),
    registerRequestHandler: vi.fn((method, handler) => {
      handlers.set(method, handler);
    }),
    unregisterRequestHandler: vi.fn((method) => {
      handlers.delete(method);
    }),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    dispose: vi.fn()
  } as LyraRuntimeClient;
  return {
    runtimeClient,
    call: async (method: string, payload: unknown): Promise<unknown> => {
      const handler = handlers.get(method);
      if (handler === undefined) {
        throw new Error(`missing handler ${method}`);
      }
      return await handler(payload);
    },
    emit: (event: string, payload: unknown): void => {
      for (const listener of listeners) {
        listener(event, payload);
      }
    }
  };
};

const createManagerHarness = ({
  active = resource,
  acquireError
}: {
  readonly active?: ResolvedResourceComponent | null;
  readonly acquireError?: Error;
} = {}) => {
  const release = vi.fn();
  const lease = {
    ...resource,
    release
  } as ResourceComponentLease;
  const manager = {
    resolveActive: vi.fn(async () => active),
    acquire: vi.fn(async () => {
      if (acquireError !== undefined) {
        throw acquireError;
      }
      return lease;
    })
  } as unknown as ResourceComponentManager;
  return { manager, release };
};

const createService = ({
  manager,
  runtimeClient,
  configuredPath = runtimePath,
  configuredVersion = resource.version,
  developmentFallback = false
}: {
  readonly manager: ResourceComponentManager;
  readonly runtimeClient: LyraRuntimeClient;
  readonly configuredPath?: string;
  readonly configuredVersion?: string;
  readonly developmentFallback?: boolean;
}) => createAria2ResourceLeaseHostService({
  manager,
  runtimeClient,
  readConfiguredRuntimePath: () => configuredPath,
  readConfiguredComponentVersion: () => configuredVersion,
  developmentFallback,
  platform: "linux",
  createLeaseId: () => "lease-a"
});

describe("aria2 resource task leases", () => {
  test("pins the signed component until Runtime reports the task stopped", async () => {
    const runtime = createRuntimeHarness();
    const { manager, release } = createManagerHarness();
    const service = createService({ manager, runtimeClient: runtime.runtimeClient });

    await expect(
      runtime.call(ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD, acquirePayload)
    ).resolves.toEqual({
      componentId: ARIA2_RESOURCE_COMPONENT_ID,
      taskId: "download-a",
      leaseId: "lease-a",
      version: "1.37.0",
      source: "component"
    });
    expect(service.activeLeaseCount()).toBe(1);
    expect(release).not.toHaveBeenCalled();

    await expect(runtime.call(ARIA2_RESOURCE_LEASE_RELEASE_METHOD, {
      componentId: ARIA2_RESOURCE_COMPONENT_ID,
      taskId: "download-a",
      leaseId: "lease-a"
    })).resolves.toEqual({ released: true });
    expect(release).toHaveBeenCalledTimes(1);
    expect(service.activeLeaseCount()).toBe(0);
    service.dispose();
  });

  test("fails closed when the packaged component is missing", async () => {
    const runtime = createRuntimeHarness();
    const { manager } = createManagerHarness({ active: null });
    const service = createService({ manager, runtimeClient: runtime.runtimeClient });

    await expect(
      runtime.call(ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD, acquirePayload)
    ).rejects.toBeInstanceOf(ResourceConsumerUnavailableError);
    expect(manager.acquire).not.toHaveBeenCalled();
    service.dispose();
  });

  test("releases and rejects a stale Runtime path or version in production", async () => {
    const runtime = createRuntimeHarness();
    const { manager, release } = createManagerHarness();
    const service = createService({
      manager,
      runtimeClient: runtime.runtimeClient,
      configuredPath: "/components/stale/aria2c"
    });

    await expect(
      runtime.call(ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD, acquirePayload)
    ).rejects.toBeInstanceOf(ResourceConsumerBindingError);
    expect(release).toHaveBeenCalledTimes(1);
    expect(service.activeLeaseCount()).toBe(0);
    service.dispose();
  });

  test("does not bypass an in-progress staged switch with development fallback", async () => {
    const runtime = createRuntimeHarness();
    const pending = new ResourceComponentUpdatePendingError(
      ARIA2_RESOURCE_COMPONENT_ID
    );
    const { manager } = createManagerHarness({ acquireError: pending });
    const service = createService({
      manager,
      runtimeClient: runtime.runtimeClient,
      developmentFallback: true
    });

    await expect(
      runtime.call(ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD, acquirePayload)
    ).rejects.toBe(pending);
    expect(service.activeLeaseCount()).toBe(0);
    service.dispose();
  });

  test("keeps the explicit development fallback when no component is installed", async () => {
    const runtime = createRuntimeHarness();
    const { manager } = createManagerHarness({ active: null });
    const service = createService({
      manager,
      runtimeClient: runtime.runtimeClient,
      developmentFallback: true
    });

    await expect(
      runtime.call(ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD, acquirePayload)
    ).resolves.toMatchObject({
      taskId: "download-a",
      leaseId: "lease-a",
      version: null,
      source: "development-fallback"
    });
    expect(service.activeLeaseCount()).toBe(1);
    service.dispose();
    expect(service.activeLeaseCount()).toBe(0);
  });

  test("keeps outstanding references across an unproven socket disconnect", async () => {
    const runtime = createRuntimeHarness();
    const { manager, release } = createManagerHarness();
    const service = createService({ manager, runtimeClient: runtime.runtimeClient });
    await runtime.call(ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD, acquirePayload);

    runtime.emit("lyra.runtime.lifecycle", {
      kind: "disconnected",
      generation: 1
    });

    expect(release).not.toHaveBeenCalled();
    expect(service.activeLeaseCount()).toBe(1);
    service.dispose();
    expect(release).toHaveBeenCalledTimes(1);
    expect(service.activeLeaseCount()).toBe(0);
  });

  test("rejects a development fallback that is not the configured bundle", async () => {
    const runtime = createRuntimeHarness();
    const { manager } = createManagerHarness({ active: null });
    const service = createService({
      manager,
      runtimeClient: runtime.runtimeClient,
      developmentFallback: true,
      configuredPath: "/repo/verified/aria2c",
      configuredVersion: "aria2-development"
    });

    await expect(runtime.call(ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD, {
      ...acquirePayload,
      runtimePath: "/tmp/untrusted/aria2c",
      componentVersion: "aria2-development"
    })).rejects.toBeInstanceOf(ResourceConsumerBindingError);
    expect(service.activeLeaseCount()).toBe(0);
    service.dispose();
  });
});
