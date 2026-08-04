import { describe, expect, test, vi } from "vitest";

import type {
  ResolvedResourceComponent,
  ResourceComponentManager
} from "./resource-components";
import {
  ResourceConsumerBindingError,
  ResourceConsumerUnavailableError,
  createBoundResourceConsumerLease
} from "./resource-consumer-leases";

const RESOURCE_ID = "lyra.resource.rust-analyzer";

const resource = {
  componentId: RESOURCE_ID,
  version: "1.2.3",
  installedAt: "2026-07-31T00:00:00.000Z",
  rootPath: "/components/rust-analyzer/1.2.3",
  entryPath: "/components/rust-analyzer/1.2.3/rust-analyzer",
  runtimePath: "/components/rust-analyzer/1.2.3/rust-analyzer",
  family: "rust-analyzer",
  manifest: {}
} as ResolvedResourceComponent;

const createManager = ({
  active = resource,
  withResource
}: {
  readonly active?: ResolvedResourceComponent | null;
  readonly withResource?: ResourceComponentManager["withResource"];
} = {}) => {
  const runWithResource = withResource ?? (async (_componentId, operation) =>
    await operation(resource));
  return {
    manager: {
      resolveActive: vi.fn(async () => active),
      withResource: vi.fn(runWithResource)
    } as unknown as ResourceComponentManager
  };
};

describe("bound resource consumer leases", () => {
  test("runs a request under a short lease for the matching active version", async () => {
    const events: string[] = [];
    const { manager } = createManager({
      withResource: async (_componentId, operation) => {
        events.push("lease-acquired");
        try {
          return await operation(resource);
        } finally {
          events.push("lease-released");
        }
      }
    });
    const run = createBoundResourceConsumerLease({
      manager,
      componentId: RESOURCE_ID,
      readConfiguredRuntimePath: () => resource.runtimePath,
      developmentFallback: false
    });

    await expect(run(async (selected) => {
      events.push(`request:${selected?.version ?? "fallback"}`);
      return "ok";
    })).resolves.toBe("ok");

    expect(events).toEqual([
      "lease-acquired",
      "request:1.2.3",
      "lease-released"
    ]);
    expect(manager.withResource).toHaveBeenCalledWith(
      RESOURCE_ID,
      expect.any(Function)
    );
  });

  test("fails closed in production when the component is missing", async () => {
    const { manager } = createManager({ active: null });
    const operation = vi.fn();
    const run = createBoundResourceConsumerLease({
      manager,
      componentId: RESOURCE_ID,
      readConfiguredRuntimePath: () => undefined,
      developmentFallback: false
    });

    await expect(run(operation)).rejects.toBeInstanceOf(
      ResourceConsumerUnavailableError
    );
    expect(operation).not.toHaveBeenCalled();
    expect(manager.withResource).not.toHaveBeenCalled();
  });

  test("preserves repository/PATH fallback only in development", async () => {
    const { manager } = createManager({ active: null });
    const operation = vi.fn(async (selected) => selected?.version ?? "fallback");
    const run = createBoundResourceConsumerLease({
      manager,
      componentId: RESOURCE_ID,
      readConfiguredRuntimePath: () => "/development/rust-analyzer",
      developmentFallback: true
    });

    await expect(run(operation)).resolves.toBe("fallback");
    expect(operation).toHaveBeenCalledWith(null);
  });

  test("rejects a stale production process binding", async () => {
    const { manager } = createManager();
    const operation = vi.fn();
    const run = createBoundResourceConsumerLease({
      manager,
      componentId: RESOURCE_ID,
      readConfiguredRuntimePath: () => "/components/rust-analyzer/1.1.0/rust-analyzer",
      developmentFallback: false
    });

    await expect(run(operation)).rejects.toBeInstanceOf(
      ResourceConsumerBindingError
    );
    expect(operation).not.toHaveBeenCalled();
  });

  test("does not retry an operation that fails under a development lease", async () => {
    const { manager } = createManager();
    const operationError = new Error("runtime request failed");
    const operation = vi.fn(async () => {
      throw operationError;
    });
    const run = createBoundResourceConsumerLease({
      manager,
      componentId: RESOURCE_ID,
      readConfiguredRuntimePath: () => resource.runtimePath,
      developmentFallback: true
    });

    await expect(run(operation)).rejects.toBe(operationError);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
