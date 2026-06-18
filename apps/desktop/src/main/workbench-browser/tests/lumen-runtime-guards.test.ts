import { describe, expect, test, vi } from "vitest";

import {
  clampHostActionTimeoutMs,
  LUMEN_HOST_ACTION_TIMEOUT_MS,
  waitForPageReady
} from "../view-manager-runtime/lumen-runtime-guards";

describe("lumen-runtime-guards", () => {
  test("clampHostActionTimeoutMs respects the 180s ceiling", () => {
    expect(clampHostActionTimeoutMs(undefined)).toBe(LUMEN_HOST_ACTION_TIMEOUT_MS);
    expect(clampHostActionTimeoutMs(250)).toBe(250);
    expect(clampHostActionTimeoutMs(999_999)).toBe(LUMEN_HOST_ACTION_TIMEOUT_MS);
  });

  test("waitForPageReady resolves when document is complete", async () => {
    const webContents = {
      isDestroyed: () => false,
      isLoading: () => false,
      executeJavaScript: vi.fn(async () => "complete")
    };
    await expect(waitForPageReady(webContents as never, 500)).resolves.toBe(true);
  });
});