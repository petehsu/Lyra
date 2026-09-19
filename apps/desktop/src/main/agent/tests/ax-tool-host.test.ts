import { describe, expect, test, vi } from "vitest";

import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import { createAxToolHost } from "../ax-tool-host";

const createHost = () => {
  const browser = {
    axMapAgentPage: vi.fn(async () => ({
      ok: true,
      kind: "browserAxSnapshot",
      tabId: "browser-tab-1",
      snapshotId: "snap-1"
    })),
    axQueryAgentSnapshot: vi.fn(async () => ({
      ok: true,
      kind: "browserAxQueryResult",
      tabId: "browser-tab-1",
      matches: [{ axRef: "ax:snap:btn", role: "button", name: "Continue" }]
    })),
    axPressAgentKey: vi.fn(async () => ({
      ok: true,
      kind: "browserAxPressResult",
      tabId: "browser-tab-1",
      key: "Enter"
    })),
    axActOnNode: vi.fn(async () => ({
      ok: true,
      kind: "browserAxActionResult",
      tabId: "browser-tab-1",
      targetMode: "live",
      axRef: "ax:snapshot:node",
      interaction: "click",
      pageChanged: false,
      navigationStarted: false
    }))
  } as unknown as WorkbenchBrowserIpcBridge;
  const host = createAxToolHost({
    getBrowserBridge: () => browser,
    tabResolver: {
      resolveBrowserAgentTabId: vi.fn(async () => "browser-tab-1"),
      readWorkbenchTabWithSummaryFallback: vi.fn(async () => ({})),
      describeWorkbenchTabKind: vi.fn(() => "browser")
    },
    getBrowserFollowMode: () => false
  });
  return { browser, host };
};

describe("AX tool host authorization", () => {
  test("ignores model-supplied authorized=true", async () => {
    const { browser, host } = createHost();

    await host.handlers["lyraAx.act"]?.({
      tabId: "browser-tab-1",
      targetMode: "live",
      axRef: "ax:snapshot:node",
      effect: "editDraft",
      authorized: true
    });

    expect(browser.axActOnNode).toHaveBeenCalledWith("browser-tab-1", {
      axRef: "ax:snapshot:node",
      interaction: "click",
      effect: "editDraft",
      verification: "fast",
      targetMode: "live"
    });
  });

  test("consumes a runtime-injected AX authorization once", async () => {
    const { browser, host } = createHost();
    const payload = {
      tabId: "browser-tab-1",
      targetMode: "live",
      axRef: "ax:snapshot:node",
      effect: "authorize",
      runtimeCancellation: {
        sessionId: "agent-1",
        turnId: "turn-1",
        toolCallId: "tool-1"
      },
      axAuthorization: {
        kind: "lyra_ax_one_time",
        action: "act",
        axRef: "ax:snapshot:node",
        tabId: "browser-tab-1",
        targetMode: "live",
        toolCallId: "tool-1",
        permissionRequestId: "permission-1",
        expiresAt: Date.now() + 60_000
      }
    };

    await host.handlers["lyraAx.act"]?.(payload);
    expect(browser.axActOnNode).toHaveBeenLastCalledWith("browser-tab-1", {
      axRef: "ax:snapshot:node",
      interaction: "click",
      effect: "authorize",
      verification: "fast",
      targetMode: "live",
      authorized: true
    });

    const second = await host.handlers["lyraAx.act"]?.(payload);
    expect(second).toMatchObject({
      ok: false,
      error: { kind: "invalidAxAuthorization" }
    });
    expect(browser.axActOnNode).toHaveBeenCalledTimes(1);
  });
});

describe("AX tool host folded query and press", () => {
  test("map with role filters through snapshot query", async () => {
    const { browser, host } = createHost();
    await host.handlers["lyraAx.map"]?.({
      tabId: "browser-tab-1",
      role: "button",
      nameIncludes: "Continue"
    });
    expect(browser.axMapAgentPage).toHaveBeenCalled();
    expect(browser.axQueryAgentSnapshot).toHaveBeenCalledWith("browser-tab-1", {
      targetMode: "live",
      snapshotId: "snap-1",
      role: "button",
      nameIncludes: "Continue"
    });
  });

  test("act with key presses instead of clicking", async () => {
    const { browser, host } = createHost();
    await host.handlers["lyraAx.act"]?.({
      tabId: "browser-tab-1",
      axRef: "ax:snapshot:node",
      key: "Enter",
      effect: "submitExternal"
    });
    expect(browser.axPressAgentKey).toHaveBeenCalledWith("browser-tab-1", {
      key: "Enter",
      effect: "submitExternal",
      targetMode: "live",
      axRef: "ax:snapshot:node"
    });
    expect(browser.axActOnNode).not.toHaveBeenCalled();
  });
});
