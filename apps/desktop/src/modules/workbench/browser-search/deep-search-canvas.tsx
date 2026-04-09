import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { SearchDeepSnapshot } from "../../../shared/desktop-bridge";
import { deepSearchEdgeTypes, type DeepSearchCanvasEdge } from "./deep-search-edge-renderers";
import {
  buildDeepSearchCanvasNodes,
  type DeepSearchManualPosition
} from "./deep-search-layout";
import {
  applySavedViewport,
  focusRootRingViewport,
  focusSelectedContextViewport
} from "./deep-search-viewport";
import {
  deepSearchNodeTypes,
  type DeepSearchCanvasNode,
  type DeepSearchCanvasNodeData
} from "./deep-search-node-renderers";

type DeepSearchCanvasProps = {
  readonly snapshot: SearchDeepSnapshot;
  readonly selectedNodeId: string | null;
  readonly loadingLabel: string;
  readonly emptyLabel: string;
  readonly officialResultLabel: string;
  readonly officialCategoryLabels: Readonly<Record<string, string>>;
  readonly fitViewNonce: number;
  readonly focusSelectionNonce: number;
  readonly resetLayoutNonce: number;
  readonly connectedEdgeIds: readonly string[];
  readonly highlightedEdgeId: string | null;
  readonly edgeReasonLabels: Readonly<Record<string, string>>;
  readonly savedViewport: Viewport | null;
  readonly restoreViewportEnabled: boolean;
  readonly onSelectNode: (nodeId: string | null) => void;
  readonly onHighlightEdge: (edgeId: string | null) => void;
  readonly onViewportChange: (viewport: Viewport) => void;
  readonly onOpenWebResult: ((url: string, title: string) => void) | undefined;
  readonly onOpenLocalResult: ((path: string) => void) | undefined;
  readonly onExpandNode: (nodeId: string) => void;
};

const resolveEdgeSide = (dx: number, dy: number): "north" | "south" | "east" | "west" => {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? "east" : "west";
  }
  return dy >= 0 ? "south" : "north";
};

