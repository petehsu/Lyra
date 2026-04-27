import type { SearchDeepSnapshot } from "../../../shared/desktop-bridge";
import type { DeepSearchCanvasEdge } from "./deep-search-edge-renderers";
import type { DeepSearchCanvasNode } from "./deep-search-node-renderers";

export type DeepSearchEdgeSide = "north" | "south" | "east" | "west";

export type BuildDeepSearchCanvasEdgesParams = {
  readonly snapshot: SearchDeepSnapshot;
  readonly nodes: readonly DeepSearchCanvasNode[];
  readonly selectedNodeId: string | null;
  readonly connectedEdgeIds: readonly string[];
  readonly highlightedEdgeId: string | null;
  readonly edgeReasonLabels: Readonly<Record<string, string>>;
};

export const resolveEdgeSide = (dx: number, dy: number): DeepSearchEdgeSide => {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? "east" : "west";
  }
  return dy >= 0 ? "south" : "north";
};

export const resolveOppositeEdgeSide = (side: DeepSearchEdgeSide): DeepSearchEdgeSide => {
  if (side === "east") {
    return "west";
  }
  if (side === "west") {
    return "east";
  }
  if (side === "north") {
    return "south";
  }
  return "north";
};

export const buildDeepSearchCanvasEdges = ({
  snapshot,
  nodes,
  selectedNodeId,
  connectedEdgeIds,
  highlightedEdgeId,
  edgeReasonLabels
}: BuildDeepSearchCanvasEdgesParams): readonly DeepSearchCanvasEdge[] => {
  const connectedEdgeSet = new Set(connectedEdgeIds);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return snapshot.edges.flatMap((edge) => {
    const sourceNode = nodeById.get(edge.sourceId);
    const targetNode = nodeById.get(edge.targetId);
    if (sourceNode === undefined || targetNode === undefined) {
      return [];
    }
    const sourceWidth = sourceNode.width ?? 0;
    const sourceHeight = sourceNode.height ?? 0;
    const targetWidth = targetNode.width ?? 0;
    const targetHeight = targetNode.height ?? 0;
    const sourceCenterX = sourceNode.position.x + sourceWidth / 2;
    const sourceCenterY = sourceNode.position.y + sourceHeight / 2;
    const targetCenterX = targetNode.position.x + targetWidth / 2;
    const targetCenterY = targetNode.position.y + targetHeight / 2;
    const direction = resolveEdgeSide(targetCenterX - sourceCenterX, targetCenterY - sourceCenterY);
    const opposite = resolveOppositeEdgeSide(direction);
    const adjacentToSelection = selectedNodeId !== null && connectedEdgeSet.has(edge.id);
    if (edge.kind === "related_to" && adjacentToSelection === false) {
      return [];
    }
    return [{
      id: edge.id,
      type: "deepSearchEdge",
      source: edge.sourceId,
      target: edge.targetId,
      sourceHandle: `source-${direction}`,
      targetHandle: `target-${opposite}`,
      animated: edge.kind === "expanded_to",
      data: {
        kind: edge.kind,
        highlighted: highlightedEdgeId === edge.id || adjacentToSelection,
        muted: selectedNodeId !== null && adjacentToSelection === false,
        showReasonBadge: adjacentToSelection,
        ...(edgeReasonLabels[edge.id] === undefined
          ? {}
          : { reasonLabel: edgeReasonLabels[edge.id] })
      }
    } satisfies DeepSearchCanvasEdge];
  });
};
