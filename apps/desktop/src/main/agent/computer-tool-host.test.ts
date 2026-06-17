import { describe, expect, test } from "vitest";

import { createComputerToolHost } from "./computer-tool-host";
import { encodeLyraBrowserOsRef } from "./computer-internal-surface";

describe("computer-tool-host", () => {
  test("rejects unknown computer actions before native invocation", async () => {
    const { handlers } = createComputerToolHost();
    const result = await handlers["lyraComputer.act"]({
      osRef: "osax:0/1",
      action: "drag"
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "unsupportedAction" }
    });
  });

  test("map returns a structured native envelope", async () => {
    const { handlers } = createComputerToolHost();
    const result = await handlers["lyraComputer.map"]({ strategy: "interactive" });
    expect(typeof result.platform).toBe("string");
    expect(result.ok === true || result.error !== undefined).toBe(true);
  });

  test("routes lyra-browser surface map through browser_ax", async () => {
    const { handlers } = createComputerToolHost({
      internalSurfaces: {
        tabResolver: {
          resolveBrowserAgentTabId: async () => "browser-tab-1",
          readWorkbenchTabWithSummaryFallback: async () => ({}),
          describeWorkbenchTabKind: () => "page"
        },
        terminalHandlers: {},
        listWorkbenchTabs: async () => ({
          activeTabId: "browser-tab-1",
          visibleTabIds: ["browser-tab-1"],
          tabs: []
        }),
        axHandlers: {
          "lyraAx.map": async () => ({
            ok: true,
            kind: "browserAxMap",
            tabId: "browser-tab-1",
            targetMode: "live",
            snapshotId: "ax-snap-test",
            url: "https://example.com",
            title: "Example",
            strategy: "interactive",
            sources: ["cdp"],
            nodes: [
              {
                axRef: "ax:abc/0/1",
                role: "button",
                name: "Go",
                state: {},
                actionCapabilities: ["click"],
                confidence: 1,
                source: "ax",
                axSource: "cdp",
                coordinateSpace: "webContentsCss"
              }
            ]
          })
        }
      }
    });
    const result = await handlers["lyraComputer.map"]({ surface: "lyra-browser" });
    expect(result).toMatchObject({
      ok: true,
      surface: "lyra-browser",
      capabilityLevel: 1,
      snapshotId: "ax-snap-test"
    });
    expect(result.nodes?.[0]?.osRef).toBe(encodeLyraBrowserOsRef("browser-tab-1", "ax:abc/0/1"));
  });

  test("routes lyra-terminal surface map through terminal.map.read", async () => {
    const { handlers } = createComputerToolHost({
      internalSurfaces: {
        tabResolver: {
          resolveBrowserAgentTabId: async () => {
            throw new Error("browser should not be used");
          },
          readWorkbenchTabWithSummaryFallback: async () => ({}),
          describeWorkbenchTabKind: () => "terminal"
        },
        listWorkbenchTabs: async () => ({
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
        }),
        axHandlers: {},
        terminalHandlers: {
          "terminal.map.read": async () => ({
            sessionId: "session-1",
            screen: { screenVersion: 2 },
            regions: [
              {
                regionId: "region-1",
                kind: "button",
                text: "Yes",
                rowStart: 1,
                rowEnd: 1,
                colStart: 1,
                colEnd: 3,
                confidence: 1,
                suggestedActions: ["confirm"]
              }
            ]
          })
        }
      }
    });
    const result = await handlers["lyraComputer.map"]({ surface: "lyra-terminal" });
    expect(result).toMatchObject({
      ok: true,
      surface: "lyra-terminal",
      capabilityLevel: 1
    });
    expect(result.nodes).toHaveLength(1);
  });

  test("requires a valid sensitiveValueRef for credential autofill", async () => {
    const { handlers } = createComputerToolHost({
      resolveSensitiveValueForFill: async () => "secret"
    });
    const result = await handlers["lyraComputer.act"]({
      osRef: "osax:0/2",
      sensitiveValueRef: { not: "a-ref" }
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "invalidArgument" }
    });
  });
});