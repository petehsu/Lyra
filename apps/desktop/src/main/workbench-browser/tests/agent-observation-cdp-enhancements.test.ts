import { describe, expect, test } from "vitest";

import {
  applyCdpEnhancementsToElements,
  buildPaintOrderIgnoredBackendIds,
  discoverJsListenerObservationItems,
  filterElementsByParentContainment,
  matchSnapshotNodeForElement,
  visibleByComputedStyles,
  type DomObservationEnhancements,
  type DomSnapshotNodeEnhancement
} from "../view-manager-runtime/agent-observation-cdp-enhancements";
import type { WorkbenchBrowserAgentElement } from "../types";

const snapshotNode = (
  overrides: Partial<DomSnapshotNodeEnhancement> & Pick<DomSnapshotNodeEnhancement, "backendNodeId" | "bounds">
): DomSnapshotNodeEnhancement => ({
  tagName: "button",
  paintOrder: 1,
  computedStyles: {
    display: "block",
    visibility: "visible",
    opacity: "1",
    "pointer-events": "auto"
  },
  attributes: {},
  ignoredByPaintOrder: false,
  visibleByComputedStyles: true,
  hasJsClickListener: false,
  ...overrides
});

const domElement = (
  overrides: Partial<WorkbenchBrowserAgentElement>
): WorkbenchBrowserAgentElement => ({
  id: 1,
  targetRef: "lumen:abc",
  stableId: "abc",
  target: {
    targetRef: "lumen:abc",
    targetKind: "button",
    tabId: "tab-1",
    frameRef: "frame:1",
    frameChain: ["frame:1"],
    elementFingerprint: "fp",
    mapEpoch: 1,
    expiresAt: Date.now() + 60_000
  },
  frameRef: "frame:1",
  elementFingerprint: "fp",
  frameTreeNodeId: 1,
  tagName: "button",
  role: "button",
  label: "Save",
  selectorPreview: "button.save",
  bounds: { x: 10, y: 20, width: 100, height: 32 },
  focusable: true,
  disabled: false,
  editable: false,
  ...overrides
});

describe("agent-observation-cdp-enhancements", () => {
  test("visibleByComputedStyles rejects pointer-events none but keeps hidden file inputs", () => {
    expect(visibleByComputedStyles({
      display: "block",
      visibility: "visible",
      opacity: "1",
      "pointer-events": "none"
    }, "div")).toBe(false);

    expect(visibleByComputedStyles({
      display: "block",
      visibility: "visible",
      opacity: "0",
      type: "file"
    }, "input")).toBe(true);
  });

  test("buildPaintOrderIgnoredBackendIds marks nodes covered by higher paint-order layers", () => {
    const nodes = [
      snapshotNode({
        backendNodeId: 1,
        bounds: { x: 0, y: 0, width: 200, height: 200 },
        paintOrder: 10,
        computedStyles: {
          display: "block",
          opacity: "1",
          "background-color": "rgba(0, 0, 0, 0.8)"
        }
      }),
      snapshotNode({
        backendNodeId: 2,
        bounds: { x: 20, y: 20, width: 80, height: 40 },
        paintOrder: 5
      })
    ];
    const ignored = buildPaintOrderIgnoredBackendIds(nodes);
    expect(ignored.has(2)).toBe(true);
    expect(ignored.has(1)).toBe(false);
  });

  test("applyCdpEnhancementsToElements drops pointer-events none matches", () => {
    const enhancements: DomObservationEnhancements = {
      snapshotNodes: [
        snapshotNode({
          backendNodeId: 9,
          bounds: { x: 10, y: 20, width: 100, height: 32 },
          computedStyles: {
            display: "block",
            visibility: "visible",
            opacity: "1",
            "pointer-events": "none"
          }
        })
      ],
      jsClickListenerBackendIds: new Set(),
      timingMs: 1
    };
    const result = applyCdpEnhancementsToElements([domElement({})], enhancements);
    expect(result.elements).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes("computed-style hidden"))).toBe(true);
  });

  test("filterElementsByParentContainment removes nested children inside buttons", () => {
    const parent = domElement({
      id: 1,
      tagName: "button",
      role: "button",
      bounds: { x: 0, y: 0, width: 120, height: 40 },
      label: "Continue"
    });
    const child = domElement({
      id: 2,
      tagName: "span",
      role: "span",
      bounds: { x: 10, y: 8, width: 40, height: 16 },
      label: "Continue",
      selectorPreview: "span.label"
    });
    const filtered = filterElementsByParentContainment([parent, child]);
    expect(filtered.map((element) => element.id)).toEqual([1]);
  });

  test("discoverJsListenerObservationItems adds unmatched js-listener nodes", () => {
    const enhancements: DomObservationEnhancements = {
      snapshotNodes: [
        snapshotNode({
          backendNodeId: 42,
          tagName: "div",
          bounds: { x: 300, y: 300, width: 80, height: 28 },
          hasJsClickListener: true,
          attributes: { "aria-label": "Open menu" }
        })
      ],
      jsClickListenerBackendIds: new Set([42]),
      timingMs: 1
    };
    const items = discoverJsListenerObservationItems({
      enhancements,
      existingElements: [domElement({ bounds: { x: 10, y: 20, width: 100, height: 32 } })],
      frameTreeNodeId: 1,
      frameRef: "frame:1",
      frameBounds: { x: 0, y: 0, width: 1280, height: 720 },
      frameUrl: "https://example.com",
      startingElementId: 3
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("Open menu");
    expect(items[0]?.selectorPreview).toBe("div[js-listener]");
  });

  test("matchSnapshotNodeForElement matches by overlapping bounds and tag", () => {
    const matched = matchSnapshotNodeForElement(
      domElement({ tagName: "button", bounds: { x: 10, y: 20, width: 100, height: 32 } }),
      [
        snapshotNode({
          backendNodeId: 7,
          tagName: "button",
          bounds: { x: 12, y: 22, width: 96, height: 28 }
        })
      ]
    );
    expect(matched?.backendNodeId).toBe(7);
  });
});