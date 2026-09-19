import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import type { LyraDesktopApi } from "./desktop-bridge";
import {
  isLyraCoreApiDesktopKey,
  isLyraOsShellAdapterId,
  isLyraOsShellDesktopKey,
  LYRA_CORE_API_DAEMON_METHOD_PREFIXES,
  LYRA_CORE_API_DESKTOP_KEYS,
  LYRA_DAEMON_METHOD_PREFIXES,
  LYRA_OS_SHELL_ADAPTER_IDS,
  LYRA_OS_SHELL_DESKTOP_KEYS,
  LYRA_OS_SHELL_ELECTRON_ADAPTERS,
  LYRA_OS_SHELL_FORBIDDEN_DAEMON_PREFIXES
} from "./core-api-os-shell";

const here = dirname(fileURLToPath(import.meta.url));
const readRepoSource = (relativeFromRepo: string): string =>
  readFileSync(join(here, "../../../..", relativeFromRepo), "utf8");

type CoreDesktopKey = (typeof LYRA_CORE_API_DESKTOP_KEYS)[number];
type OsShellDesktopKey = (typeof LYRA_OS_SHELL_DESKTOP_KEYS)[number];

const coreKeysAreDesktopApi = true as CoreDesktopKey extends keyof LyraDesktopApi ? true : false;
const osKeysAreDesktopApi = true as OsShellDesktopKey extends keyof LyraDesktopApi ? true : false;
const keysStayDisjoint = true as Extract<CoreDesktopKey, OsShellDesktopKey> extends never
  ? true
  : false;

describe("Core API vs this-machine shell freeze", () => {
  test("Core desktop keys are unique, on LyraDesktopApi, and disjoint from OS adapters", () => {
    expect(coreKeysAreDesktopApi).toBe(true);
    expect(osKeysAreDesktopApi).toBe(true);
    expect(keysStayDisjoint).toBe(true);
    expect(new Set(LYRA_CORE_API_DESKTOP_KEYS).size).toBe(LYRA_CORE_API_DESKTOP_KEYS.length);
    expect(new Set(LYRA_OS_SHELL_DESKTOP_KEYS).size).toBe(LYRA_OS_SHELL_DESKTOP_KEYS.length);
    expect(new Set(LYRA_OS_SHELL_ADAPTER_IDS).size).toBe(LYRA_OS_SHELL_ADAPTER_IDS.length);
    expect([...LYRA_CORE_API_DESKTOP_KEYS]).toEqual([
      "agent",
      "terminal",
      "lsp",
      "search",
      "downloads",
      "files",
      "browser"
    ]);
    expect([...LYRA_OS_SHELL_ADAPTER_IDS]).toEqual([
      "windowMaterial",
      "systemNotifications",
      "safeStorage",
      "appUpdate",
      "location",
      "loginCookieVault"
    ]);
    expect(isLyraCoreApiDesktopKey("browser")).toBe(true);
    expect(isLyraCoreApiDesktopKey("loginManager")).toBe(false);
    expect(isLyraOsShellDesktopKey("loginManager")).toBe(true);
    expect(isLyraOsShellDesktopKey("agent")).toBe(false);
    expect(isLyraOsShellAdapterId("windowMaterial")).toBe(true);
    expect(isLyraOsShellAdapterId("browser")).toBe(false);
    for (const key of LYRA_OS_SHELL_DESKTOP_KEYS) {
      expect(isLyraCoreApiDesktopKey(key)).toBe(false);
    }
  });

  test("lyrad keeps Core daemon prefixes and does not grow OS-shell routes", () => {
    const router = readRepoSource("crates/lyrad/src/router.rs");
    const routed = [...router.matchAll(/starts_with\("([^"]+)"\)/gu)].map((match) => match[1]);
    expect(routed).toEqual([...LYRA_DAEMON_METHOD_PREFIXES]);
    for (const prefix of LYRA_CORE_API_DAEMON_METHOD_PREFIXES) {
      expect(routed).toContain(prefix);
    }
    const nativeCoreGuard = readRepoSource("tools/verify-native-core.ts");
    for (const prefix of LYRA_OS_SHELL_FORBIDDEN_DAEMON_PREFIXES) {
      expect(router).not.toContain(`starts_with("${prefix}")`);
      expect(nativeCoreGuard).toContain(`"${prefix}"`);
    }
  });

  test("OS adapters stay in Electron; Desktop API is not split", () => {
    const windowMaterial = readRepoSource("apps/desktop/src/main/window-material.ts");
    expect(windowMaterial).toMatch(/vibrancy:\s*"under-window"/);
    expect(windowMaterial).toMatch(/setBackgroundMaterial/);
    const notifications = readRepoSource("apps/desktop/src/main/system-notifications/service.ts");
    expect(notifications).toMatch(/from\s+["']electron["']/);
    expect(notifications).toMatch(/\bNotification\b/);
    const autoUpdate = readRepoSource("apps/desktop/src/main/auto-update/service.ts");
    expect(autoUpdate).toMatch(/from\s+["']electron-updater["']/);
    const location = readRepoSource("apps/desktop/src/main/location/service.ts");
    expect(location).toMatch(/from\s+["']electron["']/);
    const siteData = readRepoSource("apps/desktop/src/main/login-manager/site-data.ts");
    expect(siteData).toMatch(/electronSession\.cookies/);
    const passwordVault = readRepoSource("apps/desktop/src/main/login-manager/password-vault.ts");
    expect(passwordVault).toMatch(/\bsafeStorage\b/);
    const auth = readRepoSource("apps/desktop/src/main/auth/service.ts");
    expect(auth).toMatch(/\bsafeStorage\b/);
    const sensitiveValues = readRepoSource("apps/desktop/src/main/sensitive-values/service.ts");
    expect(sensitiveValues).toMatch(/\bsafeStorage\b/);
    expect([...LYRA_OS_SHELL_ELECTRON_ADAPTERS]).toEqual([
      "apps/desktop/src/main/window-material.ts",
      "apps/desktop/src/main/system-notifications/service.ts",
      "apps/desktop/src/main/auto-update/service.ts",
      "apps/desktop/src/main/location/service.ts",
      "apps/desktop/src/main/login-manager/site-data.ts",
      "apps/desktop/src/main/login-manager/password-vault.ts",
      "apps/desktop/src/main/auth/service.ts",
      "apps/desktop/src/main/sensitive-values/service.ts"
    ]);
    const desktopApi = readRepoSource("apps/desktop/src/shared/desktop-bridge.ts");
    expect(desktopApi).toMatch(/readonly windowControls:/);
    expect(desktopApi).toMatch(/readonly loginManager\?:/);
    expect(desktopApi).toMatch(/readonly agent\?:/);
    const contract = readRepoSource("docs/contracts/core-api-os-shell.md");
    expect(contract).toMatch(/LyraDesktopApi/);
    expect(contract).toMatch(/loginCookieVault/);
    expect(contract).toMatch(/safeStorage/);
    expect(contract).toMatch(/不要拆渲染 IPC/);
  });
});
