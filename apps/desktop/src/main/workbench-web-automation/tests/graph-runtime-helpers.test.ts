import { describe, expect, test, vi } from "vitest";

import type {
  WorkbenchWebElementNode,
  WorkbenchWebGraphEdge,
} from "../../../shared/workbench-web-automation";
import { WorkbenchWebAutomationCache } from "../cache";
import {
  buildResultFromSnapshot,
  ensureGraphLoaded,
  queryGraphSnapshot,
} from "../service-modules/graph-runtime-helpers";

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

const makeSnapshot = (args?: {
  readonly tabId?: string;
  readonly graphId?: string;
  readonly nodes?: readonly WorkbenchWebElementNode[];
  readonly edges?: readonly WorkbenchWebGraphEdge[];
}) => {
  const nodes = args?.nodes ?? [makeNode({ nodeId: "node-1" })];
  const edges = args?.edges ?? [];
  return {
    tabId: args?.tabId ?? "tab-1",
    graphId: args?.graphId ?? "graph-1",
    builtAt: 1,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    interactableCount: nodes.filter((node) => node.interactable.clickable || node.interactable.typable).length,
    truncated: false,
    budgetExhausted: false,
    nodes,
    edges
  };
};

describe("graph runtime helpers", () => {
  test("buildResultFromSnapshot returns summary and full variants", () => {
    const snapshot = {
      ...makeSnapshot(),
      budget: {
        maxNodes: 128,
        maxFrames: 8,
        maxScrollSteps: 2,
        maxBuildMs: 500
      }
    };

    const summary = buildResultFromSnapshot(snapshot as any, "summary");
    const full = buildResultFromSnapshot(snapshot as any, "full");

    expect(summary.detail).toBe("summary");
    expect(summary.nodes).toBeUndefined();
    expect(full.detail).toBe("full");
    expect(full.nodes?.length).toBe(1);
    expect(full.highlights).toBeDefined();
  });

  test("queryGraphSnapshot filters and ranks by action/text", () => {
    const nodes = [
      makeNode({
        nodeId: "input",
        tagName: "input",
        textSnippet: "Search projects",
        interactable: {
          clickable: true,
          typable: true,
          selectable: false,
          focusable: true,
          scrollable: false
        }
      }),
      makeNode({
        nodeId: "button",
        tagName: "button",
        textSnippet: "Run",
        stableSignature: {
          tagName: "button",
          ariaLabel: "Run command"
        },
        interactable: {
          clickable: true,
          typable: false,
          selectable: false,
          focusable: true,
          scrollable: false
        }
      })
    ];
    const edges = [
      {
        fromNodeId: "input",
        toNodeId: "button",
        relation: "dom_child"
      }
    ] as const;

    const result = queryGraphSnapshot({
      snapshot: makeSnapshot({ nodes, edges }),
      request: {
        action: "click",
        textContains: "run",
        maxResults: 5
      }
    });

    expect(result.totalMatched).toBe(1);
    expect(result.bestNode?.nodeId).toBe("button");
    expect(result.nodes.map((node) => node.nodeId)).toEqual(["button"]);
    expect(result.edges).toEqual([]);
  });

  test("ensureGraphLoaded returns graph from cache by graph id", async () => {
    const cache = new WorkbenchWebAutomationCache();
    const snapshot = makeSnapshot({ tabId: "tab-cache", graphId: "graph-cache" }) as any;
    cache.graphById.write(snapshot.graphId, snapshot);

    const store = {
      readByGraphId: vi.fn(),
      readLatestByTab: vi.fn(),
      write: vi.fn()
    };
    const deps = { browserBridge: {} } as any;

    const loaded = await ensureGraphLoaded({
      tabId: "tab-cache",
      graphId: "graph-cache",
      deps,
      cache,
      store: store as any
    });

    expect(loaded).toBe(snapshot);
    expect(store.readByGraphId).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });

  test("ensureGraphLoaded reads from store by graph id and hydrates cache", async () => {
    const cache = new WorkbenchWebAutomationCache();
    const snapshot = makeSnapshot({ tabId: "tab-store", graphId: "graph-store" }) as any;

    const store = {
      readByGraphId: vi.fn(async () => snapshot),
      readLatestByTab: vi.fn(async () => null),
      write: vi.fn()
    };
    const deps = { browserBridge: {} } as any;

    const loaded = await ensureGraphLoaded({
      tabId: "tab-store",
      graphId: "graph-store",
      deps,
      cache,
      store: store as any
    });

    expect(loaded).toEqual(snapshot);
    expect(store.readByGraphId).toHaveBeenCalledWith("graph-store");
    expect(cache.graphById.read("graph-store")).toEqual(snapshot);
    expect(cache.graphByTab.read("tab-store")).toEqual(snapshot);
  });
});
