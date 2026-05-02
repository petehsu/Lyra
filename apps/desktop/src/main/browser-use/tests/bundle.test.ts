import { describe, expect, test } from "vitest";

import { resolveCurrentBrowserUseBundleTarget } from "../runtime/bundle";

describe("browser-use bundle targets", () => {
  test("includes Windows ARM64 as a first-class bundle target", () => {
    expect(resolveCurrentBrowserUseBundleTarget("win32", "arm64")?.id).toBe("win32-arm64");
  });

  test("returns null for unsupported long-tail bundle targets", () => {
    expect(resolveCurrentBrowserUseBundleTarget("linux", "riscv64" as NodeJS.Architecture)).toBeNull();
  });
});
