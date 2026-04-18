import { describe, expect, test } from "vitest";

import { WorkbenchWebAutomationCache } from "../cache";
import { createWorkbenchWebServiceGuards } from "../service-modules/service-guards";

const createErrorFactory = (...args: any[]) =>
  Object.assign(new Error(String(args[1] ?? "error")), {
    code: args[0],
    details: args[4]?.details
  });

const buildDeps = (overrides?: {
  readonly activeTabId?: string | null;
  readonly visible?: boolean;
}) =>
  ({
    browserBridge: {
      readActiveTabId: () => (overrides?.activeTabId === undefined ? "tab-active" : overrides.activeTabId),
      readPageState: ({ tabId }: { readonly tabId: string }) => ({
        isVisible: (overrides?.visible ?? true) && tabId === (overrides?.activeTabId === undefined ? "tab-active" : overrides.activeTabId)
      })
    }
  }) as any;

describe("service guards", () => {
  const guards = createWorkbenchWebServiceGuards({
    createWebAutomationError: createErrorFactory,
    safeActions: new Set(["hover", "focus"]),
    mutateActions: new Set(["click", "type"]),
    navigateActions: new Set(["goto_url"])
  });

  test("resolveTabId returns explicit non-alias tab id", () => {
    const tabId = guards.resolveTabId(buildDeps(), "  tab-2 ");
    expect(tabId).toBe("tab-2");
  });

  test("resolveTabId falls back to active tab for alias", () => {
    const tabId = guards.resolveTabId(buildDeps(), "active-tab");
    expect(tabId).toBe("tab-active");
  });

  test("resolveTabId throws when active tab is missing", () => {
    expect(() => guards.resolveTabId(buildDeps({ activeTabId: null })))
      .toThrow("active page tab not found");
  });

  test("assertActiveVisiblePage throws on inactive or hidden tab", () => {
    expect(() => guards.assertActiveVisiblePage(buildDeps({ visible: false }), "tab-active"))
      .toThrow("active visible page tab");
    expect(() => guards.assertActiveVisiblePage(buildDeps({ activeTabId: "tab-a" }), "tab-b"))
      .toThrow("active visible page tab");
  });

  test("assertActionAllowed enforces mode policy", () => {
    expect(() =>
      guards.assertActionAllowed({ action: { kind: "click" } } as any, "mutate")
    ).not.toThrow();
    expect(() =>
      guards.assertActionAllowed({ action: { kind: "click" } } as any, "safe")
    ).toThrow("not allowed in safe mode");
  });

  test("invalidateTabGraphCache clears tab and graph entries", () => {
    const cache = new WorkbenchWebAutomationCache();
    const snapshot = {
      tabId: "tab-1",
      graphId: "graph-1",
      builtAt: 1,
      nodeCount: 1,
      edgeCount: 0,
      interactableCount: 1,
      truncated: false,
      budgetExhausted: false,
      nodes: [{}],
      edges: []
    } as any;
    cache.graphByTab.write(snapshot.tabId, snapshot);
    cache.graphById.write(snapshot.graphId, snapshot);

    guards.invalidateTabGraphCache(cache, "tab-1", "graph-1");

    expect(cache.graphByTab.read("tab-1")).toBeNull();
    expect(cache.graphById.read("graph-1")).toBeNull();
  });
});
