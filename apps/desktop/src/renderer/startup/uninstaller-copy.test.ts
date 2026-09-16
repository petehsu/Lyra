import { describe, expect, test } from "vitest";

import {
  readUninstallerForceFromSearch,
  statusPoolForUninstall,
  UNINSTALL_COMPLETE_STATUS,
  uninstallProgressFraction
} from "./uninstaller-copy";

describe("uninstaller copy", () => {
  test("search and status stay English", () => {
    expect(readUninstallerForceFromSearch("?uninstall=1")).toBe(true);
    expect(readUninstallerForceFromSearch("?installer=1")).toBe(false);
    const idle = statusPoolForUninstall(null, false, false, false);
    expect(idle.length).toBeGreaterThan(1);
    for (const line of idle) {
      expect(line).toBe(line.replace(/[^\x00-\x7F]/gu, ""));
    }
    expect(statusPoolForUninstall(null, false, false, true)[0]).toBe(UNINSTALL_COMPLETE_STATUS);
    expect(statusPoolForUninstall({
      phase: "files",
      completed: 2,
      total: 8,
      label: "cache-v1"
    }, true, false, false).some((line) => /cache|component|session/iu.test(line))).toBe(true);
    expect(uninstallProgressFraction({
      phase: "files",
      completed: 2,
      total: 8
    })).toBe(0.25);
  });
});
