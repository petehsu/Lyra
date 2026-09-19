import { describe, expect, test } from "vitest";

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
    expect(result.surface).toBeUndefined();
  });

  test("rejects Lyra browser and terminal osRefs instead of routing them", async () => {
    const { handlers } = createComputerToolHost();
    const browser = await invoke(handlers, "lyraComputer.act", {
      osRef: encodeLyraBrowserOsRef("browser-tab-1", "ax:abc/0/1"),
      action: "press"
    });
    expect(browser).toMatchObject({
      ok: false,
      error: { kind: "wrongToolFamily" },
      nextRecommendedAction: "browser_ax.map"
    });
    const terminal = await invoke(handlers, "lyraComputer.act", {
      osRef: encodeLyraTerminalOsRef("terminal-session-1", "output-buffer"),
      action: "typeText",
      text: "echo ok"
    });
    expect(terminal).toMatchObject({
      ok: false,
      error: { kind: "wrongToolFamily" },
      nextRecommendedAction: "write_stdin"
    });
  });

  test("does not treat Lyra terminal snapshots as computer diffs", async () => {
    const { handlers } = createComputerToolHost();
    await expect(invoke(handlers, "lyraComputer.diff", {
      baselineSnapshotId: "lyt-read-terminal-session-1-12"
    })).resolves.toMatchObject({
      ok: false,
      error: { kind: "wrongToolFamily" },
      nextRecommendedAction: "write_stdin"
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

  test("listApps and observe stay on the native desktop, not workbench tabs", async () => {
    const { handlers } = createComputerToolHost();
    const listed = await invoke(handlers, "lyraComputer.listApps", {});
    expect(listed.lyraTabCount).toBeUndefined();
    expect(listed.ok === true || listed.error !== undefined).toBe(true);
    if (Array.isArray(listed.apps)) {
      expect(
        (listed.apps as Array<{ appRef?: string }>).every((app) =>
          typeof app.appRef !== "string" || !app.appRef.startsWith("lytab:")
        )
      ).toBe(true);
    }
    const observed = await invoke(handlers, "lyraComputer.observe", {});
    expect(observed.surface).not.toBe("lyra-browser");
    expect(observed.surface).not.toBe("lyra-terminal");
    expect(observed.surface).not.toBe("lyra-files");
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

  test("focus does not activate Lyra workbench tabs", async () => {
    const { handlers } = createComputerToolHost();
    const result = await invoke(handlers, "lyraComputer.focus", {
      lyraTabId: "browser-tab-1"
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "invalidArgument" }
    });
  });

  test("computer.see captures and materializes a screenshot artifact", async () => {
    const { handlers } = createComputerToolHost({
      visualFallback: {
        storageRoot: process.cwd(),
        captureScreen: async (scope) => ({
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
