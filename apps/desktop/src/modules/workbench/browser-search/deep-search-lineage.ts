import type { SearchDeepEdge, SearchDeepNode, SearchDeepSnapshot } from "../../../shared/desktop-bridge";
import type {
  DeepSearchEdgeDirectionFilter,
  DeepSearchEdgeKindFilter
} from "./types";

export type DeepSearchConnectedEdge = {
  readonly edge: SearchDeepEdge;
  readonly adjacentNode: SearchDeepNode;
  readonly direction: "incoming" | "outgoing";
};

export type DeepSearchLineage = {
  readonly nodes: readonly SearchDeepNode[];
  readonly alternateCount: number;
};

const PRIMARY_EDGE_KINDS = new Set<SearchDeepEdge["kind"]>([
  "discovered_from",
  "expanded_to",
  "hosts_subdomain",
  "contains_page"
]);

const getNodeById = (snapshot: SearchDeepSnapshot): Map<string, SearchDeepNode> =>
  new Map(snapshot.nodes.map((node) => [node.id, node]));

const getRootNode = (snapshot: SearchDeepSnapshot): SearchDeepNode | null =>
  snapshot.nodes.find((node) => node.kind === "root_query") ?? snapshot.nodes[0] ?? null;

const getPrimaryIncomingEdges = (
  snapshot: SearchDeepSnapshot,
  nodeId: string
): readonly SearchDeepEdge[] =>
  snapshot.edges.filter((edge) => edge.targetId === nodeId && PRIMARY_EDGE_KINDS.has(edge.kind));

const compareLineages = (
  left: { readonly path: readonly SearchDeepNode[]; readonly alternateCount: number },
  right: { readonly path: readonly SearchDeepNode[]; readonly alternateCount: number }
): number => {
  if (left.path.length !== right.path.length) {
    return left.path.length - right.path.length;
  }
  const leftParentScore = left.path[left.path.length - 2]?.score ?? Number.NEGATIVE_INFINITY;
  const rightParentScore = right.path[right.path.length - 2]?.score ?? Number.NEGATIVE_INFINITY;
  return rightParentScore - leftParentScore;
};

export const buildDeepSearchLineage = (
  snapshot: SearchDeepSnapshot,
  nodeId: string | null
): DeepSearchLineage => {
  const rootNode = getRootNode(snapshot);
  const nodeById = getNodeById(snapshot);
  if (rootNode === null || nodeId === null) {
    return {
      nodes: [],
      alternateCount: 0
    };
  }

  const memo = new Map<string, { readonly path: readonly SearchDeepNode[]; readonly alternateCount: number } | null>();

  const resolve = (currentId: string): { readonly path: readonly SearchDeepNode[]; readonly alternateCount: number } | null => {
    if (memo.has(currentId)) {
      return memo.get(currentId) ?? null;
    }
    const current = nodeById.get(currentId);
    if (current === undefined) {
      memo.set(currentId, null);
      return null;
    }
    if (currentId === rootNode.id) {
      const rootPath = {
        path: [current],
        alternateCount: 0
      } as const;
      memo.set(currentId, rootPath);
      return rootPath;
    }

    const candidates = getPrimaryIncomingEdges(snapshot, currentId)
      .map((edge) => resolve(edge.sourceId))
      .filter((entry): entry is { readonly path: readonly SearchDeepNode[]; readonly alternateCount: number } => entry !== null)
      .map((entry) => ({
        path: [...entry.path, current],
        alternateCount: entry.alternateCount
      }));

    if (candidates.length === 0) {
      memo.set(currentId, null);
      return null;
    }

    const sorted = [...candidates].sort(compareLineages);
    const best = sorted[0]!;
    const resolved = {
      path: best.path,
      alternateCount: best.alternateCount + Math.max(0, sorted.length - 1)
    } as const;
    memo.set(currentId, resolved);
    return resolved;
  };

  const resolved = resolve(nodeId);
  if (resolved === null) {
    const current = nodeById.get(nodeId);
    return {
      nodes: current === undefined ? [] : [current],
      alternateCount: 0
    };
  }
  return {
    nodes: resolved.path,
    alternateCount: resolved.alternateCount
  };
};

export const getDeepSearchConnectedEdges = (
  snapshot: SearchDeepSnapshot,
  nodeId: string | null,
  kindFilter: DeepSearchEdgeKindFilter,
  directionFilter: DeepSearchEdgeDirectionFilter
): readonly DeepSearchConnectedEdge[] => {
  if (nodeId === null) {
    return [];
  }
  const nodeById = getNodeById(snapshot);
  return snapshot.edges
    .flatMap((edge) => {
      if (edge.sourceId !== nodeId && edge.targetId !== nodeId) {
        return [];
      }
      if (kindFilter !== "all" && edge.kind !== kindFilter) {
        return [];
      }
      const direction = edge.targetId === nodeId ? "incoming" : "outgoing";
      if (directionFilter !== "both" && directionFilter !== direction) {
        return [];
      }
      const adjacentId = direction === "incoming" ? edge.sourceId : edge.targetId;
      const adjacentNode = nodeById.get(adjacentId);
      if (adjacentNode === undefined) {
        return [];
      }
      return [{ edge, adjacentNode, direction } satisfies DeepSearchConnectedEdge];
    })
    .sort((left, right) => {
      if (left.direction !== right.direction) {
        return left.direction === "incoming" ? -1 : 1;
      }
      if (left.edge.kind !== right.edge.kind) {
        return left.edge.kind.localeCompare(right.edge.kind, "en-US");
      }
      return (right.adjacentNode.score ?? Number.NEGATIVE_INFINITY) - (left.adjacentNode.score ?? Number.NEGATIVE_INFINITY);
    });
};
