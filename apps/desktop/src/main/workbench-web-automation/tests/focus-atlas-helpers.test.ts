import { describe, expect, test, vi } from "vitest";

import {
  applyFocusAtlasMetadata,
  deriveFocusAtlasLocalDelta,
} from "../service-modules/focus-atlas-helpers";

describe("focus atlas helpers", () => {
  test("applies atlas metadata to candidates and widgets", () => {
    const candidates = [
      {
        candidateId: "candidate-1",
        widgetId: "widget-1"
      }
    ] as any;
    const widgets = [
      {
        widgetId: "widget-1"
      }
    ] as any;
    const atlas = {
      version: "v1",
      activeFocusRegionId: "region-1",
      regions: [
        {
          regionId: "region-1",
          confidence: 0.87,
          widgetIds: ["widget-1"],
          primaryControlId: "focus-node-1",
          bounds: { x: 10, y: 20, width: 300, height: 200 }
        }
      ],
      nodes: [
        {
          candidateId: "candidate-1",
          confidence: 0.95,
          focusNodeId: "focus-node-1",
          focusOrder: 2,
          focusRegionId: "region-1"
        }
      ]
    } as any;

    const result = applyFocusAtlasMetadata({
      candidates,
      widgets,
      atlas
    });

    expect(result.candidates[0]).toMatchObject({
      candidateId: "candidate-1",
      focusOrder: 2,
      focusRegionId: "region-1",
      atlasConfidence: 1,
      inActiveFocusRegion: true
    });
    expect(result.widgets[0]).toMatchObject({
      widgetId: "widget-1",
      focusRegionId: "region-1",
      atlasConfidence: 0.87
    });
  });

  test("derives local delta for region change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T00:00:00.000Z"));

    const delta = deriveFocusAtlasLocalDelta({
      previousSession: {
        activeFocusRegionId: "region-old",
        focusAtlasVersion: "v1"
      } as any,
      atlas: {
        version: "v2",
        activeFocusRegionId: "region-new",
        regions: [
          {
            regionId: "region-new",
            bounds: { x: 0, y: 0, width: 100, height: 50 }
          }
        ]
      } as any
    });

    expect(delta).toMatchObject({
      kinds: ["focus_region_changed", "focus_group_changed"],
      workflowRegion: { x: 0, y: 0, width: 100, height: 50 }
    });
    expect(delta?.observedAt).toBe(Date.now());

    vi.useRealTimers();
  });

  test("derives group change when atlas version changes only", () => {
    const delta = deriveFocusAtlasLocalDelta({
      previousSession: {
        activeFocusRegionId: "region-1",
        focusAtlasVersion: "v1"
      } as any,
      atlas: {
        version: "v2",
        activeFocusRegionId: "region-1",
        regions: [
          {
            regionId: "region-1",
            bounds: { x: 1, y: 2, width: 3, height: 4 }
          }
        ]
      } as any
    });

    expect(delta?.kinds).toEqual(["focus_group_changed"]);
    expect(delta?.workflowRegion).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  test("returns undefined when previous session is missing", () => {
    expect(deriveFocusAtlasLocalDelta({
      previousSession: null,
      atlas: { version: "v1", regions: [] } as any
    })).toBeUndefined();
  });
});
