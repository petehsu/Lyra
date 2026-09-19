import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  BROWSER_SHELL_LAYOUT_COORDINATE_SPACE,
  BROWSER_SHELL_LAYOUT_ORIGIN,
  BROWSER_SHELL_LAYOUT_UNIT,
  BROWSER_SHELL_METHODS,
  toWorkbenchLayoutBounds
} from "./browser-shell-api";
import type { BrowserShellApi, BrowserShellMethod } from "./browser-shell-api";
import type { WorkbenchBrowserLayoutSnapshot } from "./workbench-browser";

const here = dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath: string): string =>
  readFileSync(join(here, relativePath), "utf8");

const DOM_LAYOUT_PROTOCOL = /\bgetBoundingClientRect\b|\bDOMRect\b/;

describe("browser shell layout contract", () => {
  test("shell methods are unique and match BrowserShellApi", () => {
    expect(new Set(BROWSER_SHELL_METHODS).size).toBe(BROWSER_SHELL_METHODS.length);
    const listedIsApiKey = true as (
      BrowserShellMethod extends keyof BrowserShellApi ? true : false
    );
    const apiKeyIsListed = true as (
      keyof BrowserShellApi extends BrowserShellMethod ? true : false
    );
    expect(listedIsApiKey).toBe(true);
    expect(apiKeyIsListed).toBe(true);
  });

  test("layout snapshot is workbench coordinates, not DOM client rects", () => {
    expect(BROWSER_SHELL_LAYOUT_COORDINATE_SPACE).toBe("workbench");
    expect(BROWSER_SHELL_LAYOUT_ORIGIN).toBe("workbenchTopLeft");
    expect(BROWSER_SHELL_LAYOUT_UNIT).toBe("cssPixel");
    const snapshotSpaceIsWorkbench = true as (
      WorkbenchBrowserLayoutSnapshot["coordinateSpace"] extends "workbench" ? true : false
    );
    const snapshotExposesDomRect = false as (
      "getBoundingClientRect" extends keyof WorkbenchBrowserLayoutSnapshot ? true : false
    );
    expect(snapshotSpaceIsWorkbench).toBe(true);
    expect(snapshotExposesDomRect).toBe(false);
    expect(toWorkbenchLayoutBounds({ left: 10.4, top: 20.6, width: 100.2, height: 40.8 })).toEqual({
      x: 10,
      y: 21,
      width: 100,
      height: 41
    });
  });

  test("shared shell types do not mention DOM measurement", () => {
    expect(readSource("browser-shell-api.ts")).not.toMatch(DOM_LAYOUT_PROTOCOL);
    expect(readSource("workbench-browser.ts")).not.toMatch(DOM_LAYOUT_PROTOCOL);
  });

  test("Electron adapter may still measure the renderer viewport", () => {
    const adapter = readSource("../modules/workbench/shell/browser-layout-sync.ts");
    expect(adapter).toMatch(/getBoundingClientRect/);
    expect(adapter).toMatch(/toWorkbenchLayoutBounds/);
    expect(adapter).toMatch(/BROWSER_SHELL_LAYOUT_COORDINATE_SPACE/);
  });
});
