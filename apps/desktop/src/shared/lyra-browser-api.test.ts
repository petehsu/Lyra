import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { isBrowserShellEvent } from "./browser-shell-api";
import type { LyraDesktopApi } from "./desktop-bridge";
import {
  isLyraBrowserEvent,
  LYRA_BROWSER_CDP_PROTOCOL_VERSION,
  LYRA_BROWSER_HOST_ONLY_METHODS,
  LYRA_BROWSER_RENDERER_METHODS
} from "./lyra-browser-api";
import type {
  LyraBrowserApi,
  LyraBrowserCdpSession,
  LyraBrowserRendererApi,
  LyraBrowserRendererMethod
} from "./lyra-browser-api";
import type { WorkbenchBrowserEvent } from "./workbench-browser";

const here = dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath: string): string =>
  readFileSync(join(here, relativePath), "utf8");

const shellEvent = {
  kind: "chrome-popover-state",
  tabId: "tab-1",
  popoverKind: "find",
  visible: false
} satisfies WorkbenchBrowserEvent;

const engineEvent = {
  kind: "page-closed",
  tabId: "tab-1"
} satisfies WorkbenchBrowserEvent;

const ELECTRON_LEAK = /from\s+["']electron["']|\bWebContents\b|session\.cookies|\bwill-download\b/;

describe("browser API event boundary", () => {
  test("shell kinds stay on Browser Shell API", () => {
    expect(isBrowserShellEvent(shellEvent)).toBe(true);
    expect(isLyraBrowserEvent(shellEvent)).toBe(false);
  });

  test("page and CDP-adjacent kinds stay on lyra-browser-api", () => {
    expect(isLyraBrowserEvent(engineEvent)).toBe(true);
    expect(isBrowserShellEvent(engineEvent)).toBe(false);
  });
});

describe("lyra-browser-api engine contract", () => {
  test("renderer methods are unique and match LyraBrowserRendererApi", () => {
    expect(new Set(LYRA_BROWSER_RENDERER_METHODS).size).toBe(
      LYRA_BROWSER_RENDERER_METHODS.length
    );
    const listedIsRendererKey = true as (
      LyraBrowserRendererMethod extends keyof LyraBrowserRendererApi ? true : false
    );
    const rendererKeyIsListed = true as (
      keyof LyraBrowserRendererApi extends LyraBrowserRendererMethod ? true : false
    );
    expect(listedIsRendererKey).toBe(true);
    expect(rendererKeyIsListed).toBe(true);
  });

  test("engine contract has host-only CDP; renderer Desktop API omits it", () => {
    expect(LYRA_BROWSER_CDP_PROTOCOL_VERSION).toBe("1.3");
    expect([...LYRA_BROWSER_HOST_ONLY_METHODS]).toEqual(["cdp", "downloads"]);
    const engineRequiresCdp = true as ("cdp" extends keyof LyraBrowserApi ? true : false);
    const rendererExposesCdp = false as (
      "cdp" extends keyof LyraBrowserRendererApi ? true : false
    );
    const desktopBrowserExposesCdp = false as (
      "cdp" extends keyof LyraDesktopApi["browser"] ? true : false
    );
    const cdpSessionExposesWebContents = false as (
      "webContents" extends keyof LyraBrowserCdpSession ? true : false
    );
    const cdpSessionHasSendCommand = true as (
      "sendCommand" extends keyof LyraBrowserCdpSession ? true : false
    );
    expect(engineRequiresCdp).toBe(true);
    expect(rendererExposesCdp).toBe(false);
    expect(desktopBrowserExposesCdp).toBe(false);
    expect(cdpSessionExposesWebContents).toBe(false);
    expect(cdpSessionHasSendCommand).toBe(true);
  });

  test("shared engine types do not leak WebContents, Electron Session, or download hooks", () => {
    expect(readSource("lyra-browser-api.ts")).not.toMatch(ELECTRON_LEAK);
    expect(readSource("workbench-browser.ts")).not.toMatch(ELECTRON_LEAK);
    expect(readSource("browser-shell-api.ts")).not.toMatch(ELECTRON_LEAK);
  });

  test("preload renderer browser object does not expose CDP sendCommand", () => {
    const preloadSource = readSource("../preload/index.ts");
    const browserBlock = preloadSource.match(/\n  browser: \{[\s\S]*?\n  \},\n  loginManager:/u);
    expect(browserBlock).not.toBeNull();
    expect(browserBlock?.[0]).not.toMatch(/\bcdp\s*:/);
    expect(browserBlock?.[0]).not.toMatch(/\bsendCommand\b/);
  });

  test("Electron adapter keeps createWorkbenchBrowserSharedDebuggerSession(webContents)", () => {
    const debuggerSource = readSource("../main/workbench-browser/debugger.ts");
    expect(debuggerSource).toMatch(/createWorkbenchBrowserSharedDebuggerSession/);
    expect(debuggerSource).toMatch(/webContents:\s*WebContents/);
    expect(debuggerSource).toMatch(
      /from\s+["']\.\.\/\.\.\/shared\/lyra-browser-api["']/u
    );
    expect(debuggerSource).toMatch(/LYRA_BROWSER_CDP_PROTOCOL_VERSION/);
  });
});
