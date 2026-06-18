import { describe, expect, test } from "vitest";

import type { WorkbenchBrowserAgentElement, WorkbenchBrowserAgentObservation } from "../types";
import { compactMapObservation } from "../view-manager-runtime/agent-map-compaction";

const element = (
  overrides: Partial<WorkbenchBrowserAgentElement> = {}
): WorkbenchBrowserAgentElement => ({
  id: 1,
  targetRef: "lumen:a",
  stableId: "a",
  target: {
    targetRef: "lumen:a",
    targetKind: "button",
    frameRef: "lumen-frame:1",
    frameChain: ["lumen-frame:1"],
    elementFingerprint: "fp",
    mapEpoch: 1,
    expiresAt: Date.now() + 60_000
  },
  frameRef: "lumen-frame:1",
  elementFingerprint: "fp",
  frameTreeNodeId: 1,
  tagName: "button",
  role: "button",
  label: "Save",
  selectorPreview: "button#save",
  bounds: { x: 10, y: 20, width: 80, height: 32 },
  focusable: true,
  disabled: false,
  editable: false,
  ...overrides
});

const observation = (
  elements: readonly WorkbenchBrowserAgentElement[],
  observationId: string
): WorkbenchBrowserAgentObservation => ({
  ok: true,
  kind: "lyraLumenMap",
  tabId: "tab-1",
  targetMode: "live",
  observationId,
  mapEpoch: 1,
  strategy: "interactiveOnly",
  url: "https://example.test/app",
  title: "App",
  targets: [],
  elements,
  activeElementId: null,
  focusOrder: []
});

describe("agent-map-compaction", () => {
  test("compactMapObservation summarizes repeated maps as delta", () => {
    const previous = observation([element()], "obs-1");
    const next = observation([
      element(),
      element({
        id: 2,
        targetRef: "lumen:b",
        label: "Cancel",
        selectorPreview: "button#cancel"
      })
    ], "obs-2");

    const compacted = compactMapObservation(previous, next);
    expect(compacted.compaction?.addedCount).toBe(1);
    expect(compacted.compaction?.unchangedCount).toBe(1);
    expect(compacted.observation.mapCompaction?.summary).toContain("1 added");
  });
});