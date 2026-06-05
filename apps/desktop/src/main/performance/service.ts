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

const sendPerformanceRequest = (
  runtimeClient: LyraRuntimeClient,
  method: string,
  payload: unknown
): void => {
  void runtimeClient.request(method, payload).catch((error: unknown) => {
    console.warn(`[lyra-performance] ${method} failed: ${String(error)}`);
  });
};

export const createLyraPerformanceResourceScheduler = (
  runtimeClient: LyraRuntimeClient
): LyraPerformanceResourceScheduler => ({
  registerResource: (resource) => {
    sendPerformanceRequest(runtimeClient, "performance.registerResource", resource);
  },
  updateResource: (resource) => {
    sendPerformanceRequest(runtimeClient, "performance.updateResource", resource);
  },
  unregisterResource: (resourceId) => {
    sendPerformanceRequest(runtimeClient, "performance.unregisterResource", { resourceId });
  },
  status: () =>
    runtimeClient.request<LyraPerformanceKernelStatus>("performance.status", {}),
  readPressureSnapshot: (payload = {}) =>
    runtimeClient.request<LyraPerformancePressureSnapshot>("performance.readPressureSnapshot", payload),
  runPressureHarness: (payload = {}) =>
    runtimeClient.request<LyraPerformancePressureHarnessResult>("performance.runPressureHarness", payload)
});
