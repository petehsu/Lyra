import type { Edge, Node, ReactFlowInstance, Viewport } from "@xyflow/react";

import type { SearchDeepSnapshot } from "../../../shared/desktop-bridge";

const resolveFitPadding = (): number => {
  if (typeof window === "undefined") {
    return 0.18;
  }
  return window.innerWidth >= 1080 ? 0.14 : 0.18;
};

const resolveFocusZoom = (): number => {
  if (typeof window === "undefined") {
    return 0.82;
  }
  if (window.innerWidth >= 1600) {
    return 0.96;
  }
  if (window.innerWidth >= 1280) {
    return 0.9;
  }
  if (window.innerWidth >= 1080) {
    return 0.84;
  }
  return 0.72;
};

export const focusRootRingViewport = <TNode extends Node, TEdge extends Edge>(
  instance: ReactFlowInstance<TNode, TEdge> | null,
  snapshot: SearchDeepSnapshot,
  nodes: readonly TNode[],
  duration = 260
): void => {
  if (instance === null || nodes.length === 0) {
    return;
  }
  const rootNode = snapshot.nodes.find((node) => node.kind === "root_query") ?? snapshot.nodes[0];
  if (rootNode === undefined) {
    return;
  }
  const rootCanvasNode = nodes.find((node) => node.id === rootNode.id);
  if (rootCanvasNode === undefined) {
    instance.fitView({ padding: resolveFitPadding(), duration, maxZoom: 1 });
    return;
  }

  const rootCenterX = rootCanvasNode.position.x + ((rootCanvasNode.width ?? 0) / 2);
  const rootCenterY = rootCanvasNode.position.y + ((rootCanvasNode.height ?? 0) / 2);
  instance.setCenter(rootCenterX, rootCenterY, {
    zoom: resolveFocusZoom(),
    duration,
  });
};

export const focusSelectedContextViewport = <TNode extends Node, TEdge extends Edge>(
  instance: ReactFlowInstance<TNode, TEdge> | null,
  snapshot: SearchDeepSnapshot,
  nodes: readonly TNode[],
  selectedNodeId: string | null,
  duration = 220
): void => {
  if (instance === null || nodes.length === 0 || selectedNodeId === null) {
    return;
  }
  const adjacentIds = new Set<string>([selectedNodeId]);
  snapshot.edges.forEach((edge) => {
    if (edge.sourceId === selectedNodeId) {
      adjacentIds.add(edge.targetId);
    }
    if (edge.targetId === selectedNodeId) {
      adjacentIds.add(edge.sourceId);
    }
  });
  const targetNodes = nodes.filter((node) => adjacentIds.has(node.id));
  if (targetNodes.length === 0) {
    focusRootRingViewport(instance, snapshot, nodes, duration);
    return;
  }
  instance.fitView({
    nodes: [...targetNodes],
    padding: 0.18,
    duration,
    maxZoom: 1.06
  });
};

export const applySavedViewport = <TNode extends Node, TEdge extends Edge>(
  instance: ReactFlowInstance<TNode, TEdge> | null,
  viewport: Viewport,
  duration = 220
): void => {
  if (instance === null) {
    return;
  }
  instance.setViewport(viewport, { duration });
};
