import { beforeEach, describe, expect, test } from "vitest";

import {
  clearLocalStartupComplete,
  hasCompletedLocalStartup,
  markLocalStartupComplete,
  persistStartupPreferences,
  resolveStartupRequestedLocale
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

  test("restores an explicit remote locale and otherwise follows the system", () => {
    persistStartupPreferences({
      locale: "ja-JP",
      localePreference: { mode: "explicit", locale: "ja-JP" },
      theme: "lyra-system"
    });
    expect(resolveStartupRequestedLocale("zh-CN")).toBe("ja-JP");

    persistStartupPreferences({
      locale: "ja-JP",
      localePreference: { mode: "system" },
      theme: "lyra-system"
    });
    expect(resolveStartupRequestedLocale("zh-CN")).toBe("zh-CN");
  });
});
