import { describe, expect, test } from "vitest";

import { readComputerSurfaceRoute, resolveInternalSurface } from "./computer-surface-resolver";

describe("computer-surface-resolver", () => {
  test("reads explicit surface routes", () => {
    expect(readComputerSurfaceRoute({ surface: "lyra-terminal" })).toBe("lyra-terminal");
    expect(readComputerSurfaceRoute({ surface: "native" })).toBe("native");
  });

  test("auto-routes to terminal when the active tab is terminal", async () => {
    const resolved = await resolveInternalSurface({
      payload: {},
      route: "auto",
      tabResolver: {
        resolveBrowserAgentTabId: async () => {
          throw new Error("should not resolve browser");
        },
        readWorkbenchTabWithSummaryFallback: async () => ({}),
        describeWorkbenchTabKind: () => "terminal"
      },
      listTabs: async () => ({
        activeTabId: "terminal-tab-1",
        visibleTabIds: ["terminal-tab-1"],
        tabs: [
          {
            tabId: "terminal-tab-1",
            title: "Terminal",
            pageKind: "terminal",
            observationKind: "terminal",
            active: true,
            visible: true,
            focusedPane: true,
            observable: true
          }
        ]
      })
    });
    expect(resolved).toEqual({ kind: "lyra-terminal", tabId: "terminal-tab-1" });
  });
});