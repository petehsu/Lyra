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