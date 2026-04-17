import { describe, expect, test } from "vitest";

import type {
  WorkbenchWebWidgetDescriptor,
} from "../../../shared/workbench-web-automation";
import { buildFocusAtlas } from "../focus-atlas/build";
import type { LayoutIntelligenceSnapshot, LayoutInteractiveRecord } from "../layout-intelligence/types";

const makeCandidate = (
  candidateId: string,
  overrides: Partial<LayoutInteractiveRecord>
): LayoutInteractiveRecord => ({
  candidateId,
  frameTreeNodeId: 1,
  tagName: "button",
  selectorPreview: `button[data-id="${candidateId}"]`,
  visibilityState: "visible",
  interactable: {
    clickable: true,
    typable: false,
    selectable: false,
    focusable: true
  },
  bounds: {
    x: 16,
    y: 16,
    width: 40,
    height: 40
  },
  selectorAddress: {
    frameTreeNodeId: 1,
    path: `r/d:${candidateId}`
  },
  stableSignature: {
    tagName: "button"
  },
  isHumanOperable: true,
  documentOrder: 0,
  ...overrides
});

const makeWidget = (
  widgetId: string,
  overrides: Partial<WorkbenchWebWidgetDescriptor>
): WorkbenchWebWidgetDescriptor => ({
  widgetId,
  kind: "navigation",
  frameTreeNodeId: 1,
  selectorPreview: `widget:${widgetId}`,
  bounds: {
    x: 0,
    y: 0,
    width: 72,
    height: 520
  },
  memberNodeIds: [],
  ...overrides
});

describe("buildFocusAtlas", () => {
  test("marks collapsed navigation as the active focus region and prefers expand control", () => {
    const sidebarWidget = makeWidget("sidebar", {
      kind: "navigation",
      stateHint: "collapsed",
      label: "sidebar"
    });
    const composerWidget = makeWidget("composer", {
      kind: "chat-composer",
      bounds: {
        x: 240,
        y: 540,
        width: 640,
        height: 160
      }
    });
    const snapshot: LayoutIntelligenceSnapshot = {
      pageMode: "chat",
      layoutNodes: [],
      containerNodes: [],
      widgets: [sidebarWidget, composerWidget],
      candidates: [
        makeCandidate("sidebar-toggle", {
          widgetId: "sidebar",
          widgetKind: "navigation",
          ariaLabel: "Open sidebar",
          affordanceAction: "expand",
          bounds: { x: 16, y: 20, width: 36, height: 36 },
          documentOrder: 0
        }),
        makeCandidate("new-chat", {
          widgetId: "sidebar",
          widgetKind: "navigation",
          textSnippet: "New chat",
          bounds: { x: 16, y: 80, width: 36, height: 36 },
          documentOrder: 1
        }),
        makeCandidate("composer-field", {
          widgetId: "composer",
          widgetKind: "chat-composer",
          tagName: "textarea",
          role: "textbox",
          textSnippet: "",
          interactable: {
            clickable: true,
            typable: true,
            selectable: false,
            focusable: true
          },
          bounds: { x: 280, y: 580, width: 520, height: 72 },
          documentOrder: 2
        })
      ]
    };

    const { atlas } = buildFocusAtlas({ tabId: "browser-tab-1", snapshot });
    const activeRegion = atlas.regions.find((region) => region.regionId === atlas.activeFocusRegionId);
    const primaryNode = atlas.nodes.find((node) => node.focusNodeId === activeRegion?.primaryControlId);

    expect(activeRegion?.collapsed).toBe(true);
    expect(primaryNode?.candidateId).toBe("sidebar-toggle");
    expect(atlas.skeleton.some((entry) => entry.includes("sidebar"))).toBe(true);
  });

  test("uses positive tabindex before later document order in computed focus order", () => {
    const snapshot: LayoutIntelligenceSnapshot = {
      pageMode: "form",
      layoutNodes: [],
      containerNodes: [],
      widgets: [
        makeWidget("form", {
          kind: "form",
          bounds: { x: 80, y: 80, width: 520, height: 280 }
        })
      ],
      candidates: [
        makeCandidate("later-tab", {
          widgetId: "form",
          widgetKind: "form",
          textSnippet: "Later",
          tabIndex: 4,
          documentOrder: 10
        }),
        makeCandidate("earlier-tab", {
          widgetId: "form",
          widgetKind: "form",
          textSnippet: "Earlier",
          tabIndex: 1,
          documentOrder: 20
        })
      ]
    };

    const { atlas } = buildFocusAtlas({ tabId: "browser-tab-2", snapshot });
    const earlier = atlas.nodes.find((node) => node.candidateId === "earlier-tab");
    const later = atlas.nodes.find((node) => node.candidateId === "later-tab");

    expect(earlier?.focusOrder).toBeLessThan(later?.focusOrder ?? Number.MAX_SAFE_INTEGER);
  });

  test("treats a collapsed left rail toggle-group as the active focus region", () => {
    const collapsedRail = makeWidget("rail", {
      kind: "toggle-group",
      stateHint: "collapsed",
      bounds: {
        x: 6,
        y: 8,
        width: 40,
        height: 620
      }
    });
    const snapshot: LayoutIntelligenceSnapshot = {
      pageMode: "chat",
      layoutNodes: [],
      containerNodes: [],
      widgets: [collapsedRail],
      candidates: [
        makeCandidate("open-sidebar", {
          widgetId: "rail",
          widgetKind: "toggle-group",
          ariaLabel: "Open sidebar",
          affordanceAction: "expand",
          cursorStyle: "e-resize",
          bounds: { x: 8, y: 8, width: 36, height: 36 },
          documentOrder: 0
        }),
        makeCandidate("new-chat", {
          widgetId: "rail",
          widgetKind: "toggle-group",
          textSnippet: "New chat",
          bounds: { x: 8, y: 60, width: 36, height: 36 },
          documentOrder: 1
        })
      ]
    };

    const { atlas } = buildFocusAtlas({ tabId: "browser-tab-3", snapshot });
    const activeRegion = atlas.regions.find((region) => region.regionId === atlas.activeFocusRegionId);
    const primaryNode = atlas.nodes.find((node) => node.focusNodeId === activeRegion?.primaryControlId);

    expect(activeRegion?.collapsed).toBe(true);
    expect(primaryNode?.candidateId).toBe("open-sidebar");
  });
});
