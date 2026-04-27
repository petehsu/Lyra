import { describe, expect, test } from "vitest";

import type { SearchDeepSnapshot } from "../../../../shared/desktop-bridge";
import {
  buildDeepSearchCanvasEdges,
  resolveEdgeSide,
  resolveOppositeEdgeSide
} from "../deep-search-canvas-model";
import type { DeepSearchCanvasNode } from "../deep-search-node-renderers";

const createNode = (
  id: string,
  x: number,
  y: number
): DeepSearchCanvasNode => ({
  id,
  type: "deepSearchNode",
  position: { x, y },
  width: 100,
  height: 80,
  data: {
    kind: "web_page",
    title: id,
    status: "ready"
  }
} as DeepSearchCanvasNode);

const snapshot: SearchDeepSnapshot = {
  query: "lyra",
  budgetPreset: "medium",
  phase: "completed",
  nodes: [],
  edges: [
    { id: "primary", sourceId: "left", targetId: "right", kind: "discovered_from" },
    { id: "related", sourceId: "left", targetId: "bottom", kind: "related_to" }
  ],
  web: {
    status: "ready",
    engineBuckets: [],
    blendedCount: 0
  },
  local: {
    status: "ready",
    scopePreset: "home",
    roots: [],
    elapsedMs: 0,
    stats: {
      scannedFiles: 0,
      scannedDirs: 0,
      contentScannedFiles: 0,
      matchedFiles: 0,
      skippedUnreadable: 0,
      skippedBinaryOrTooLarge: 0,
      usedIndex: false
    }
  },
  stats: {
    dedupedResults: 0,
    derivedQueries: 0,
    expansionRounds: 0
  },
  lastUpdatedAt: "2026-04-27T00:00:00.000Z"
};

describe("deep search canvas model", () => {
  test("resolves edge handle sides", () => {
    expect(resolveEdgeSide(100, 10)).toBe("east");
    expect(resolveEdgeSide(-100, 10)).toBe("west");
    expect(resolveEdgeSide(10, -100)).toBe("north");
    expect(resolveOppositeEdgeSide("east")).toBe("west");
  });

  test("builds primary edges and reveals related edges only near the selected node", () => {
    const nodes = [
      createNode("left", 0, 0),
      createNode("right", 240, 0),
      createNode("bottom", 0, 220)
    ];
    const idleEdges = buildDeepSearchCanvasEdges({
      snapshot,
      nodes,
      selectedNodeId: null,
      connectedEdgeIds: [],
      highlightedEdgeId: null,
      edgeReasonLabels: {}
    });
    const selectedEdges = buildDeepSearchCanvasEdges({
      snapshot,
      nodes,
      selectedNodeId: "left",
      connectedEdgeIds: ["related"],
      highlightedEdgeId: "related",
      edgeReasonLabels: { related: "Related reason" }
    });

    expect(idleEdges.map((edge) => edge.id)).toEqual(["primary"]);
    expect(selectedEdges.map((edge) => edge.id)).toEqual(["primary", "related"]);
    expect(selectedEdges[0]?.sourceHandle).toBe("source-east");
    expect(selectedEdges[1]?.data?.reasonLabel).toBe("Related reason");
  });
});
