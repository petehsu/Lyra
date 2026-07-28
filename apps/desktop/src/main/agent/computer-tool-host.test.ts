import { describe, expect, test, vi } from "vitest";

import { createComputerToolHost } from "./computer-tool-host";
import {
  encodeLyraBrowserOsRef,
  encodeLyraTerminalOsRef
} from "./computer-internal-surface";
import type { AgentHostCapabilityHandlers } from "./host-payload";

/** Invoke a handler by key, asserting it is registered and returns an object. */
const invoke = async (
  handlers: AgentHostCapabilityHandlers,
  key: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const handler = handlers[key];
  expect(handler, `handler ${key} should be registered`).toBeDefined();
  const result = await handler!(payload);
  expect(result, `handler ${key} should return an object`).toBeTypeOf("object");
  return result as Record<string, unknown>;
};

describe("computer-tool-host", () => {
  test("rejects unknown computer actions before native invocation", async () => {
    const { handlers } = createComputerToolHost();
    const result = await invoke(handlers, "lyraComputer.act", {
      osRef: "osax:0/1",
      action: "launchMissiles"
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "unsupportedAction" }
    });
  });

  test("map returns a structured native envelope", async () => {
    const { handlers } = createComputerToolHost();
    const result = await invoke(handlers, "lyraComputer.map", { strategy: "interactive" });
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
          layout: {
            layoutMode: "single",
            splitGroupTabIds: [],
            focusedSplitTabId: null
          },
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
    const result = await invoke(handlers, "lyraComputer.map", { surface: "lyra-browser" });
    expect(result).toMatchObject({
      ok: true,
      surface: "lyra-browser",
      capabilityLevel: 1,
      snapshotId: "ax-snap-test"
    });
    const nodes = Array.isArray(result.nodes) ? (result.nodes as Array<Record<string, unknown>>) : [];
    expect(nodes[0]?.osRef).toBe(encodeLyraBrowserOsRef("browser-tab-1", "ax:abc/0/1"));
  });

  test("routes Lyra terminal map and supported actions through terminal.read/write", async () => {
    const terminalRead = vi.fn(async () => ({
      target: { type: "ui", title: "UI Terminal" },
      sessionId: "terminal-session-1",
      cursor: "12",
      output: "$ ready",
      running: true,
      exitCode: null,
      truncated: false
    }));
    const terminalWrite = vi.fn(async () => ({
      sessionId: "terminal-session-1",
      cursor: "14",
      output: "ok",
      running: true,
      exitCode: null
    }));
    const { handlers } = createComputerToolHost({
      internalSurfaces: {
        tabResolver: {
          resolveBrowserAgentTabId: async () => {
            throw new Error("browser should not be used");
          },
          readWorkbenchTabWithSummaryFallback: async () => {
            throw new Error("file-manager observation should not be used");
          },
          describeWorkbenchTabKind: () => "terminal"
        },
        axHandlers: {},
        terminalHandlers: {
          "terminal.read": terminalRead,
          "terminal.write": terminalWrite
        },
        listWorkbenchTabs: async () => ({
          activeTabId: "terminal-tab-1",
          visibleTabIds: ["terminal-tab-1"],
          layout: {
            layoutMode: "single",
            splitGroupTabIds: [],
            focusedSplitTabId: null
          },
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
      }
    });

    const mapped = await invoke(handlers, "lyraComputer.map", {
      surface: "lyra-terminal"
    });
    const nodes = Array.isArray(mapped.nodes)
      ? (mapped.nodes as Array<Record<string, unknown>>)
      : [];
    const osRef = encodeLyraTerminalOsRef("terminal-session-1", "output-buffer");
    expect(mapped).toMatchObject({
      ok: true,
      surface: "lyra-terminal",
      capabilityLevel: 1
    });
    expect(mapped).not.toHaveProperty("snapshotId");
    expect(nodes[0]).toMatchObject({
      osRef,
      role: "terminal",
      value: "$ ready",
      actions: ["typeText", "pressKey"]
    });
    expect(terminalRead).toHaveBeenCalledWith(expect.objectContaining({
      target: "ui",
      terminalTabId: "terminal-tab-1",
      tailBytes: 16_000
    }));

    await expect(invoke(handlers, "lyraComputer.act", {
      osRef,
      action: "typeText",
      text: "echo ok"
    })).resolves.toMatchObject({
      ok: true,
      surface: "lyra-terminal",
      action: "typeText",
      afterObservationId: "14"
    });
    expect(terminalWrite).toHaveBeenCalledWith(expect.objectContaining({
      target: "ui",
      sessionId: "terminal-session-1",
      text: "echo ok",
      appendNewline: false
    }));

    await expect(invoke(handlers, "lyraComputer.diff", { osRef })).resolves.toMatchObject({
      ok: true,
      surface: "lyra-terminal",
      present: true,
      osRef
    });

    const staleResult = await invoke(handlers, "lyraComputer.act", {
      osRef: encodeLyraTerminalOsRef("terminal-session-1", "removed-region"),
      action: "press"
    });
    expect(staleResult).toMatchObject({
      ok: false,
      surface: "lyra-terminal",
      present: false,
      error: { kind: "staleOsRef" },
      nextRecommendedAction: "computer.map"
    });
    expect(terminalWrite).toHaveBeenCalledTimes(1);

    await expect(invoke(handlers, "lyraComputer.diff", {
      osRef: encodeLyraTerminalOsRef("terminal-session-1", "removed-region")
    })).resolves.toMatchObject({
      ok: false,
      surface: "lyra-terminal",
      present: false,
      error: { kind: "staleOsRef" },
      nextRecommendedAction: "computer.map"
    });

    await expect(invoke(handlers, "lyraComputer.explain", { osRef })).resolves.toMatchObject({
      ok: true,
      surface: "lyra-terminal",
      semanticControlAvailable: true,
      nextRecommendedAction: "write_stdin"
    });
    await expect(invoke(handlers, "lyraComputer.explain", {
      osRef: encodeLyraTerminalOsRef("terminal-session-1", "removed-region")
    })).resolves.toMatchObject({
      ok: false,
      surface: "lyra-terminal",
      present: false,
      semanticControlAvailable: false,
      error: { kind: "staleOsRef" },
      nextRecommendedAction: "computer.map"
    });
  });

  test("returns structured stale terminal results instead of rejecting", async () => {
    const terminalRead = vi.fn(async () => {
      throw new Error("session not found");
    });
    const terminalWrite = vi.fn(async () => {
      throw new Error("session not found");
    });
    const { handlers } = createComputerToolHost({
      internalSurfaces: {
        tabResolver: {
          resolveBrowserAgentTabId: async () => "unused",
          readWorkbenchTabWithSummaryFallback: async () => ({}),
          describeWorkbenchTabKind: () => "terminal"
        },
        axHandlers: {},
        terminalHandlers: {
          "terminal.read": terminalRead,
          "terminal.write": terminalWrite
        },
        listWorkbenchTabs: async () => ({
          activeTabId: "terminal-tab-1",
          visibleTabIds: ["terminal-tab-1"],
          layout: {
            layoutMode: "single",
            splitGroupTabIds: [],
            focusedSplitTabId: null
          },
          tabs: [{
            tabId: "terminal-tab-1",
            title: "Terminal",
            pageKind: "terminal",
            observationKind: "terminal",
            active: true,
            visible: true,
            focusedPane: true,
            observable: true
          }]
        })
      }
    });
    const osRef = encodeLyraTerminalOsRef("gone-session", "output-buffer");

    for (const [method, payload] of [
      ["lyraComputer.diff", { osRef }],
      ["lyraComputer.explain", { osRef }],
      ["lyraComputer.act", { osRef, action: "typeText", text: "x" }]
    ] as const) {
      await expect(invoke(handlers, method, payload)).resolves.toMatchObject({
        ok: false,
        present: false,
        osRef,
        error: { kind: "staleOsRef" },
        nextRecommendedAction: "computer.map"
      });
    }

    terminalRead.mockRejectedValueOnce(new Error("terminal bridge offline"));
    await expect(invoke(handlers, "lyraComputer.map", {
      surface: "lyra-terminal"
    })).resolves.toMatchObject({
      ok: false,
      present: false,
      error: { kind: "internalSurfaceUnavailable" },
      nextRecommendedAction: "computer.map"
    });
  });

  test("does not pass removed terminal snapshot ids to native diff", async () => {
    const { handlers } = createComputerToolHost();
    await expect(invoke(handlers, "lyraComputer.diff", {
      baselineSnapshotId: "lyt-read-terminal-session-1-12"
    })).resolves.toMatchObject({
      ok: false,
      surface: "lyra-terminal",
      error: { kind: "unsupportedSnapshot" },
      nextRecommendedAction: "computer.map"
    });
  });

  test("requires a valid sensitiveValueRef for credential autofill", async () => {
    const { handlers } = createComputerToolHost({
      resolveSensitiveValueForFill: async () => "secret"
    });
    const result = await invoke(handlers, "lyraComputer.act", {
      osRef: "osax:0/2",
      sensitiveValueRef: { not: "a-ref" }
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "invalidArgument" }
    });
  });

  test("computer.see reports unavailable when no visual fallback is configured", async () => {
    const { handlers } = createComputerToolHost();
    const result = await invoke(handlers, "lyraComputer.see", { scope: "screen" });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "visualFallbackUnavailable" }
    });
  });

  test("listApps merges Lyra workbench tabs into native apps", async () => {
    const { handlers } = createComputerToolHost({
      internalSurfaces: {
        tabResolver: {
          resolveBrowserAgentTabId: async () => "browser-tab-1",
          readWorkbenchTabWithSummaryFallback: async () => ({}),
          describeWorkbenchTabKind: () => "page"
        },
        terminalHandlers: {},
        axHandlers: {},
        listWorkbenchTabs: async () => ({
          activeTabId: "browser-tab-1",
          visibleTabIds: ["browser-tab-1"],
          layout: {
            layoutMode: "single",
            splitGroupTabIds: [],
            focusedSplitTabId: null
          },
          tabs: [
            {
              tabId: "browser-tab-1",
              title: "Example",
              pageKind: "page",
              active: true,
              visible: true,
              focusedPane: true,
              observable: true,
              observationKind: "page"
            }
          ]
        })
      }
    });
    const result = await invoke(handlers, "lyraComputer.listApps", {});
    expect(result.ok === true || result.error !== undefined).toBe(true);
    if (result.ok === true) {
      expect(result.lyraTabCount).toBe(1);
      expect(Array.isArray(result.apps)).toBe(true);
      expect((result.apps as Array<{ appRef: string }>)[0]?.appRef).toBe("lytab:browser-tab-1");
    }
  });

  test("observe reports the active Lyra workbench tab at Level 1", async () => {
    const { handlers } = createComputerToolHost({
      internalSurfaces: {
        tabResolver: {
          resolveBrowserAgentTabId: async () => "browser-tab-1",
          readWorkbenchTabWithSummaryFallback: async () => ({}),
          describeWorkbenchTabKind: () => "page"
        },
        terminalHandlers: {},
        axHandlers: {},
        listWorkbenchTabs: async () => ({
          activeTabId: "browser-tab-1",
          visibleTabIds: ["browser-tab-1"],
          layout: {
            layoutMode: "single",
            splitGroupTabIds: [],
            focusedSplitTabId: null
          },
          tabs: [
            {
              tabId: "browser-tab-1",
              title: "Example",
              pageKind: "page",
              active: true,
              visible: true,
              focusedPane: true,
              observable: true,
              observationKind: "page"
            }
          ]
        })
      }
    });
    const result = await invoke(handlers, "lyraComputer.observe", {});
    expect(result).toMatchObject({
      ok: true,
      capabilityLevel: 1,
      surface: "lyra-browser",
      foregroundApp: { appRef: "lytab:browser-tab-1", name: "Example" }
    });
  });

  test("focus refuses foreground steal in background mode", async () => {
    const { handlers } = createComputerToolHost();
    const result = await invoke(handlers, "lyraComputer.focus", {
      appRef: "osxapp:42",
      mode: "background-semantic"
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "foregroundStealBlocked" }
    });
  });

  test("focus routes Lyra tab activation through workbench", async () => {
    const activateWorkbenchTab = vi.fn(async () => ({ activated: true }));
    const { handlers } = createComputerToolHost({
      internalSurfaces: {
        tabResolver: {
          resolveBrowserAgentTabId: async () => "browser-tab-1",
          readWorkbenchTabWithSummaryFallback: async () => ({}),
          describeWorkbenchTabKind: () => "page"
        },
        terminalHandlers: {},
        axHandlers: {},
        listWorkbenchTabs: async () => ({
          activeTabId: "browser-tab-1",
          visibleTabIds: ["browser-tab-1"],
          layout: {
            layoutMode: "single",
            splitGroupTabIds: [],
            focusedSplitTabId: null
          },
          tabs: []
        }),
        activateWorkbenchTab
      }
    });
    const result = await invoke(handlers, "lyraComputer.focus", {
      lyraTabId: "browser-tab-1"
    });
    expect(activateWorkbenchTab).toHaveBeenCalledWith("browser-tab-1");
    expect(result).toMatchObject({ ok: true, lyraTabId: "browser-tab-1" });
  });

  test("computer.see captures and materializes a screenshot artifact", async () => {
    const { handlers } = createComputerToolHost({
      visualFallback: {
        storageRoot: process.cwd(),
        captureScreen: async (scope) => ({
          // 1x1 transparent PNG.
          imageBase64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          mimeType: "image/png",
          width: scope === "screen" ? 1920 : 800,
          height: 600
        })
      }
    });
    const result = await invoke(handlers, "lyraComputer.see", { scope: "focused-window" });
    expect(result).toMatchObject({
      ok: true,
      kind: "computerSee",
      scope: "focused-window",
      capabilityLevel: 3,
      fallback: "vision",
      width: 800
    });
    expect(Array.isArray(result.evidenceRefs)).toBe(true);
  });
});
