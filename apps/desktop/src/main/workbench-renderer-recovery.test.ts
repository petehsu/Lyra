import { describe, expect, test } from "vitest";

import {
  createRendererReloadLimiter,
  isIgnoredRendererGoneReason,
  shouldLinuxStartupRelaunch,
  WORKBENCH_RENDERER_CRASH_LOOP_MAX
} from "./workbench-renderer-recovery";

describe("workbench renderer recovery policy", () => {
  test("ignores a clean renderer exit", () => {
    expect(isIgnoredRendererGoneReason("clean-exit")).toBe(true);
    expect(isIgnoredRendererGoneReason("crashed")).toBe(false);
  });

  test("keeps linux first-paint relaunch only before load in packaged mode", () => {
    expect(
      shouldLinuxStartupRelaunch({
        didFinishLoad: false,
        isDevelopmentMode: false,
        linuxCompatEnabled: true,
        linuxRecoveryActive: false,
        reason: "crashed"
      })
    ).toBe(true);
    expect(
      shouldLinuxStartupRelaunch({
        didFinishLoad: true,
        isDevelopmentMode: false,
        linuxCompatEnabled: true,
        linuxRecoveryActive: false,
        reason: "crashed"
      })
    ).toBe(false);
    expect(
      shouldLinuxStartupRelaunch({
        didFinishLoad: false,
        isDevelopmentMode: true,
        linuxCompatEnabled: true,
        linuxRecoveryActive: false,
        reason: "crashed"
      })
    ).toBe(false);
  });

  test("stops reloading after a crash loop", () => {
    let now = 1_000;
    const limiter = createRendererReloadLimiter(() => now);
    for (let index = 0; index < WORKBENCH_RENDERER_CRASH_LOOP_MAX; index += 1) {
      expect(limiter.shouldReload()).toBe(true);
      now += 1;
    }
    expect(limiter.shouldReload()).toBe(false);
  });
});
