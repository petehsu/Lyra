import { describe, expect, test } from "vitest";

import {
  LumenTargetRegistry,
  createLumenTargetIdentity
} from "../lumen-target-registry";
import type { WorkbenchBrowserAgentElement } from "../types";

const createElement = ({
  tabId = "browser-tab-1",
  id,
  label,
  x = 10,
  y = 20,
  mapEpoch = 1,
  now = 1_000,
  pageUrl = "https://example.com"
}: {
  readonly tabId?: string;
  readonly id: number;
  readonly label: string;
  readonly x?: number;
  readonly y?: number;
  readonly mapEpoch?: number;
  readonly now?: number;
  readonly pageUrl?: string;
}): WorkbenchBrowserAgentElement => {
  const base = {
    id,
    frameTreeNodeId: 1,
    tagName: "button",
    role: "button",
    label,
    selectorPreview: `button[data-label="${label}"]`,
    bounds: { x, y, width: 120, height: 32 },
    focusable: true,
    disabled: false,
    editable: false,
    discoveryScope: "document" as const,
    frameUrl: pageUrl
  };
  const identity = createLumenTargetIdentity({
    tabId,
    pageUrl,
    mapEpoch,
    element: base,
    now
  });
  return {
    ...base,
    stableId: identity.stableId,
    targetRef: identity.targetRef,
    frameRef: identity.frameRef,
    elementFingerprint: identity.elementFingerprint,
    target: identity.target
  };
};

describe("LumenTargetRegistry", () => {
  test("does not accept a workbench tab id as a targetRef", () => {
    const registry = new LumenTargetRegistry();

    const result = registry.resolveTargetRef("browser-tab-1", "live", "browser-tab-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.staleTarget.reason).toBe("invalidRef");
      expect(result.staleTarget.recommendedAction).toBe("lyra_lumen_explain_target");
    }
  });

  test("keeps numeric element ids observation-local and stale after navigation", () => {
    const registry = new LumenTargetRegistry();
    const element = createElement({ id: 3, label: "Search" });
    registry.registerObservation({
      tabId: "browser-tab-1",
      targetMode: "live",
      observationId: "obs-1",
      mapEpoch: 1,
      url: "https://example.com",
      title: "Example",
      elements: [element],
      observedAt: 1_000
    });

    expect(registry.resolveElementId("browser-tab-1", "live", 3).ok).toBe(true);

    registry.invalidateTab("browser-tab-1", "live", "navigation");
    const stale = registry.resolveElementId("browser-tab-1", "live", 3);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.staleTarget.reason).toBe("navigation");
    }
  });

  test("returns stale target reason and nearest rebind candidates across map epochs", () => {
    const registry = new LumenTargetRegistry();
    const before = createElement({ id: 1, label: "Delete", x: 10, mapEpoch: 1 });
    registry.registerObservation({
      tabId: "browser-tab-1",
      targetMode: "live",
      observationId: "obs-1",
      mapEpoch: 1,
      url: "https://example.com",
      title: "Example",
      elements: [before],
      observedAt: 1_000
    });

    const after = createElement({ id: 1, label: "Delete", x: 260, mapEpoch: 2, now: 2_000 });
    registry.registerObservation({
      tabId: "browser-tab-1",
      targetMode: "live",
      observationId: "obs-2",
      mapEpoch: 2,
      url: "https://example.com",
      title: "Example",
      elements: [after],
      observedAt: 2_000
    });

    const stale = registry.resolveTargetRef("browser-tab-1", "live", before.targetRef, 2_000);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.staleTarget.reason).toBe("mapEpochReplaced");
      expect(stale.staleTarget.nearestCandidates[0]).toMatchObject({
        targetRef: after.targetRef,
        label: "Delete",
        reason: "probable-rebind"
      });
    }

    expect(registry.explainTargetRef({
      tabId: "browser-tab-1",
      targetMode: "live",
      targetRef: before.targetRef,
      now: 2_000
    })).toMatchObject({
      kind: "lyraLumenTargetExplanation",
      available: false,
      staleTarget: {
        reason: "mapEpochReplaced"
      }
    });
  });
});
