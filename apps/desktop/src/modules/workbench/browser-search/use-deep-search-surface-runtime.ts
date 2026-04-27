import type { Viewport } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

import type { SearchDeepSnapshot } from "../../../shared/desktop-bridge";
import { buildDeepSearchLineage, getDeepSearchConnectedEdges } from "./deep-search-lineage";
import type { DeepSearchOverviewLabels } from "./deep-search-overview-model";
import {
  createDeepSearchEdgeReasonLabels,
  expandDeepSearchNode,
  filterDeepSearchSnapshotBySource,
  findDeepSearchSelectedNode,
  getDeepSearchConnectedEdgeIds,
  openDeepSearchLocalPrimary,
  openDeepSearchNode,
  revealDeepSearchNode,
  type DeepSearchLocalOpenBehavior,
  type DeepSearchSourceFilter
} from "./deep-search-surface-model";
import type {
  DeepSearchEdgeDirectionFilter,
  DeepSearchEdgeKindFilter
} from "./types";
import { useSearchPillTransition } from "./use-search-pill-transition";

const DEEP_SEARCH_VIEWPORT_MEMORY = new Map<string, Viewport>();

type UseDeepSearchSurfaceRuntimeParams = {
  readonly labels: DeepSearchOverviewLabels;
  readonly snapshot: SearchDeepSnapshot;
  readonly viewportMemoryKey: string;
  readonly restoreViewportEnabled: boolean;
  readonly localOpenBehavior: DeepSearchLocalOpenBehavior;
  readonly sourceFilter: DeepSearchSourceFilter;
  readonly sharedStartRect: DOMRect | null | undefined;
  readonly onExpandNode: (nodeId: string) => void;
  readonly onOpenUrl: ((url: string, title: string) => void) | undefined;
  readonly onOpenLocalPath: ((path: string) => void) | undefined;
  readonly onRevealLocalPath: ((path: string) => void) | undefined;
  readonly onSharedAnimationDone: (() => void) | undefined;
};

export const useDeepSearchSurfaceRuntime = ({
  labels,
  snapshot,
  viewportMemoryKey,
  restoreViewportEnabled,
  localOpenBehavior,
  sourceFilter,
  sharedStartRect,
  onExpandNode,
  onOpenUrl,
  onOpenLocalPath,
  onRevealLocalPath,
  onSharedAnimationDone
}: UseDeepSearchSurfaceRuntimeParams) => {
  const pillRef = useSearchPillTransition({
    sharedStartRect,
    onSharedAnimationDone
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedEdgeId, setHighlightedEdgeId] = useState<string | null>(null);
  const [fitViewNonce, setFitViewNonce] = useState(0);
  const [focusSelectionNonce, setFocusSelectionNonce] = useState(0);
  const [resetLayoutNonce, setResetLayoutNonce] = useState(0);
  const [edgeKindFilter, setEdgeKindFilter] = useState<DeepSearchEdgeKindFilter>("all");
  const [edgeDirectionFilter, setEdgeDirectionFilter] = useState<DeepSearchEdgeDirectionFilter>("both");
  const filteredSnapshot = useMemo(
    () => filterDeepSearchSnapshotBySource(snapshot, sourceFilter),
    [snapshot, sourceFilter]
  );
  const selectedNode = useMemo(
    () => findDeepSearchSelectedNode(filteredSnapshot, selectedNodeId),
    [filteredSnapshot, selectedNodeId]
  );
  const lineage = useMemo(
    () => buildDeepSearchLineage(filteredSnapshot, selectedNodeId),
    [filteredSnapshot, selectedNodeId]
  );
  const connectedEdges = useMemo(
    () => getDeepSearchConnectedEdges(filteredSnapshot, selectedNodeId, edgeKindFilter, edgeDirectionFilter),
    [edgeDirectionFilter, edgeKindFilter, filteredSnapshot, selectedNodeId]
  );
  const connectedEdgeIds = useMemo(
    () => getDeepSearchConnectedEdgeIds(connectedEdges),
    [connectedEdges]
  );
  const edgeReasonLabels = useMemo(
    () => createDeepSearchEdgeReasonLabels(filteredSnapshot, labels),
    [filteredSnapshot, labels]
  );
  const savedViewport = restoreViewportEnabled
    ? (DEEP_SEARCH_VIEWPORT_MEMORY.get(viewportMemoryKey) ?? null)
    : null;
  const openActions = useMemo(
    () => ({
      onOpenUrl,
      onOpenLocalPath,
      onRevealLocalPath
    }),
    [onOpenLocalPath, onOpenUrl, onRevealLocalPath]
  );

  useEffect(() => {
    if (selectedNodeId === null) {
      return;
    }
    if (filteredSnapshot.nodes.some((node) => node.id === selectedNodeId)) {
      return;
    }
    setSelectedNodeId(null);
  }, [filteredSnapshot.nodes, selectedNodeId]);

  useEffect(() => {
    setHighlightedEdgeId(null);
  }, [selectedNodeId]);

  return {
    pillRef,
    selectedNodeId,
    selectedNode,
    highlightedEdgeId,
    fitViewNonce,
    focusSelectionNonce,
    resetLayoutNonce,
    edgeKindFilter,
    edgeDirectionFilter,
    filteredSnapshot,
    lineage,
    connectedEdges,
    connectedEdgeIds,
    edgeReasonLabels,
    savedViewport,
    setSelectedNodeId,
    setHighlightedEdgeId,
    setEdgeKindFilter,
    setEdgeDirectionFilter,
    onFitView: () => {
      setFitViewNonce((current) => current + 1);
    },
    onResetLayout: () => {
      setResetLayoutNonce((current) => current + 1);
    },
    onCenterSelected: () => {
      setFocusSelectionNonce((current) => current + 1);
    },
    onViewportChange: (viewport: Viewport) => {
      if (restoreViewportEnabled) {
        DEEP_SEARCH_VIEWPORT_MEMORY.set(viewportMemoryKey, viewport);
      }
    },
    onOpenLocalPrimary: (path: string) => {
      openDeepSearchLocalPrimary(path, localOpenBehavior, openActions);
    },
    onOpenSelected: () => {
      openDeepSearchNode(selectedNode, localOpenBehavior, openActions);
    },
    onRevealSelected: () => {
      revealDeepSearchNode(selectedNode, localOpenBehavior, openActions);
    },
    onExpandSelected: () => {
      expandDeepSearchNode(selectedNode, onExpandNode);
    }
  };
};
