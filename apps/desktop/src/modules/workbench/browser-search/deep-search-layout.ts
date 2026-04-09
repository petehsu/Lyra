import { Position, type Node } from "@xyflow/react";

import type { SearchDeepEdge, SearchDeepNode, SearchDeepSnapshot } from "../../../shared/desktop-bridge";

export type DeepSearchManualPosition = {
  readonly x: number;
  readonly y: number;
};

export type DeepSearchNodeSize = {
  readonly width: number;
  readonly height: number;
};

type LayoutTree = {
  readonly rootId: string | null;
  readonly depthById: Map<string, number>;
  readonly parentById: Map<string, string>;
  readonly childrenById: Map<string, SearchDeepNode[]>;
};

const ROOT_CENTER = { x: 0, y: 0 } as const;
const PRIMARY_EDGE_KINDS = new Set<SearchDeepEdge["kind"]>([
  "discovered_from",
  "expanded_to",
  "hosts_subdomain",
  "contains_page"
]);
const MIN_SECTOR_WIDTH = Math.PI / 7.2;
const MIN_CHILD_ANGLE = Math.PI / 12;
const NODE_COLLISION_PADDING = 14;
const COLLISION_ITERATIONS = 28;
const RADIAL_COMPACTION_PADDING = 8;

const getBaseRingRadius = (depth: number): number => {
  if (depth <= 0) {
    return 0;
  }
  if (depth === 1) {
    return 280;
  }
  if (depth === 2) {
    return 470;
  }
  if (depth === 3) {
    return 660;
  }
  return 660 + (depth - 3) * 170;
};

export const getDeepSearchNodeSize = (kind: SearchDeepNode["kind"]): DeepSearchNodeSize => {
  if (kind === "root_query") {
    return { width: 320, height: 144 };
  }
  if (kind === "derived_query") {
    return { width: 280, height: 132 };
  }
  if (kind === "site_domain") {
    return { width: 300, height: 152 };
  }
  if (kind === "site_subdomain") {
    return { width: 290, height: 148 };
  }
  return { width: 280, height: 148 };
};

const resolveNodePriority = (node: SearchDeepNode): number => {
  if (node.kind === "site_domain") {
    return 0;
  }
  if (node.kind === "web_page") {
    return 1;
  }
  if (node.kind === "site_subdomain") {
    return 2;
  }
  if (node.kind === "derived_query") {
    return 3;
  }
  if (node.kind === "local_result") {
    return 4;
  }
  return 5;
};

const getRootNodeId = (snapshot: SearchDeepSnapshot): string | null =>
  snapshot.nodes.find((node) => node.kind === "root_query")?.id ?? snapshot.nodes[0]?.id ?? null;

const sortChildren = (nodes: readonly SearchDeepNode[]): readonly SearchDeepNode[] =>
  [...nodes].sort((left, right) => {
    const leftPriority = resolveNodePriority(left);
    const rightPriority = resolveNodePriority(right);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const scoreDelta = (right.score ?? -Infinity) - (left.score ?? -Infinity);
    if (Number.isFinite(scoreDelta) && scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.title.localeCompare(right.title, "zh-CN");
  });

const resolveHandle = (dx: number, dy: number): Position => {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? Position.Right : Position.Left;
  }
  return dy >= 0 ? Position.Bottom : Position.Top;
};

export const resolveHandleId = (position: Position): "north" | "south" | "east" | "west" => {
  if (position === Position.Top) {
    return "north";
  }
  if (position === Position.Bottom) {
    return "south";
  }
  if (position === Position.Left) {
    return "west";
  }
  return "east";
};

const toPrimaryEdges = (snapshot: SearchDeepSnapshot): readonly SearchDeepEdge[] =>
  snapshot.edges.filter((edge) => PRIMARY_EDGE_KINDS.has(edge.kind));

const getNodeArcDemand = (node: SearchDeepNode): number => {
  const size = getDeepSearchNodeSize(node.kind);
  return size.width + 44;
};

