import { describe, expect, test } from "vitest";

import { isIgnoredWorkbenchWindowError } from "./app-status-host";

describe("isIgnoredWorkbenchWindowError", () => {
  test("ignores Chromium ResizeObserver loop notifications", () => {
    expect(isIgnoredWorkbenchWindowError({
      message: "ResizeObserver loop completed with undelivered notifications.",
      error: null
    })).toBe(true);
    expect(isIgnoredWorkbenchWindowError({
      message: "",
      error: new Error("ResizeObserver loop limit exceeded")
    })).toBe(true);
  });

  test("ignores React commit NotFoundError DOMExceptions", () => {
    expect(isIgnoredWorkbenchWindowError({
      message: "Failed to execute 'removeChild' on 'Node'",
      error: new DOMException("not a child", "NotFoundError")
    })).toBe(true);
  });

  test("does not ignore real renderer failures", () => {
    expect(isIgnoredWorkbenchWindowError({
      message: "boom",
      error: new Error("boom")
    })).toBe(false);
  });
});
