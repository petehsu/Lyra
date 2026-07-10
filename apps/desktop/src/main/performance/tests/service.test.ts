import { describe, expect, test, vi } from "vitest";

import { createLyraPerformanceResourceScheduler } from "../service";
import type { LyraRuntimeClient } from "../../runtime-client";
import type { LyraPerformanceResourceDescriptor } from "../../../shared/performance-kernel";

const resource = (
  changes: Partial<LyraPerformanceResourceDescriptor> = {}
): LyraPerformanceResourceDescriptor => ({
  resourceId: "browserPage:1",
  kind: "browserPage",
  coreKey: "https://example.test",
  stateKey: "web-state:1",
  lifecycle: "foreground",
  visible: true,
  active: true,
  ...changes
});

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createRuntimeClient = (
  requestImpl: LyraRuntimeClient["request"] = async <T,>() => ({} as T)
): LyraRuntimeClient => ({
  request: vi.fn(requestImpl) as LyraRuntimeClient["request"],
  registerRequestHandler: vi.fn(),
  unregisterRequestHandler: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  dispose: vi.fn()
});

describe("Lyra performance resource scheduler", () => {
  test("coalesces repeated resource updates and ignores timestamp-only changes", async () => {
    const runtimeClient = createRuntimeClient();
    const scheduler = createLyraPerformanceResourceScheduler(runtimeClient);

    scheduler.updateResource(resource({ updatedAt: 1 }));
    scheduler.updateResource(resource({ updatedAt: 2 }));
    scheduler.updateResource(resource({ active: false, updatedAt: 3 }));

    await flushMicrotasks();

    expect(runtimeClient.request).toHaveBeenCalledTimes(1);
    expect(runtimeClient.request).toHaveBeenCalledWith(
      "performance.updateResource",
      expect.objectContaining({ active: false, updatedAt: 3 })
    );
  });

  test("drops a resource mutation that is removed before it reaches the runtime", async () => {
    const runtimeClient = createRuntimeClient();
    const scheduler = createLyraPerformanceResourceScheduler(runtimeClient);

    scheduler.registerResource(resource());
    scheduler.unregisterResource("browserPage:1");

    await flushMicrotasks();

    expect(runtimeClient.request).not.toHaveBeenCalled();
  });

  test("keeps only the final state while a resource update is in flight", async () => {
    let releaseFirstRequest: (() => void) | undefined;
    const firstRequest = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    let requestCount = 0;
    const runtimeClient = createRuntimeClient(async <T,>() => {
      requestCount += 1;
      if (requestCount === 1) {
        await firstRequest;
      }
      return {} as T;
    });
    const scheduler = createLyraPerformanceResourceScheduler(runtimeClient);

    scheduler.updateResource(resource({ updatedAt: 1 }));
    await flushMicrotasks();
    scheduler.updateResource(resource({ active: false, updatedAt: 2 }));
    scheduler.updateResource(resource({ updatedAt: 3 }));
    releaseFirstRequest?.();
    await flushMicrotasks();

    expect(runtimeClient.request).toHaveBeenCalledTimes(1);
  });
});
