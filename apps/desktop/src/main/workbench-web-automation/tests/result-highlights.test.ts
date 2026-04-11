import { describe, expect, test } from "vitest";

import type { WorkbenchWebElementNode } from "../../../shared/workbench-web-automation";
import { buildGraphHighlights, rankNodesForAction } from "../result-highlights";

const makeNode = (overrides: Partial<WorkbenchWebElementNode>): WorkbenchWebElementNode => ({
  nodeId: "node-1",
  frameTreeNodeId: 1,
  tagName: "div",
  selectorAddress: {
    frameTreeNodeId: 1,
    path: "r"
  },
  stableSignature: {
    tagName: "div"
  },
  interactable: {
    clickable: false,
    typable: false,
    selectable: false,
    focusable: false,
    scrollable: false
  },
  visibilityState: "visible",
  bounds: {
    x: 0,
    y: 0,
    width: 1,
    height: 1
  },
  ...overrides
});

describe("workbench web graph highlights", () => {
  test("prefers visible textarea for typing", () => {
    const nodes: readonly WorkbenchWebElementNode[] = [
      makeNode({
        nodeId: "body",
        tagName: "body",
        interactable: {
          clickable: false,
          typable: false,
          selectable: false,
          focusable: true,
          scrollable: true
        }
      }),
      makeNode({
        nodeId: "input",
        tagName: "input",
        inputType: "text",
        interactable: {
          clickable: true,
          typable: true,
          selectable: false,
          focusable: true,
          scrollable: false
        },
        textSnippet: "Search"
      }),
      makeNode({
        nodeId: "textarea",
        tagName: "textarea",
        interactable: {
          clickable: true,
          typable: true,
          selectable: false,
          focusable: true,
          scrollable: false
        },
        textSnippet: "发送消息..."
      })
    ];

    const ranked = rankNodesForAction(nodes, "type", "");
    expect(ranked[0]?.nodeId).toBe("textarea");
  });

  test("builds highlights with typable and clickable candidates", () => {
    const nodes: readonly WorkbenchWebElementNode[] = [
      makeNode({
        nodeId: "textarea",
        tagName: "textarea",
        interactable: {
          clickable: true,
          typable: true,
          selectable: false,
          focusable: true,
          scrollable: false
        },
        textSnippet: "发送消息..."
      }),
      makeNode({
        nodeId: "send",
        tagName: "button",
        role: "button",
        interactable: {
          clickable: true,
          typable: false,
          selectable: false,
          focusable: true,
          scrollable: false
        },
        textSnippet: "发送"
      })
    ];

    const highlights = buildGraphHighlights(nodes);
    expect(highlights.typable[0]?.nodeId).toBe("textarea");
    expect(highlights.clickable[0]?.nodeId).toBe("send");
  });
});