const buildLayoutTree = (snapshot: SearchDeepSnapshot): LayoutTree => {
  const rootId = getRootNodeId(snapshot);
  const depthById = new Map<string, number>();
  const parentById = new Map<string, string>();
  const childrenById = new Map<string, SearchDeepNode[]>();
  if (rootId === null) {
    return { rootId, depthById, parentById, childrenById };
  }

  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const outgoingById = new Map<string, SearchDeepNode[]>();
  for (const edge of toPrimaryEdges(snapshot)) {
    const child = nodeById.get(edge.targetId);
    if (child === undefined) {
      continue;
    }
    const current = outgoingById.get(edge.sourceId);
    if (current === undefined) {
      outgoingById.set(edge.sourceId, [child]);
    } else {
      current.push(child);
    }
  }
  for (const [nodeId, children] of outgoingById.entries()) {
    outgoingById.set(nodeId, [...sortChildren(children)]);
  }

  depthById.set(rootId, 0);
  const queue = [rootId];
  while (queue.length > 0) {
    const nextId = queue.shift();
    if (nextId === undefined) {
      break;
    }
    const nextDepth = depthById.get(nextId) ?? 0;
    const children = outgoingById.get(nextId) ?? [];
    for (const child of children) {
      if (depthById.has(child.id)) {
        continue;
      }
      depthById.set(child.id, nextDepth + 1);
      parentById.set(child.id, nextId);
      const current = childrenById.get(nextId);
      if (current === undefined) {
        childrenById.set(nextId, [child]);
      } else {
        current.push(child);
      }
      queue.push(child.id);
    }
  }

  const rootNode = nodeById.get(rootId) ?? null;
  const detachedNodes = snapshot.nodes.filter(
    (node) => node.id !== rootId && depthById.has(node.id) === false
  );
  if (rootNode !== null && detachedNodes.length > 0) {
    const current = childrenById.get(rootId) ?? [];
    childrenById.set(rootId, [...current, ...sortChildren(detachedNodes)]);
    for (const node of detachedNodes) {
      depthById.set(node.id, 1);
      parentById.set(node.id, rootId);
    }
  }

  for (const [nodeId, children] of childrenById.entries()) {
    childrenById.set(nodeId, [...sortChildren(children)]);
  }

  return { rootId, depthById, parentById, childrenById };
};

const buildSubtreeWeightMap = (tree: LayoutTree): Map<string, number> => {
  const weights = new Map<string, number>();

  const visit = (nodeId: string): number => {
    const children = tree.childrenById.get(nodeId) ?? [];
    const childrenWeight = children.reduce((sum, child) => sum + visit(child.id), 0);
    const selfWeight = Math.max(1, (children[0] === undefined ? 0.9 : 0.6) + childrenWeight * 0.78);
    weights.set(nodeId, selfWeight);
    return selfWeight;
  };

  if (tree.rootId !== null) {
    visit(tree.rootId);
  }
  return weights;
};

const assignRadialPositions = (snapshot: SearchDeepSnapshot): Map<string, DeepSearchManualPosition> => {
  const tree = buildLayoutTree(snapshot);
  const positions = new Map<string, DeepSearchManualPosition>();
  const weightById = buildSubtreeWeightMap(tree);
  if (tree.rootId === null) {
    return positions;
  }

  positions.set(tree.rootId, ROOT_CENTER);

  const placeChildren = (parentId: string, startAngle: number, endAngle: number): void => {
    const children = tree.childrenById.get(parentId) ?? [];
    if (children.length === 0) {
      return;
    }

    const parentDepth = tree.depthById.get(parentId) ?? 0;
    const nextDepth = parentDepth + 1;
    const parentPosition = positions.get(parentId) ?? ROOT_CENTER;
    const parentRadius = Math.hypot(parentPosition.x, parentPosition.y);
    const span = Math.max(endAngle - startAngle, MIN_SECTOR_WIDTH * Math.min(children.length, 2));
    const effectiveWeights = children.map((child) =>
      Math.max(weightById.get(child.id) ?? 1, getNodeArcDemand(child) / 170)
    );
    const totalWeight = effectiveWeights.reduce((sum, weight) => sum + weight, 0);
    const slotAngles = effectiveWeights.map((weight) => Math.max(MIN_CHILD_ANGLE, span * (weight / totalWeight)));
    const totalSlotAngle = slotAngles.reduce((sum, angle) => sum + angle, 0);
    const normalizedSlotAngles = slotAngles.map((angle) => angle * (span / totalSlotAngle));
    const maxRequiredRadius = children.reduce((maximum, child, index) => {
      const slotAngle = Math.max(normalizedSlotAngles[index] ?? MIN_CHILD_ANGLE, MIN_CHILD_ANGLE * 0.92);
      const slotDemand = getNodeArcDemand(child)
        + ((tree.childrenById.get(child.id)?.length ?? 0) * 8)
        + Math.max(0, children.length - 3) * 6;
      return Math.max(maximum, slotDemand / slotAngle);
    }, 0);
    const radius = Math.max(
      getBaseRingRadius(nextDepth),
      parentRadius + 150 + Math.max(0, children.length - 2) * 16,
      maxRequiredRadius
    );

    let cursor = startAngle;
    children.forEach((child, index) => {
      const slotAngle = normalizedSlotAngles[index] ?? (span / children.length);
      const jitter = children.length <= 2 ? 0 : ((index % 2 === 0 ? -1 : 1) * Math.min(22, 6 + children.length * 2));
      const childRadius = Math.max(getBaseRingRadius(nextDepth), radius + jitter);
      const angle = cursor + slotAngle / 2;
      positions.set(child.id, {
        x: Math.cos(angle) * childRadius,
        y: Math.sin(angle) * childRadius
      });

      const childPadding = Math.min(slotAngle * 0.16, 0.11);
      const childStart = cursor + childPadding;
      const childEnd = cursor + slotAngle - childPadding;
      placeChildren(
        child.id,
        childEnd > childStart ? childStart : cursor,
        childEnd > childStart ? childEnd : cursor + slotAngle
      );
      cursor += slotAngle;
    });
  };

  placeChildren(tree.rootId, -Math.PI, Math.PI);
  return positions;
};

