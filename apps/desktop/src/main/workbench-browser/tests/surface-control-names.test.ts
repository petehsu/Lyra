import { describe, expect, test, vi } from "vitest";

import type { WorkbenchBrowserAgentElement } from "../types";
import { reuseSurfaceTargetRefs } from "../view-manager-runtime/agent-affordance-lists";
import {
  axNameOverlappingBounds,
  cursorApproachPoints,
  fillBlankSurfaceLabels,
  isBlankSurfaceLabel,
  refreshStampedElement
} from "../view-manager-runtime/surface-control-names";

const element = (id: number, label: string, x: number): WorkbenchBrowserAgentElement => ({
  id,
  label,
  bounds: { x, y: 10, width: 20, height: 20 },
  targetRef: `ref-${id}`,
  stableId: `stable-${id}`,
  target: { targetRef: `ref-${id}` },
  frameRef: "frame",
  elementFingerprint: "fp",
  frameTreeNodeId: 1,
  tagName: "button",
  role: "button",
  selectorPreview: "button",
  focusable: true,
  disabled: false,
  editable: false
} as WorkbenchBrowserAgentElement);

describe("surface control names", () => {
  test("treats an empty map label as blank", () => {
    expect(isBlankSurfaceLabel("(no label)")).toBe(true);
    expect(isBlankSurfaceLabel("Open sidebar")).toBe(false);
  });

  test("uses the accessibility name that covers the control", () => {
    const name = axNameOverlappingBounds(
      [{ name: "New chat", bounds: { x: 40, y: 10, width: 28, height: 28 } }],
      { x: 44, y: 12, width: 20, height: 20 }
    );
    expect(name).toBe("New chat");
  });

  test("does not copy a conversation title onto a small icon inside that row", () => {
    const name = axNameOverlappingBounds(
      [{ name: "Conversation title", bounds: { x: 12, y: 80, width: 236, height: 40 } }],
      { x: 210, y: 92, width: 16, height: 16 }
    );
    expect(name).toBeNull();
  });

  test("writes an accessibility name onto a blank control and leaves labeled ones alone", async () => {
    const openDebugger = vi.fn(async () => ({
      close: async () => undefined,
      sendCommand: vi.fn(async (method: string) => {
        if (method === "DOM.getNodeForLocation") {
          return { backendNodeId: 7 };
        }
        if (method === "Accessibility.getPartialAXTree") {
          return {
            nodes: [{
              role: { value: "button" },
              name: { value: "Open sidebar" },
              backendDOMNodeId: 7
            }]
          };
        }
        return {};
      })
    }));
    const filled = await fillBlankSurfaceLabels(
      [element(1, "Save", 0), element(2, "(no label)", 40)],
      { openDebugger }
    );
    expect(filled.map((item) => item.label)).toEqual(["Save", "Open sidebar"]);
  });

  test("names a small dialog button ahead of larger blank regions", async () => {
    const queried: number[] = [];
    const openDebugger = vi.fn(async () => ({
      close: async () => undefined,
      sendCommand: vi.fn(async (method: string, params?: { x?: number }) => {
        if (method === "DOM.getNodeForLocation") {
          queried.push(params?.x ?? -1);
          return { backendNodeId: params?.x === 40 ? 7 : 1 };
        }
        if (method === "Accessibility.getPartialAXTree") {
          return {
            nodes: [{
              nodeId: "target", backendDOMNodeId: 7,
              role: { value: "button" },
              name: { value: "Delete chat" }
            }]
          };
        }
        return {};
      })
    }));
    const giants = Array.from({ length: 12 }, (_, index) => ({
      ...element(10 + index, "(no label)", 200),
      bounds: { x: 200, y: 10, width: 400, height: 200 }
    }));
    const dialog = element(2, "(no label)", 30);
    const filled = await fillBlankSurfaceLabels(
      [...giants, dialog],
      { openDebugger }
    );
    expect(filled.find((item) => item.id === 2)?.label).toBe("Delete chat");
    expect(queried[0]).toBe(40);
  });

  test("does not borrow a parent or sibling action's name for an unnamed button", async () => {
    const filled = await fillBlankSurfaceLabels([element(1, "(no label)", 40)], {
      openDebugger: async () => ({ close: async () => undefined, sendCommand: async method => method === "DOM.getNodeForLocation"
        ? { backendNodeId: 7 }
        : { nodes: [
          { nodeId: "child", backendDOMNodeId: 7, role: { value: "image" }, parentId: "owner" },
          { nodeId: "owner", backendDOMNodeId: 8, role: { value: "button" }, name: { value: "" }, parentId: "row" },
          { nodeId: "row", role: { value: "link" }, name: { value: "Conversation" } },
          { nodeId: "sibling", role: { value: "button" }, name: { value: "Delete" } }
        ] }
      })
    });
    expect(filled[0]?.label).toBe("(no label)");
  });

  test("does not exclude a row-edge button from reading its own AX name", async () => {
    const row = { ...element(1, "Conversation", 0), role: "link", tagName: "a", bounds: { x: 0, y: 0, width: 240, height: 40 } };
    const button = { ...element(2, "(no label)", 210), ancestorTargetRefs: [row.targetRef] };
    const filled = await fillBlankSurfaceLabels([row, button], {
      openDebugger: async () => ({ close: async () => {}, sendCommand: async method => method === "DOM.getNodeForLocation"
        ? { backendNodeId: 7 } : { nodes: [{ nodeId: "menu", backendDOMNodeId: 7, role: { value: "button" }, name: { value: "More actions" } }] }
      })
    });
    expect(filled[1]?.label).toBe("More actions");
    expect(filled[0]?.label).toBe("Conversation");
  });

  test("keeps the same targetRef when a control only moves", () => {
    const prior = element(1, "Send", 40);
    const moved = {
      ...element(4, "Send", 40),
      bounds: { x: 40, y: 400, width: 20, height: 20 },
      targetRef: "lumen:new",
      stableId: "new",
      elementFingerprint: "new"
    };
    const reused = reuseSurfaceTargetRefs([prior], [moved]);
    expect(reused?.[0]?.targetRef).toBe(prior.targetRef);
    expect(reused?.[0]?.bounds.y).toBe(400);
    expect(reuseSurfaceTargetRefs([prior], [{ ...moved, label: "Stop" }])).toBeNull();
  });

  test("uses the live box stamped on the element", async () => {
    const located = await refreshStampedElement(element(1, "Send", 10), async () => ({
      x: 12,
      y: 480,
      width: 28,
      height: 28
    }));
    expect(located.bounds).toEqual({ x: 12, y: 480, width: 28, height: 28 });
  });

  test("draws the cursor from the last place to the element", () => {
    expect(cursorApproachPoints({ x: 0, y: 0 }, { x: 40, y: 80 }, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 40 },
      { x: 30, y: 60 },
      { x: 40, y: 80 }
    ]);
  });
});
