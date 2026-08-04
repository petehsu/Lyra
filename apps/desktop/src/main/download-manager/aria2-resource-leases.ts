import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  ARIA2_RESOURCE_COMPONENT_ID,
  ResourceConsumerBindingError,
  ResourceConsumerUnavailableError,
  type ResourceComponentLease,
  type ResourceComponentManager
} from "../components";
import {
  type LyraRuntimeClient
} from "../runtime-client";

export const ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD =
  "resource.aria2.lease.acquire" as const;
export const ARIA2_RESOURCE_LEASE_RELEASE_METHOD =
  "resource.aria2.lease.release" as const;

type Aria2ResourceLeaseAcquireRequest = {
  readonly componentId: typeof ARIA2_RESOURCE_COMPONENT_ID;
  readonly taskId: string;
  readonly runtimePath: string;
  readonly componentVersion: string;
};

type Aria2ResourceLeaseReleaseRequest = {
  readonly componentId: typeof ARIA2_RESOURCE_COMPONENT_ID;
  readonly taskId: string;
  readonly leaseId: string;
};

export type Aria2ResourceLeaseAcquireResponse = {
  readonly componentId: typeof ARIA2_RESOURCE_COMPONENT_ID;
  readonly taskId: string;
  readonly leaseId: string;
  readonly version: string | null;
  readonly source: "component" | "development-fallback";
};

export type Aria2ResourceLeaseHostService = {
  readonly activeLeaseCount: () => number;
  readonly dispose: () => void;
};

type HeldAria2ResourceLease = Aria2ResourceLeaseAcquireResponse & {
  readonly releaseComponent: (() => void) | null;
};

const publicLeaseResponse = (
  lease: HeldAria2ResourceLease
): Aria2ResourceLeaseAcquireResponse => ({
  componentId: lease.componentId,
  taskId: lease.taskId,
  leaseId: lease.leaseId,
  version: lease.version,
  source: lease.source
});

class Aria2ResourceLeaseProtocolError extends Error {
  readonly code = "ARIA2_RESOURCE_LEASE_BAD_REQUEST";

  constructor(message: string) {
    super(message);
    this.name = "Aria2ResourceLeaseProtocolError";
  }
}

class Aria2ResourceLeaseConflictError extends Error {
  readonly code = "ARIA2_RESOURCE_LEASE_CONFLICT";

  constructor(taskId: string) {
    super(`aria2 task already holds a resource lease: ${taskId}`);
    this.name = "Aria2ResourceLeaseConflictError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireNonEmptyString = (
  value: unknown,
  field: string
): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Aria2ResourceLeaseProtocolError(`${field} must be a non-empty string.`);
  }
  return value.trim();
};

const readAcquireRequest = (value: unknown): Aria2ResourceLeaseAcquireRequest => {
  if (!isRecord(value)) {
    throw new Aria2ResourceLeaseProtocolError("aria2 lease request must be an object.");
  }
  if (value.componentId !== ARIA2_RESOURCE_COMPONENT_ID) {
    throw new Aria2ResourceLeaseProtocolError(
      `aria2 lease component must be ${ARIA2_RESOURCE_COMPONENT_ID}.`
    );
  }
  return {
    componentId: ARIA2_RESOURCE_COMPONENT_ID,
    taskId: requireNonEmptyString(value.taskId, "taskId"),
    runtimePath: requireNonEmptyString(value.runtimePath, "runtimePath"),
    componentVersion: requireNonEmptyString(
      value.componentVersion,
      "componentVersion"
    )
  };
};

const readReleaseRequest = (value: unknown): Aria2ResourceLeaseReleaseRequest => {
  if (!isRecord(value)) {
    throw new Aria2ResourceLeaseProtocolError("aria2 lease release must be an object.");
  }
  if (value.componentId !== ARIA2_RESOURCE_COMPONENT_ID) {
    throw new Aria2ResourceLeaseProtocolError(
      `aria2 lease component must be ${ARIA2_RESOURCE_COMPONENT_ID}.`
    );
  }
  return {
    componentId: ARIA2_RESOURCE_COMPONENT_ID,
    taskId: requireNonEmptyString(value.taskId, "taskId"),
    leaseId: requireNonEmptyString(value.leaseId, "leaseId")
  };
};

