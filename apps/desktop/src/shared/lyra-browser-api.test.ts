import { describe, expect, test } from "vitest";

import { isBrowserShellEvent } from "./browser-shell-api";
import { isLyraBrowserEvent } from "./lyra-browser-api";
import type { WorkbenchBrowserEvent } from "./workbench-browser";

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
