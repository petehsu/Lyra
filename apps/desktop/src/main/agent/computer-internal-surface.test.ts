import { describe, expect, test } from "vitest";

import {
  adaptBrowserAxMapToComputerMap,
  adaptFileManagerObservationToComputerMap,
  browserAxNodeToComputerNode,
  encodeLyraBrowserOsRef,
  encodeLyraTerminalOsRef,
  parseLyraBrowserOsRef
} from "./computer-internal-surface";
import { adaptTerminalReadToComputerMap } from "./computer-terminal-surface";
import type { BrowserAxNode, WorkbenchBrowserAxMapResult } from "../workbench-browser/types";

const nodesOf = (envelope: Record<string, unknown>): Array<Record<string, unknown>> =>
  Array.isArray(envelope.nodes) ? (envelope.nodes as Array<Record<string, unknown>>) : [];

const sampleNode = (axRef: string): BrowserAxNode => ({
  axRef,
  role: "button",
  name: "Submit",
  state: { focused: false, disabled: false },
  actionCapabilities: ["click", "focus"],
  confidence: 1,
  source: "ax",
  axSource: "cdp",
  coordinateSpace: "webContentsCss"
});

describe("computer-internal-surface", () => {
  test("round-trips lyra browser osRefs", () => {
    const encoded = encodeLyraBrowserOsRef("browser-tab-1", "ax:abc/0/1");
    expect(encoded).toBe("lyb::browser-tab-1::ax:abc/0/1");
    expect(parseLyraBrowserOsRef(encoded)).toEqual({
      tabId: "browser-tab-1",
      axRef: "ax:abc/0/1"
    });
  });

  test("maps browser_ax nodes into computer tree nodes", () => {
    const node = browserAxNodeToComputerNode("browser-tab-1", sampleNode("ax:abc/0/1"));
    expect(node).toMatchObject({
      osRef: "lyb::browser-tab-1::ax:abc/0/1",
      app: "lyra-browser",
      window: "browser-tab-1",
      role: "button",
      name: "Submit",
      source: "internal-ipc",
      actions: ["press", "focus"]
    });
  });

  test("adapts browser_ax map envelopes", () => {
    const map: WorkbenchBrowserAxMapResult = {
      ok: true,
      kind: "browserAxMap",
      tabId: "browser-tab-1",
      targetMode: "live",
      snapshotId: "ax-snap-test",
      url: "https://example.com",
      title: "Example",
      strategy: "interactive",
      sources: ["cdp"],
      nodes: [sampleNode("ax:abc/0/1")]
    };
    const adapted = adaptBrowserAxMapToComputerMap(map);
    expect(adapted).toMatchObject({
      ok: true,
      surface: "lyra-browser",
      capabilityLevel: 1,
      snapshotId: "ax-snap-test",
      status: {
        state: "available",
        nodeCount: 1,
        url: "https://example.com"
      }
    });
    expect(adapted.nodes).toHaveLength(1);
  });

  test("adapts terminal.read output into a compatibility node", () => {
    const adapted = adaptTerminalReadToComputerMap("terminal-tab-1", {
      sessionId: "session-1",
      output: "ready",
      cursor: "5",
      running: true
    });
    expect(adapted).toMatchObject({
      ok: true,
      surface: "lyra-terminal",
      capabilityLevel: 1,
      status: {
        state: "available",
        nodeCount: 1,
        sessionId: "session-1"
      }
    });
    expect(adapted).not.toHaveProperty("snapshotId");
    expect(nodesOf(adapted)[0]).toMatchObject({
      osRef: encodeLyraTerminalOsRef("session-1", "output-buffer"),
      role: "terminal",
      value: "ready",
      actions: ["typeText", "pressKey"]
    });
  });

  test("adapts file manager observations", () => {
    const adapted = adaptFileManagerObservationToComputerMap("files-tab-1", {
      kind: "file-manager",
      viewKind: "directory",
      currentLocation: { title: "Documents", path: "/Users/test/Documents" },
      entries: [{ id: "entry-1", name: "readme.md", kind: "file", path: "/Users/test/Documents/readme.md" }]
    });
    expect(adapted.surface).toBe("lyra-files");
    expect(adapted.nodes).toHaveLength(2);
  });
});