export const DeepSearchCanvas = ({
  snapshot,
  selectedNodeId,
  loadingLabel,
  emptyLabel,
  officialResultLabel,
  officialCategoryLabels,
  fitViewNonce,
  focusSelectionNonce,
  resetLayoutNonce,
  connectedEdgeIds,
  highlightedEdgeId,
  edgeReasonLabels,
  savedViewport,
  restoreViewportEnabled,
  onSelectNode,
  onHighlightEdge,
  onViewportChange,
  onOpenWebResult,
  onOpenLocalResult,
  onExpandNode
}: DeepSearchCanvasProps) => {
  const flowRef = useRef<ReactFlowInstance<DeepSearchCanvasNode, DeepSearchCanvasEdge> | null>(null);
  const manualPositionsRef = useRef(new Map<string, DeepSearchManualPosition>());
  const initialViewportKeyRef = useRef<string | null>(null);
  const [flowReadyNonce, setFlowReadyNonce] = useState(0);
  const snapshotNodeById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot.nodes]
  );
  const [nodes, setNodes] = useState<readonly DeepSearchCanvasNode[]>([]);
  const [edges, setEdges] = useState<readonly DeepSearchCanvasEdge[]>([]);
  const connectedEdgeSet = useMemo(() => new Set(connectedEdgeIds), [connectedEdgeIds]);

  useEffect(() => {
    if (initialViewportKeyRef.current !== snapshot.query) {
      initialViewportKeyRef.current = null;
    }
  }, [snapshot.query]);

  useEffect(() => {
    const nextNodes = buildDeepSearchCanvasNodes(snapshot, manualPositionsRef.current, (node) => ({
      kind: node.kind,
      title: node.title,
      status: node.status,
      ...(node.subtitle === undefined ? {} : { subtitle: node.subtitle }),
      ...(node.score === undefined ? {} : { score: node.score }),
      ...(node.metadata?.isOfficialResult === true
        ? {
            isOfficialResult: true,
            officialLabel: officialResultLabel,
            ...(typeof node.metadata?.officialCategory === "string"
              ? {
                  officialCategory: node.metadata.officialCategory,
                  officialCategoryLabel:
                    officialCategoryLabels[node.metadata.officialCategory] ?? officialResultLabel
                }
              : {})
          }
        : {})
    } satisfies DeepSearchCanvasNodeData));
    setNodes(nextNodes as DeepSearchCanvasNode[]);
  }, [officialCategoryLabels, officialResultLabel, snapshot]);

  useEffect(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const nextEdges: DeepSearchCanvasEdge[] = snapshot.edges.flatMap((edge) => {
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
      const opposite = direction === "east"
        ? "west"
        : direction === "west"
          ? "east"
          : direction === "north"
            ? "south"
            : "north";
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
    setEdges(nextEdges);
  }, [connectedEdgeSet, edgeReasonLabels, highlightedEdgeId, nodes, selectedNodeId, snapshot.edges]);

  useEffect(() => {
    if (resetLayoutNonce === 0) {
      return;
    }
    manualPositionsRef.current = new Map();
    const nextNodes = buildDeepSearchCanvasNodes(snapshot, manualPositionsRef.current, (node) => ({
      kind: node.kind,
      title: node.title,
      status: node.status,
      ...(node.subtitle === undefined ? {} : { subtitle: node.subtitle }),
      ...(node.score === undefined ? {} : { score: node.score }),
      ...(node.metadata?.isOfficialResult === true
        ? {
            isOfficialResult: true,
            officialLabel: officialResultLabel,
            ...(typeof node.metadata?.officialCategory === "string"
              ? {
                  officialCategory: node.metadata.officialCategory,
                  officialCategoryLabel:
                    officialCategoryLabels[node.metadata.officialCategory] ?? officialResultLabel
                }
              : {})
          }
        : {})
    } satisfies DeepSearchCanvasNodeData));
    setNodes(nextNodes as DeepSearchCanvasNode[]);
    setTimeout(() => {
      focusRootRingViewport(flowRef.current, snapshot, nextNodes as DeepSearchCanvasNode[]);
    }, 0);
  }, [officialCategoryLabels, officialResultLabel, resetLayoutNonce, snapshot]);

  useEffect(() => {
    if (fitViewNonce === 0) {
      return;
    }
    flowRef.current?.fitView({
      padding: 0.18,
      duration: 260
    });
  }, [fitViewNonce]);

  useEffect(() => {
    if (focusSelectionNonce === 0) {
      return;
    }
    focusSelectedContextViewport(flowRef.current, snapshot, nodes, selectedNodeId);
  }, [focusSelectionNonce, nodes, selectedNodeId, snapshot]);

  useEffect(() => {
    if (snapshot.phase === "bootstrapping" || nodes.length === 0) {
      return;
    }
    if (flowReadyNonce === 0) {
      return;
    }
    if (initialViewportKeyRef.current === snapshot.query) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      if (restoreViewportEnabled && savedViewport !== null) {
        applySavedViewport(flowRef.current, savedViewport);
      } else {
        focusRootRingViewport(flowRef.current, snapshot, nodes);
      }
      initialViewportKeyRef.current = snapshot.query;
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [flowReadyNonce, nodes, restoreViewportEnabled, savedViewport, snapshot]);

  if (snapshot.phase === "bootstrapping") {
    return (
      <div className="lyra-deep-search-canvas-shell">
        <div className="lyra-deep-search-loading">
          <div className="lyra-deep-search-loading-grid" aria-hidden="true">
            {Array.from({ length: 6 }, (_value, index) => (
              <span key={`deep-search-skeleton-${index}`} className="lyra-deep-search-loading-card" />
            ))}
          </div>
          <strong>{loadingLabel}</strong>
        </div>
      </div>
    );
  }

  if (snapshot.nodes.length === 0) {
    return (
      <div className="lyra-deep-search-canvas-shell">
        <div className="lyra-deep-search-empty">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div className="lyra-deep-search-canvas-shell">
      <ReactFlow
        nodes={nodes as DeepSearchCanvasNode[]}
        edges={edges as DeepSearchCanvasEdge[]}
        nodeTypes={deepSearchNodeTypes}
        edgeTypes={deepSearchEdgeTypes}
        minZoom={0.45}
        maxZoom={2.2}
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => {
          flowRef.current = instance;
          setFlowReadyNonce((current) => current + 1);
        }}
        onNodesChange={(changes: NodeChange<DeepSearchCanvasNode>[]) => {
          for (const change of changes) {
            if (change.type !== "position" || change.position === undefined) {
              continue;
            }
            const node = nodes.find((entry) => entry.id === change.id);
            manualPositionsRef.current.set(change.id, {
              x: change.position.x + ((node?.width ?? 0) / 2),
              y: change.position.y + ((node?.height ?? 0) / 2)
            });
          }
          setNodes((current) => applyNodeChanges(changes, [...current]));
        }}
        onEdgesChange={(changes: EdgeChange<DeepSearchCanvasEdge>[]) => {
          setEdges((current) => applyEdgeChanges(changes, [...current]));
        }}
        onMoveEnd={() => {
          const viewport = flowRef.current?.getViewport();
          if (viewport !== undefined) {
            onViewportChange(viewport);
          }
        }}
        onNodeClick={(_event, node) => {
          onHighlightEdge(null);
          onSelectNode(node.id);
        }}
        onEdgeClick={(_event, edge) => {
          onHighlightEdge(edge.id);
        }}
        onPaneClick={() => {
          onHighlightEdge(null);
          onSelectNode(null);
        }}
        onNodeDoubleClick={(_event, node) => {
          const source = snapshotNodeById.get(node.id);
          if (source === undefined) {
            return;
          }
          if (
            (source.kind === "web_page" || source.kind === "site_domain" || source.kind === "site_subdomain")
            && typeof source.metadata?.finalUrl === "string"
          ) {
            onOpenWebResult?.(source.metadata.finalUrl, source.title);
            return;
          }
          if (source.kind === "web_page" && typeof source.metadata?.url === "string") {
            onOpenWebResult?.(source.metadata.url, source.title);
            return;
          }
          if (source.kind === "local_result" && typeof source.metadata?.path === "string") {
            onOpenLocalResult?.(source.metadata.path);
            return;
          }
          if (source.kind === "root_query" || source.kind === "derived_query") {
            onExpandNode(source.id);
          }
        }}
      >
        <Background gap={24} size={1} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            const kind = (node.data as DeepSearchCanvasNodeData).kind;
            if (kind === "root_query") {
              return "#E8A93E";
            }
          if (kind === "derived_query") {
            return "#6D9EEB";
          }
          if (kind === "site_domain") {
            return "#2E9B5F";
          }
          if (kind === "site_subdomain") {
            return "#3EAF7B";
          }
          if (kind === "web_page") {
            return "#39A275";
          }
          return "#D57A45";
          }}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
      {selectedNodeId === null ? null : (
        <div className="lyra-deep-search-selection-indicator">{selectedNodeId}</div>
      )}
    </div>
  );
};
