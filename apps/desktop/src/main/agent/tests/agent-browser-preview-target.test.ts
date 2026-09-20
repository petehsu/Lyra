import { afterEach, describe, expect, test } from "vitest";

import {
  allocateLiveAgentBrowserPreviewTabId,
  clearAgentBrowserPreviewTarget,
  dismissAgentBrowserPreviewTargets,
  promoteAgentBrowserPreviewTarget,
  readAgentBrowserPreviewTarget,
  readAgentBrowserPreviewTargets,
  rememberAgentBrowserPreviewTarget,
  resetAgentBrowserPreviewTargetForTests
} from "../agent-browser-preview-target";

describe("agent browser preview target", () => {
  afterEach(() => {
    resetAgentBrowserPreviewTargetForTests();
  });

  test("upserts by tabId with the most recent first and caps the stack", () => {
    expect(readAgentBrowserPreviewTarget()).toBeNull();
    expect(readAgentBrowserPreviewTargets()).toEqual([]);

    rememberAgentBrowserPreviewTarget({ tabId: "tab-1", targetMode: "isolated" });
    rememberAgentBrowserPreviewTarget({ tabId: "tab-2", targetMode: "live" });
    rememberAgentBrowserPreviewTarget({ tabId: "tab-1", targetMode: "live" });
    rememberAgentBrowserPreviewTarget({ tabId: "", targetMode: "live" });
    expect(readAgentBrowserPreviewTargets()).toEqual([
      { tabId: "tab-1", targetMode: "live" },
      { tabId: "tab-2", targetMode: "live" }
    ]);
    expect(readAgentBrowserPreviewTarget()).toEqual({
      tabId: "tab-1",
      targetMode: "live"
    });

    rememberAgentBrowserPreviewTarget({ tabId: "tab-3", targetMode: "live" });
    rememberAgentBrowserPreviewTarget({ tabId: "tab-4", targetMode: "isolated" });
    rememberAgentBrowserPreviewTarget({ tabId: "tab-5", targetMode: "live" });
    expect(readAgentBrowserPreviewTargets().map((item) => item.tabId)).toEqual([
      "tab-5",
      "tab-4",
      "tab-3",
      "tab-1"
    ]);

    promoteAgentBrowserPreviewTarget("tab-3");
    expect(readAgentBrowserPreviewTargets()[0]?.tabId).toBe("tab-3");

    expect(dismissAgentBrowserPreviewTargets("tab-3").map((item) => item.tabId)).toEqual(["tab-3"]);
    expect(readAgentBrowserPreviewTargets().map((item) => item.tabId)).toEqual([
      "tab-5",
      "tab-4",
      "tab-1"
    ]);

    const allocated = allocateLiveAgentBrowserPreviewTabId();
    expect(allocated.startsWith("browser-agent-")).toBe(true);
    expect(allocated).not.toBe(allocateLiveAgentBrowserPreviewTabId());

    clearAgentBrowserPreviewTarget();
    expect(readAgentBrowserPreviewTargets()).toEqual([]);
    expect(readAgentBrowserPreviewTarget()).toBeNull();
  });
});
