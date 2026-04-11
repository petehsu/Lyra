import { randomUUID } from "node:crypto";

import type {
  WorkbenchWebGraphBuildBudget,
  WorkbenchWebGraphBuildRequest,
  WorkbenchWebGraphEdge
} from "../../shared/workbench-web-automation";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { buildFrameExtractorScript, normalizeFrameExtractSnapshot, type FrameExtractSnapshot } from "./extractor-script";
import type { WorkbenchWebGraphSnapshot } from "./types";

const DEFAULT_MAX_NODES = 30_000;
const DEFAULT_MAX_FRAMES = 128;
const DEFAULT_MAX_SCROLL_STEPS = 200;
const DEFAULT_MAX_BUILD_MS = 20_000;

const clamp = (value: number | undefined, min: number, max: number, fallback: number): number => {
  const candidate = typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
  return Math.max(min, Math.min(max, candidate));
};

const withEdge = (
  edgeMap: Map<string, WorkbenchWebGraphEdge>,
  edge: WorkbenchWebGraphEdge
): void => {
  const key = `${edge.relation}:${edge.fromNodeId}->${edge.toNodeId}`;
  if (edgeMap.has(key)) {
    return;
  }
  edgeMap.set(key, edge);
};

const isInteractable = (node: { readonly interactable: { readonly clickable: boolean; readonly typable: boolean; readonly selectable: boolean; readonly focusable: boolean; readonly scrollable: boolean; } }): boolean =>
  node.interactable.clickable
  || node.interactable.typable
  || node.interactable.selectable
  || node.interactable.focusable
  || node.interactable.scrollable;

const normalizeBudget = (request?: WorkbenchWebGraphBuildRequest): WorkbenchWebGraphBuildBudget => ({
  maxNodes: clamp(request?.maxNodes, 1_000, 60_000, DEFAULT_MAX_NODES),
  maxFrames: clamp(request?.maxFrames, 1, 256, DEFAULT_MAX_FRAMES),
  maxScrollSteps: clamp(request?.maxScrollSteps, 0, 500, DEFAULT_MAX_SCROLL_STEPS),
  maxBuildMs: clamp(request?.maxBuildMs, 500, 60_000, DEFAULT_MAX_BUILD_MS)
});

const buildScrollScript = (): string => `
  (() => {
    const root = document.scrollingElement || document.documentElement || document.body;
    if (!root) {
      return { reachedBottom: true, scrollTop: 0 };
    }
    const step = Math.max(window.innerHeight * 0.8, 240);
    const before = Number(root.scrollTop || 0);
    root.scrollBy({ top: step, behavior: "instant" });
    const after = Number(root.scrollTop || 0);
    const maxTop = Math.max(0, Number(root.scrollHeight || 0) - Number(root.clientHeight || 0));
    return {
      reachedBottom: after >= maxTop - 4,
      scrollTop: after,
      changed: Math.abs(after - before) > 0.5
    };
  })()
`;

const buildMetadataEdgeHints = (
  snapshot: FrameExtractSnapshot,
  edgeMap: Map<string, WorkbenchWebGraphEdge>
): void => {
  const idMap = new Map<string, string>();
  for (const node of snapshot.nodes) {
    const idAttr = typeof node.idAttr === "string" && node.idAttr.trim().length > 0
      ? node.idAttr.trim()
      : null;
    if (idAttr !== null) {
      idMap.set(idAttr, node.nodeId);
    }
  }

  for (const node of snapshot.nodes) {
    if (typeof node.forAttr === "string") {
      const target = idMap.get(node.forAttr);
      if (target !== undefined) {
        withEdge(edgeMap, {
          fromNodeId: node.nodeId,
          toNodeId: target,
          relation: "label_for"
        });
      }
    }

    if (Array.isArray(node.ariaControls)) {
      for (const targetId of node.ariaControls) {
        const target = idMap.get(targetId);
        if (target !== undefined) {
          withEdge(edgeMap, {
            fromNodeId: node.nodeId,
            toNodeId: target,
            relation: "aria_controls"
          });
        }
      }
    }

    if (typeof node.href === "string" && node.href.trim().length > 0 && typeof node.parentNodeId === "string") {
      withEdge(edgeMap, {
        fromNodeId: node.parentNodeId,
        toNodeId: node.nodeId,
        relation: "navigation_hint"
      });
    }
  }
};

const resolveTabId = (browserBridge: WorkbenchBrowserIpcBridge, requestedTabId: string | undefined): string => {
  const tabId = typeof requestedTabId === "string" && requestedTabId.trim().length > 0
    ? requestedTabId.trim()
    : browserBridge.readActiveTabId();
  if (tabId === null || tabId.length === 0) {
    throw Object.assign(new Error("tab_not_found"), {
      code: "tab_not_found",
      stage: "precondition",
      retryable: true
    });
  }
  return tabId;
};