const setPolarPosition = (
  entry: {
    x: number;
    y: number;
    depth: number;
  },
  angle: number,
  radius: number
): void => {
  const safeRadius = Math.max(radius, getBaseRingRadius(entry.depth));
  entry.x = Math.cos(angle) * safeRadius;
  entry.y = Math.sin(angle) * safeRadius;
};

const applyCollisionAvoidance = (
  snapshot: SearchDeepSnapshot,
  positions: Map<string, DeepSearchManualPosition>,
  depthById: ReadonlyMap<string, number>
): void => {
  const movableNodes = snapshot.nodes
    .map((node) => {
      const current = positions.get(node.id);
      if (current === undefined) {
        return null;
      }
      return {
        id: node.id,
        kind: node.kind,
        depth: depthById.get(node.id) ?? 0,
        width: getDeepSearchNodeSize(node.kind).width,
        height: getDeepSearchNodeSize(node.kind).height,
        x: current.x,
        y: current.y
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < movableNodes.length; leftIndex += 1) {
      const left = movableNodes[leftIndex];
      if (left === undefined) {
        continue;
      }
      for (let rightIndex = leftIndex + 1; rightIndex < movableNodes.length; rightIndex += 1) {
        const right = movableNodes[rightIndex];
        if (right === undefined) {
          continue;
        }
        if (left.depth === 0 && right.depth === 0) {
          continue;
        }

        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const minX = (left.width + right.width) / 2 + NODE_COLLISION_PADDING;
        const minY = (left.height + right.height) / 2 + NODE_COLLISION_PADDING;
        if (Math.abs(dx) >= minX || Math.abs(dy) >= minY) {
          continue;
        }

        const overlapX = minX - Math.abs(dx);
        const overlapY = minY - Math.abs(dy);
        const push = Math.max(overlapX, overlapY, 24);
        const baseLength = Math.hypot(dx, dy);
        const leftAngle = Math.atan2(left.y, left.x || 1);
        const rightAngle = Math.atan2(right.y, right.x || 1);
        const direction = baseLength > 0.01
          ? (Math.sin(rightAngle - leftAngle) >= 0 ? 1 : -1)
          : ((leftIndex + rightIndex) % 2 === 0 ? 1 : -1);

        if (left.depth === right.depth && left.depth > 0) {
          const angleStep = Math.min(0.2, push / Math.max(Math.min(Math.hypot(left.x, left.y), Math.hypot(right.x, right.y)), 240));
          const radialStep = push * 0.46;
          setPolarPosition(left, leftAngle - angleStep * 0.5 * direction, Math.hypot(left.x, left.y) + radialStep);
          setPolarPosition(right, rightAngle + angleStep * 0.5 * direction, Math.hypot(right.x, right.y) + radialStep);
        } else {
          const shallower = left.depth <= right.depth ? left : right;
          const deeper = shallower.id === left.id ? right : left;
          const shallowerAngle = Math.atan2(shallower.y, shallower.x || 1);
          const deeperAngle = Math.atan2(deeper.y, deeper.x || 1);
          const angleStep = Math.min(0.14, push / Math.max(Math.hypot(deeper.x, deeper.y), 260));
          setPolarPosition(
            deeper,
            deeperAngle + angleStep * direction,
            Math.hypot(deeper.x, deeper.y) + push * 0.94
          );
          if (shallower.depth > 0) {
            setPolarPosition(
              shallower,
              shallowerAngle - angleStep * 0.22 * direction,
              Math.hypot(shallower.x, shallower.y) + push * 0.12
            );
          }
        }

        moved = true;
      }
    }
    if (moved === false) {
      break;
    }
  }

  movableNodes.forEach((entry) => {
    positions.set(entry.id, { x: entry.x, y: entry.y });
  });
};

const doNodesOverlap = (
  left: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  right: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  padding: number
): boolean => {
  const minX = (left.width + right.width) / 2 + padding;
  const minY = (left.height + right.height) / 2 + padding;
  return Math.abs(left.x - right.x) < minX && Math.abs(left.y - right.y) < minY;
};

const applyRadialCompaction = (
  snapshot: SearchDeepSnapshot,
  tree: LayoutTree,
  positions: Map<string, DeepSearchManualPosition>
): void => {
  const entries = snapshot.nodes
    .map((node) => {
      const current = positions.get(node.id);
      if (current === undefined) {
        return null;
      }
      const size = getDeepSearchNodeSize(node.kind);
      return {
        id: node.id,
        depth: tree.depthById.get(node.id) ?? 0,
        width: size.width,
        height: size.height,
        x: current.x,
        y: current.y
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const compactionOrder = [...entries]
    .filter((entry) => entry.depth > 0)
    .sort((left, right) => {
      if (left.depth !== right.depth) {
        return left.depth - right.depth;
      }
      return Math.hypot(right.x, right.y) - Math.hypot(left.x, left.y);
    });

  for (let iteration = 0; iteration < 4; iteration += 1) {
    let moved = false;
    for (const entry of compactionOrder) {
      const parentId = tree.parentById.get(entry.id);
      const parent = parentId === undefined ? null : (entryById.get(parentId) ?? null);
      const angle = Math.atan2(entry.y, entry.x || 1);
      const currentRadius = Math.hypot(entry.x, entry.y);
      const minimumRadius = Math.max(
        getBaseRingRadius(entry.depth),
        (parent === null ? 0 : Math.hypot(parent.x, parent.y) + 92)
      );
      if (currentRadius <= minimumRadius + 2) {
        continue;
      }

      let low = minimumRadius;
      let high = currentRadius;
      let best = currentRadius;
      for (let step = 0; step < 14; step += 1) {
        const candidateRadius = (low + high) / 2;
        const candidate = {
          x: Math.cos(angle) * candidateRadius,
          y: Math.sin(angle) * candidateRadius,
          width: entry.width,
          height: entry.height
        };
        const overlaps = entries.some((other) => {
          if (other.id === entry.id) {
            return false;
          }
          return doNodesOverlap(candidate, other, RADIAL_COMPACTION_PADDING);
        });
        if (overlaps) {
          low = candidateRadius;
        } else {
          best = candidateRadius;
          high = candidateRadius;
        }
      }

      if (best < currentRadius - 2) {
        entry.x = Math.cos(angle) * best;
        entry.y = Math.sin(angle) * best;
        moved = true;
      }
    }
    if (moved === false) {
      break;
    }
  }

  entries.forEach((entry) => {
    positions.set(entry.id, { x: entry.x, y: entry.y });
  });
};

export const getDeepSearchRootRingIds = (
  snapshot: SearchDeepSnapshot,
  maxCount: number
): readonly string[] => {
  const tree = buildLayoutTree(snapshot);
  if (tree.rootId === null) {
    return [];
  }
  return (tree.childrenById.get(tree.rootId) ?? [])
    .slice(0, maxCount)
    .map((node) => node.id);
};

export const buildDeepSearchCanvasNodes = <TData extends Record<string, unknown>>(
  snapshot: SearchDeepSnapshot,
  manualPositions: ReadonlyMap<string, DeepSearchManualPosition>,
  buildData: (node: SearchDeepNode) => TData
): readonly Node<TData, "deepSearchNode">[] => {
  const tree = buildLayoutTree(snapshot);
  const autoPositions = assignRadialPositions(snapshot);
  applyCollisionAvoidance(snapshot, autoPositions, tree.depthById);
  applyRadialCompaction(snapshot, tree, autoPositions);

  return snapshot.nodes.map((node) => {
    const size = getDeepSearchNodeSize(node.kind);
    const basePosition = manualPositions.get(node.id) ?? autoPositions.get(node.id) ?? ROOT_CENTER;
    const angle = Math.atan2(basePosition.y, basePosition.x || 1);
    const inward = resolveHandle(-basePosition.x, -basePosition.y);
    const outward = resolveHandle(basePosition.x, basePosition.y);

    return {
      id: node.id,
      type: "deepSearchNode",
      position: {
        x: basePosition.x - size.width / 2,
        y: basePosition.y - size.height / 2
      },
      width: size.width,
      height: size.height,
      sourcePosition: outward,
      targetPosition: inward,
      data: buildData(node),
      draggable: true,
      selectable: true,
      zIndex:
        node.kind === "root_query"
          ? 4
          : node.kind === "derived_query" || node.kind === "site_domain"
            ? 3
            : node.kind === "site_subdomain"
              ? 2
              : 1,
      style: {
        width: size.width,
        height: size.height
      },
      ariaLabel: `${node.kind}:${node.title}`,
      ...(Number.isFinite(angle) ? { dragHandle: ".lyra-deep-search-node" } : {})
    };
  });
};
