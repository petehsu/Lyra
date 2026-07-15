import { describe, expect, test, vi } from "vitest";

import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import { createAxToolHost } from "../ax-tool-host";

const createHost = () => {
  const browser = {
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
