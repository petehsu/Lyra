import { describe, expect, test, vi } from "vitest";

import { createBrowserUseRuntimeCoordinator } from "../runtime/coordinator";
import type { BrowserUseRuntimeManager } from "../types";

const flushAsync = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createRuntime = (
  preflight: BrowserUseRuntimeManager["preflight"],
): BrowserUseRuntimeManager => ({
  dispose: vi.fn(async () => undefined),
  preflight,
  ensureInstalled: vi.fn(async () => ({
    pythonPath: "/tmp/python",
    homeDir: "/tmp/home",
    bundleVersion: "bundle-v1",
    bundleRoot: "/tmp/runtime",
    browserUsePin: "browser-use==0.12.6",
    manifestPath: "/tmp/runtime/manifest.json",
  })),
  startDaemon: vi.fn(async () => undefined),
  stopDaemon: vi.fn(async () => undefined),
  sendCommand: vi.fn(async () => ({ success: true })),
  runAgentTask: vi.fn(async () => ({
    sessionId: "test",
    ok: true,
    steps: [],
  })),
});

describe("browser-use runtime coordinator", () => {
  test("syncs browser_use tools when preflight is healthy and engine allows exposure", async () => {
    const hostTools = {
      sync: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const runtimeClient = {
      request: vi.fn(async () => undefined),
    };
    const coordinator = createBrowserUseRuntimeCoordinator({
      runtime: createRuntime(async () => ({
        ok: true,
        installState: {
          pythonPath: "/tmp/python",
          homeDir: "/tmp/home",
          bundleVersion: "bundle-v1",
          bundleRoot: "/tmp/runtime",
          browserUsePin: "browser-use==0.12.6",
          manifestPath: "/tmp/runtime/manifest.json",
        },
      })),
      runtimeClient: runtimeClient as never,
      hostTools,
      readPreferredEngine: () => "smart",
      bridgeSmoke: async () => undefined,
    });

    coordinator.start();
    await flushAsync();

    expect(coordinator.readStatus().state).toBe("healthy");
    expect(hostTools.sync).toHaveBeenCalledTimes(1);
    expect(hostTools.remove).not.toHaveBeenCalled();
    expect(runtimeClient.request).toHaveBeenCalledWith("agent.browser_strategy.sync", {
      preferredEngine: "smart",
      browserUseHealth: "healthy",
      browserUseToolExposed: true,
    });
  });

  test("removes browser_use tools when preflight is unavailable or engine is lyra_direct", async () => {
    const hostTools = {
      sync: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const runtimeClient = {
      request: vi.fn(async () => undefined),
    };
    const coordinator = createBrowserUseRuntimeCoordinator({
      runtime: createRuntime(async () => ({
        ok: false,
        code: "missing_bundle",
        detail: "missing bundle",
      })),
      runtimeClient: runtimeClient as never,
      hostTools,
      readPreferredEngine: () => "browser_use",
      bridgeSmoke: async () => undefined,
    });

    coordinator.start();
    await flushAsync();

    expect(coordinator.readStatus().state).toBe("unavailable");
    expect(hostTools.remove).toHaveBeenCalledTimes(1);
    expect(runtimeClient.request).toHaveBeenCalledWith("agent.browser_strategy.sync", {
      preferredEngine: "browser_use",
      browserUseHealth: "unavailable",
      browserUseToolExposed: false,
    });

    hostTools.sync.mockClear();
    hostTools.remove.mockClear();
    runtimeClient.request.mockClear();

    await coordinator.applyEnginePreference("lyra_direct");

    expect(hostTools.sync).not.toHaveBeenCalled();
    expect(hostTools.remove).toHaveBeenCalledTimes(1);
    expect(runtimeClient.request).toHaveBeenCalledWith("agent.browser_strategy.sync", {
      preferredEngine: "lyra_direct",
      browserUseHealth: "unavailable",
      browserUseToolExposed: false,
    });
  });
});
