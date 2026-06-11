import { afterEach, describe, expect, test, vi } from "vitest";

import { createLumenTargetIdentity } from "../lumen-target-registry";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentObservation
} from "../types";
import { createBrowserAgentStateStore } from "../view-manager-runtime/agent-state-store";

const createElement = ({
  id,
  label,
  editable = false,
  mapEpoch = 1,
  now = 1_000,
  pageUrl = "https://example.test"
}: {
  readonly id: number;
  readonly label: string;
  readonly editable?: boolean;
  readonly mapEpoch?: number;
  readonly now?: number;
  readonly pageUrl?: string;
}): WorkbenchBrowserAgentElement => {
  const base = {
    id,
    frameTreeNodeId: 1,
    frameRef: "frame:1:root",
    tagName: editable ? "input" : "button",
    role: editable ? "textbox" : "button",
    label,
    selectorPreview: editable ? "input[name=q]" : `button[data-label="${label}"]`,
    bounds: { x: 10, y: 20, width: 120, height: 32 },
    focusable: true,
    disabled: false,
    editable,
    discoveryScope: "document" as const,
    ...(editable ? { actionHint: "type" } : {})
  };
  const identity = createLumenTargetIdentity({
    tabId: "browser-tab-1",
    pageUrl,
    mapEpoch,
    element: base,
    now
  });
  return {
    ...base,
    stableId: identity.stableId,
    targetRef: identity.targetRef,
    target: identity.target,
    elementFingerprint: identity.elementFingerprint
  };
};

const createObservation = ({
  observationId = "obs-1",
  mapEpoch = 1,
  elements,
  activeElementId = null
}: {
  readonly observationId?: string;
  readonly mapEpoch?: number;
  readonly elements: readonly WorkbenchBrowserAgentElement[];
  readonly activeElementId?: number | null;
}): WorkbenchBrowserAgentObservation => ({
  ok: true,
  kind: "lyraLumenMap",
  tabId: "browser-tab-1",
  targetMode: "live",
  observationId,
  mapEpoch,
  strategy: "interactiveOnly",
  url: "https://example.test",
  title: "Example",
  targets: elements.map((element) => element.target),
  elements,
  activeElementId,
  focusOrder: elements.filter((element) => element.focusable).map((element) => element.id)
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BrowserAgentStateStore", () => {
  test("registers observations and resolves targets through the store facade", () => {
    const store = createBrowserAgentStateStore();
    const element = createElement({ id: 3, label: "Search" });
    const observation = createObservation({ elements: [element] });

    store.rememberBrowserAgentObservation("browser-tab-1", "live", observation);
    store.registerTargetObservation({
      tabId: "browser-tab-1",
      targetMode: "live",
      observationId: observation.observationId,
      mapEpoch: observation.mapEpoch,
      url: observation.url,
      title: observation.title,
      elements: observation.elements,
      observedAt: 1_000
    });

    expect(store.readBrowserAgentCacheEntry("browser-tab-1", "live")?.observationId).toBe("obs-1");
    expect(store.resolveElementId("browser-tab-1", "live", 3).ok).toBe(true);
    expect(store.resolveTargetRef("browser-tab-1", "live", element.targetRef, 1_000).ok).toBe(true);
    expect(store.explainTargetRef({
      tabId: "browser-tab-1",
      targetMode: "live",
      targetRef: element.targetRef,
      now: 1_000
    })).toMatchObject({
      ok: true,
      available: true,
      targetRef: element.targetRef
    });
  });

  test("invalidates observation and editable caches together", () => {
    const store = createBrowserAgentStateStore();
    const element = createElement({ id: 1, label: "Query", editable: true });
    const observation = createObservation({ elements: [element], activeElementId: 1 });

    store.rememberBrowserAgentObservation("browser-tab-1", "live", observation);
    store.registerTargetObservation({
      tabId: "browser-tab-1",
      targetMode: "live",
      observationId: observation.observationId,
      mapEpoch: observation.mapEpoch,
      url: observation.url,
      title: observation.title,
      elements: observation.elements,
      observedAt: 1_000
    });
    store.cacheBrowserAgentInputTarget("browser-tab-1", "live", element, observation.url, observation.observationId);

    expect(store.readCachedBrowserAgentInputTarget("browser-tab-1", "live", observation.url)?.element.id).toBe(1);

    store.invalidateBrowserAgentTargets("browser-tab-1", "live", "navigation");

    expect(store.readBrowserAgentCacheEntry("browser-tab-1", "live")).toBeUndefined();
    expect(store.readCachedBrowserAgentInputTarget("browser-tab-1", "live", observation.url)).toBeNull();
    const stale = store.resolveTargetRef("browser-tab-1", "live", element.targetRef, 1_000);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.staleTarget.reason).toBe("navigation");
    }
  });

  test("expires editable fallback targets after the local ttl", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const store = createBrowserAgentStateStore();
    const element = createElement({ id: 1, label: "Email", editable: true, now: 1_000 });

    store.cacheBrowserAgentInputTarget("browser-tab-1", "live", element, "https://example.test", "obs-1");
    expect(store.readCachedBrowserAgentInputTarget("browser-tab-1", "live", "https://example.test")?.observationId)
      .toBe("obs-1");

    vi.setSystemTime(1_000 + 5 * 60_000 + 1);

    expect(store.readCachedBrowserAgentInputTarget("browser-tab-1", "live", "https://example.test")).toBeNull();
  });
});