export const buildWebGraphSnapshot = async ({
  browserBridge,
  request
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly request?: WorkbenchWebGraphBuildRequest | undefined;
}): Promise<WorkbenchWebGraphSnapshot & { readonly budget: WorkbenchWebGraphBuildBudget }> => {
  const tabId = resolveTabId(browserBridge, request?.tabId);
  const budget = normalizeBudget(request);
  const startedAt = Date.now();
  const nodeMap = new Map<string, FrameExtractSnapshot["nodes"][number]>();
  const edgeMap = new Map<string, WorkbenchWebGraphEdge>();
  let truncated = false;
  let stableRounds = 0;

  const frames = browserBridge
    .listFrames(tabId)
    .slice(0, budget.maxFrames);
  if (frames.length === 0) {
    throw Object.assign(new Error("frame_not_found"), {
      code: "frame_not_found",
      stage: "precondition",
      retryable: true
    });
  }

  const maxNodesPerFrame = Math.max(200, Math.round(budget.maxNodes / Math.max(1, frames.length)));

  const collectFrames = async (): Promise<{ readonly rootByFrame: Map<number, string> }> => {
    const rootByFrame = new Map<number, string>();

    for (const frame of frames) {
      if (Date.now() - startedAt > budget.maxBuildMs) {
        truncated = true;
        break;
      }

      let snapshot: FrameExtractSnapshot;
      try {
        const raw = await browserBridge.executeFrameScript(tabId, {
          frameTreeNodeId: frame.frameTreeNodeId,
          script: buildFrameExtractorScript({
            frameTreeNodeId: frame.frameTreeNodeId,
            maxNodes: maxNodesPerFrame
          }),
          userGesture: false
        });
        snapshot = normalizeFrameExtractSnapshot(frame.frameTreeNodeId, frame.url, raw);
      } catch {
        continue;
      }

      if (snapshot.frameRootNodeId !== undefined) {
        rootByFrame.set(frame.frameTreeNodeId, snapshot.frameRootNodeId);
      }

      for (const node of snapshot.nodes) {
        if (!nodeMap.has(node.nodeId)) {
          nodeMap.set(node.nodeId, node);
        }
      }
      for (const edge of snapshot.edges) {
        withEdge(edgeMap, edge);
      }
      buildMetadataEdgeHints(snapshot, edgeMap);

      if (snapshot.truncated) {
        truncated = true;
      }

      if (nodeMap.size >= budget.maxNodes) {
        truncated = true;
        break;
      }
    }

    for (const frame of frames) {
      if (frame.parentFrameTreeNodeId === undefined) {
        continue;
      }
      const fromNodeId = rootByFrame.get(frame.parentFrameTreeNodeId);
      const toNodeId = rootByFrame.get(frame.frameTreeNodeId);
      if (fromNodeId === undefined || toNodeId === undefined) {
        continue;
      }
      withEdge(edgeMap, {
        fromNodeId,
        toNodeId,
        relation: "frame_embed"
      });
    }

    return { rootByFrame };
  };

  let previousNodeCount = 0;
  let scrollSteps = 0;
  while (true) {
    await collectFrames();
    if (nodeMap.size >= budget.maxNodes) {
      truncated = true;
      break;
    }
    if (Date.now() - startedAt > budget.maxBuildMs) {
      truncated = true;
      break;
    }

    if (nodeMap.size === previousNodeCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      previousNodeCount = nodeMap.size;
    }

    if (stableRounds >= 2) {
      break;
    }
    if (scrollSteps >= budget.maxScrollSteps) {
      break;
    }

    let shouldStopForScroll = false;
    try {
      const scrollResult = await browserBridge.executeFrameScript(tabId, {
        script: buildScrollScript(),
        userGesture: false
      }) as { readonly reachedBottom?: unknown; readonly changed?: unknown };
      const reachedBottom = scrollResult?.reachedBottom === true;
      const changed = scrollResult?.changed !== false;
      if (reachedBottom || changed === false) {
        shouldStopForScroll = true;
      }
    } catch {
      shouldStopForScroll = true;
    }

    scrollSteps += 1;
    if (shouldStopForScroll) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  const nodes = Array.from(nodeMap.values());
  const validNodeIds = new Set(nodes.map((node) => node.nodeId));
  const edges = Array.from(edgeMap.values()).filter((edge) =>
    validNodeIds.has(edge.fromNodeId) && validNodeIds.has(edge.toNodeId)
  );

  const interactableCount = nodes.filter((node) => isInteractable(node)).length;
  const graphId = randomUUID();
  const runtime = browserBridge.readPageState({ tabId });

  const snapshot: WorkbenchWebGraphSnapshot & { readonly budget: WorkbenchWebGraphBuildBudget } = {
    tabId,
    graphId,
    ...(runtime?.address === undefined ? {} : { address: runtime.address }),
    builtAt: Date.now(),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    interactableCount,
    truncated,
    budgetExhausted:
      truncated
      || nodes.length >= budget.maxNodes
      || Date.now() - startedAt >= budget.maxBuildMs,
    nodes,
    edges,
    budget
  };

  return snapshot;
};
