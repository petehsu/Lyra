import { describe, expect, test } from "vitest";

import {
  adaptBrowserAxMapToComputerMap,
  browserAxNodeToComputerNode,
  encodeLyraBrowserOsRef,
  parseLyraBrowserOsRef
} from "./computer-internal-surface";
import type { BrowserAxNode, WorkbenchBrowserAxMapResult } from "../workbench-browser/types";

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
});