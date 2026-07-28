import { beforeEach, describe, expect, test } from "vitest";

import {
  clearLocalStartupComplete,
  hasCompletedLocalStartup,
  markLocalStartupComplete
} from "./startup-preferences";

describe("startup preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("clears the local startup bypass when an account signs out", () => {
    markLocalStartupComplete();
    expect(hasCompletedLocalStartup()).toBe(true);

    clearLocalStartupComplete();

    expect(hasCompletedLocalStartup()).toBe(false);
  });
});
