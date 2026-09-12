import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

import {
  applyLyraBrowserLaunchEnv,
  grantBrowserAuthorizeAct,
  hasBrowserAuthorizeActGrant,
  installLyraOpenUrlHelpers,
  isHttpUrl,
  isLyraAuthCallbackUrl,
  LYRA_OPEN_URL_FLAG,
  readHttpUrlFromLyraOpenProtocol,
  readOpenHttpUrlFromArgs,
  resolveElectronAppPathForLaunch
} from "./open-in-workbench";

describe("open-in-workbench routing", () => {
  test("accepts http(s) and rejects other schemes", () => {
    expect(isHttpUrl("https://github.com/login/device")).toBe(true);
    expect(isHttpUrl("http://127.0.0.1:1/")).toBe(true);
    expect(isHttpUrl("mailto:hello@example.com")).toBe(false);
    expect(isHttpUrl("lyra://auth/callback?code=1")).toBe(false);
  });

  test("parses --lyra-open-url and lyra://open from argv", () => {
    expect(readOpenHttpUrlFromArgs([
      "Lyra",
      LYRA_OPEN_URL_FLAG,
      "https://github.com/login/device"
    ])).toBe("https://github.com/login/device");
    expect(readOpenHttpUrlFromArgs([
      `${LYRA_OPEN_URL_FLAG}=https://accounts.google.com/o/oauth2/v2/auth`
    ])).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(readOpenHttpUrlFromArgs([
      "lyra://open?url=https://github.com/login/device"
    ])).toBe("https://github.com/login/device");
    expect(readOpenHttpUrlFromArgs([
      "electron",
      ".",
      "--",
      LYRA_OPEN_URL_FLAG,
      "https://github.com/login/device"
    ])).toBe("https://github.com/login/device");
    expect(readOpenHttpUrlFromArgs(["mailto:hello@example.com"])).toBeUndefined();
  });

  test("recognizes the Google callback deep link", () => {
    expect(isLyraAuthCallbackUrl("lyra://auth/callback?code=abc")).toBe(true);
    expect(isLyraAuthCallbackUrl("https://lyra.local/auth/callback")).toBe(false);
    expect(readHttpUrlFromLyraOpenProtocol("lyra://open?url=https://example.com/login")).toBe(
      "https://example.com/login"
    );
  });

  test("installs a BROWSER helper and prepends it to PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "lyra-open-url-"));
    const helperDir = installLyraOpenUrlHelpers(root);
    const helperPath = join(helperDir, process.platform === "win32" ? "lyra-open-url.cmd" : "lyra-open-url");
    const script = readFileSync(helperPath, "utf8");
    expect(script).toContain(LYRA_OPEN_URL_FLAG);
    const env = applyLyraBrowserLaunchEnv(
      { PATH: "/usr/bin" },
      helperDir,
      { electronExecPath: "/tmp/lyra-electron", platform: "linux" }
    );
    expect(env.BROWSER).toBe(helperPath);
    expect(env.GH_BROWSER).toBe(helperPath);
    expect(env.PATH?.startsWith(`${helperDir}:`)).toBe(true);
    expect(env.LYRA_ELECTRON_EXEC).toBe("/tmp/lyra-electron");
    expect(env.LYRA_SYSTEM_XDG_OPEN).not.toBe(join(helperDir, "xdg-open"));
    const again = applyLyraBrowserLaunchEnv(env, helperDir, {
      electronExecPath: "/tmp/lyra-electron",
      platform: "linux"
    });
    expect(again.LYRA_SYSTEM_XDG_OPEN).toBe(env.LYRA_SYSTEM_XDG_OPEN);
    expect(again.LYRA_SYSTEM_XDG_OPEN?.startsWith(helperDir)).toBe(false);
    const wrapper = readFileSync(join(helperDir, "xdg-open"), "utf8");
    expect(wrapper).toContain("http://*|https://*|lyra://*");
    expect(wrapper).toContain("-u|--url");
    expect(script).toContain(`-- ${LYRA_OPEN_URL_FLAG}`);
  });

  test("bakes an absolute Electron app path into the helper", () => {
    const root = mkdtempSync(join(tmpdir(), "lyra-open-url-"));
    const appPath = resolve("/tmp/lyra-app-root");
    const helperDir = installLyraOpenUrlHelpers(root, {
      electronExecPath: "/tmp/lyra-electron",
      electronAppPath: "."
    });
    const helperPath = join(helperDir, process.platform === "win32" ? "lyra-open-url.cmd" : "lyra-open-url");
    const script = readFileSync(helperPath, "utf8");
    expect(script).not.toMatch(/APP=['"]\.['"]/);
    expect(script).toContain(resolve("."));
    const baked = installLyraOpenUrlHelpers(root, {
      electronExecPath: "/tmp/lyra-electron",
      electronAppPath: appPath
    });
    const bakedScript = readFileSync(join(baked, process.platform === "win32" ? "lyra-open-url.cmd" : "lyra-open-url"), "utf8");
    expect(bakedScript).toContain(appPath);
    expect(resolveElectronAppPathForLaunch(".")).toBe(resolve("."));
    expect(resolveElectronAppPathForLaunch(".")).not.toBe(".");
  });

  test("owns any http(s) origin Lyra opened, including same-tab hops by tab id", () => {
    const opened = "https://grant-loop.example.test/any/confirm-step";
    grantBrowserAuthorizeAct(opened);
    expect(hasBrowserAuthorizeActGrant(opened)).toBe(true);
    expect(hasBrowserAuthorizeActGrant("https://grant-loop.example.test/")).toBe(true);
    expect(hasBrowserAuthorizeActGrant("https://other-origin.example.test/")).toBe(false);
    grantBrowserAuthorizeAct("mailto:hello@example.com");
    expect(hasBrowserAuthorizeActGrant("mailto:hello@example.com")).toBe(false);
    const tabId = "tab-owned-surface";
    grantBrowserAuthorizeAct("https://grant-loop.example.test/continue", tabId);
    expect(hasBrowserAuthorizeActGrant("https://accounts.example.test/challenge", tabId)).toBe(true);
    expect(hasBrowserAuthorizeActGrant("https://accounts.example.test/challenge")).toBe(false);
  });
});