const normalizedRuntimePath = (
  value: string,
  platform: NodeJS.Platform
): string => {
  const normalized = path.resolve(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
};

const runtimePathsMatch = (
  left: string | undefined,
  right: string,
  platform: NodeJS.Platform
): boolean =>
  typeof left === "string"
  && left.trim().length > 0
  && normalizedRuntimePath(left, platform) === normalizedRuntimePath(right, platform);

/**
 * Holds the signed aria2 resource version for the complete native task run.
 *
 * The Runtime requests the lease immediately before it starts aria2 and
 * releases it only after the task has stopped and its final state transition
 * has been persisted. Resource activation therefore cannot pass its exclusive
 * safe point while any aria2 process still consumes the old version.
 */
export const createAria2ResourceLeaseHostService = ({
  manager,
  runtimeClient,
  readConfiguredRuntimePath,
  readConfiguredComponentVersion,
  developmentFallback,
  platform = process.platform,
  createLeaseId = randomUUID
}: {
  readonly manager: ResourceComponentManager;
  readonly runtimeClient: LyraRuntimeClient;
  readonly readConfiguredRuntimePath: () => string | undefined;
  readonly readConfiguredComponentVersion: () => string | undefined;
  readonly developmentFallback: boolean;
  readonly platform?: NodeJS.Platform;
  readonly createLeaseId?: () => string;
}): Aria2ResourceLeaseHostService => {
  const leasesById = new Map<string, HeldAria2ResourceLease>();
  const leaseIdByTask = new Map<string, string>();
  let disposed = false;

  const releaseHeldLease = (lease: HeldAria2ResourceLease): void => {
    leasesById.delete(lease.leaseId);
    if (leaseIdByTask.get(lease.taskId) === lease.leaseId) {
      leaseIdByTask.delete(lease.taskId);
    }
    lease.releaseComponent?.();
  };

  const releaseAll = (): void => {
    for (const lease of [...leasesById.values()]) {
      releaseHeldLease(lease);
    }
  };

  const nextLeaseId = (): string => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const leaseId = createLeaseId().trim();
      if (leaseId.length > 0 && !leasesById.has(leaseId)) {
        return leaseId;
      }
    }
    throw new Aria2ResourceLeaseConflictError("lease-id-allocation");
  };

  const holdFallbackLease = (
    request: Aria2ResourceLeaseAcquireRequest
  ): Aria2ResourceLeaseAcquireResponse => {
    if (
      !runtimePathsMatch(
        readConfiguredRuntimePath(),
        request.runtimePath,
        platform
      )
      || readConfiguredComponentVersion() !== request.componentVersion
    ) {
      throw new ResourceConsumerBindingError(ARIA2_RESOURCE_COMPONENT_ID);
    }
    const response: HeldAria2ResourceLease = {
      componentId: ARIA2_RESOURCE_COMPONENT_ID,
      taskId: request.taskId,
      leaseId: nextLeaseId(),
      version: null,
      source: "development-fallback",
      releaseComponent: null
    };
    leasesById.set(response.leaseId, response);
    leaseIdByTask.set(response.taskId, response.leaseId);
    return publicLeaseResponse(response);
  };

  const bindingMatches = (
    request: Aria2ResourceLeaseAcquireRequest,
    lease: ResourceComponentLease
  ): boolean =>
    lease.componentId === ARIA2_RESOURCE_COMPONENT_ID
    && lease.family === "aria2"
    && runtimePathsMatch(readConfiguredRuntimePath(), lease.runtimePath, platform)
    && runtimePathsMatch(request.runtimePath, lease.runtimePath, platform)
    && readConfiguredComponentVersion() === lease.version
    && request.componentVersion === lease.version;

  runtimeClient.registerRequestHandler(
    ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD,
    async (payload) => {
      if (disposed) {
        throw new ResourceConsumerUnavailableError(ARIA2_RESOURCE_COMPONENT_ID);
      }
      const request = readAcquireRequest(payload);
      if (leaseIdByTask.has(request.taskId)) {
        throw new Aria2ResourceLeaseConflictError(request.taskId);
      }

      const active = await manager.resolveActive(ARIA2_RESOURCE_COMPONENT_ID);
      if (active === null) {
        if (developmentFallback) {
          return holdFallbackLease(request);
        }
        throw new ResourceConsumerUnavailableError(ARIA2_RESOURCE_COMPONENT_ID);
      }

      const componentLease = await manager.acquire(ARIA2_RESOURCE_COMPONENT_ID);
      if (!bindingMatches(request, componentLease)) {
        componentLease.release();
        if (developmentFallback) {
          return holdFallbackLease(request);
        }
        throw new ResourceConsumerBindingError(ARIA2_RESOURCE_COMPONENT_ID);
      }

      const response: HeldAria2ResourceLease = {
        componentId: ARIA2_RESOURCE_COMPONENT_ID,
        taskId: request.taskId,
        leaseId: nextLeaseId(),
        version: componentLease.version,
        source: "component",
        releaseComponent: componentLease.release
      };
      leasesById.set(response.leaseId, response);
      leaseIdByTask.set(response.taskId, response.leaseId);
      return publicLeaseResponse(response);
    }
  );

  runtimeClient.registerRequestHandler(
    ARIA2_RESOURCE_LEASE_RELEASE_METHOD,
    (payload) => {
      const request = readReleaseRequest(payload);
      const lease = leasesById.get(request.leaseId);
      if (lease === undefined) {
        return { released: false };
      }
      if (lease.taskId !== request.taskId) {
        throw new Aria2ResourceLeaseProtocolError(
          "aria2 lease release does not match its task."
        );
      }
      releaseHeldLease(lease);
      return { released: true };
    }
  );

  return {
    activeLeaseCount: () => leasesById.size,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      runtimeClient.unregisterRequestHandler(ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD);
      runtimeClient.unregisterRequestHandler(ARIA2_RESOURCE_LEASE_RELEASE_METHOD);
      releaseAll();
    }
  };
};

export const aria2ResourceLeaseInternalsForTests = {
  readAcquireRequest,
  readReleaseRequest,
  runtimePathsMatch
};
