import type { LyraRuntimeClient } from "../runtime-client";
import type {
  LyraPerformanceKernelStatus,
  LyraPerformancePressureHarnessResult,
  LyraPerformancePressureSnapshot,
  LyraPerformanceResourceDescriptor
} from "../../shared/performance-kernel";

export type LyraPerformanceResourceScheduler = {
  readonly registerResource: (resource: LyraPerformanceResourceDescriptor) => void;
  readonly updateResource: (resource: LyraPerformanceResourceDescriptor) => void;
  readonly unregisterResource: (resourceId: string) => void;
  readonly status: () => Promise<LyraPerformanceKernelStatus>;
  readonly readPressureSnapshot: (payload?: {
    readonly processIds?: readonly number[];
    readonly includeRegisteredResources?: boolean;
    readonly sampleMs?: number;
  }) => Promise<LyraPerformancePressureSnapshot>;
  readonly runPressureHarness: (payload?: {
    readonly repeatedResourceCount?: number;
    readonly processIds?: readonly number[];
    readonly includeRegisteredResources?: boolean;
    readonly sampleMs?: number;
  }) => Promise<LyraPerformancePressureHarnessResult>;
};

type QueuedPerformanceMutation =
  | {
      readonly kind: "upsert";
      readonly method: "performance.registerResource" | "performance.updateResource";
      readonly resource: LyraPerformanceResourceDescriptor;
      readonly signature: string;
    }
  | {
      readonly kind: "remove";
      readonly resourceId: string;
    };

const resourceSignature = (resource: LyraPerformanceResourceDescriptor): string => {
  const { updatedAt: _updatedAt, ...semanticResource } = resource;
  return JSON.stringify(semanticResource);
};

export const createLyraPerformanceResourceScheduler = (
  runtimeClient: LyraRuntimeClient
): LyraPerformanceResourceScheduler => {
  const appliedSignatures = new Map<string, string>();
  const queuedMutations = new Map<string, QueuedPerformanceMutation>();
  const inFlightResourceIds = new Set<string>();
  const inFlightSignatures = new Map<string, string>();
  let flushScheduled = false;
  let flushing = false;

  const scheduleFlush = (): void => {
    if (flushScheduled || flushing) {
      return;
    }
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      void flush();
    });
  };

  const flush = async (): Promise<void> => {
    if (flushing) {
      return;
    }
    flushing = true;
    try {
      while (queuedMutations.size > 0) {
        const [resourceId, mutation] = queuedMutations.entries().next().value as [
          string,
          QueuedPerformanceMutation
        ];
        queuedMutations.delete(resourceId);
        if (
          mutation.kind === "upsert"
          && appliedSignatures.get(resourceId) === mutation.signature
        ) {
          continue;
        }
        inFlightResourceIds.add(resourceId);
        if (mutation.kind === "upsert") {
          inFlightSignatures.set(resourceId, mutation.signature);
        }
        try {
          if (mutation.kind === "upsert") {
            await runtimeClient.request(mutation.method, mutation.resource);
            appliedSignatures.set(resourceId, mutation.signature);
          } else {
            await runtimeClient.request("performance.unregisterResource", { resourceId });
            appliedSignatures.delete(resourceId);
          }
        } catch (error) {
          console.warn(`[lyra-performance] ${mutation.kind} failed: ${String(error)}`);
        } finally {
          inFlightResourceIds.delete(resourceId);
          inFlightSignatures.delete(resourceId);
        }
      }
    } finally {
      flushing = false;
      if (queuedMutations.size > 0) {
        scheduleFlush();
      }
    }
  };

  const enqueueResource = (
    method: "performance.registerResource" | "performance.updateResource",
    resource: LyraPerformanceResourceDescriptor
  ): void => {
    const signature = resourceSignature(resource);
    const queued = queuedMutations.get(resource.resourceId);
    if (
      queued?.kind === "upsert"
      && queued.signature === signature
    ) {
      return;
    }
    if (
      queued === undefined
      && (
        appliedSignatures.get(resource.resourceId) === signature
        || inFlightSignatures.get(resource.resourceId) === signature
      )
    ) {
      return;
    }
    queuedMutations.set(resource.resourceId, {
      kind: "upsert",
      method,
      resource,
      signature
    });
    scheduleFlush();
  };

  const enqueueRemoval = (resourceId: string): void => {
    const queued = queuedMutations.get(resourceId);
    if (queued?.kind === "remove") {
      return;
    }
    if (queued?.kind === "upsert" && inFlightResourceIds.has(resourceId) === false
      && appliedSignatures.has(resourceId) === false) {
      queuedMutations.delete(resourceId);
      return;
    }
    if (queued === undefined && inFlightResourceIds.has(resourceId) === false
      && appliedSignatures.has(resourceId) === false) {
      return;
    }
    queuedMutations.set(resourceId, { kind: "remove", resourceId });
    scheduleFlush();
  };

  return {
    registerResource: (resource) => {
      enqueueResource("performance.registerResource", resource);
    },
    updateResource: (resource) => {
      enqueueResource("performance.updateResource", resource);
    },
    unregisterResource: enqueueRemoval,
    status: () =>
      runtimeClient.request<LyraPerformanceKernelStatus>("performance.status", {}),
    readPressureSnapshot: (payload = {}) =>
      runtimeClient.request<LyraPerformancePressureSnapshot>("performance.readPressureSnapshot", payload),
    runPressureHarness: (payload = {}) =>
      runtimeClient.request<LyraPerformancePressureHarnessResult>("performance.runPressureHarness", payload)
  };
};
