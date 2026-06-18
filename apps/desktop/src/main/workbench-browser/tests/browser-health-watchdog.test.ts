import { describe, expect, test } from "vitest";

import {
  browserHealthWarningsFromAlerts,
  createBrowserHealthWatchdog
} from "../view-manager-runtime/browser-health-watchdog";

describe("browser-health-watchdog", () => {
  test("records and consumes alerts per tab", () => {
    const watchdog = createBrowserHealthWatchdog();
    watchdog.onPopupRequested("tab-1", "https://oauth.test/popup");
    watchdog.onCrash("tab-1");

    const snapshot = watchdog.readSnapshot("tab-1");
    expect(snapshot.alerts).toHaveLength(2);
    expect(snapshot.activeKinds).toEqual(expect.arrayContaining(["popup", "crash"]));

    const consumed = watchdog.consumeAlerts("tab-1");
    expect(consumed).toHaveLength(2);
    expect(watchdog.readSnapshot("tab-1").alerts).toHaveLength(0);
  });

  test("browserHealthWarningsFromAlerts prefixes messages", () => {
    const warnings = browserHealthWarningsFromAlerts([
      {
        kind: "captcha",
        severity: "warning",
        message: "Captcha challenge detected",
        at: Date.now()
      }
    ]);
    expect(warnings[0]).toContain("browser_health:captcha:");
  });
});