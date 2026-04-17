import { describe, expect, test } from "vitest";

import { buildLayoutIntelligenceSnapshot } from "../layout-intelligence/widget-graph";
import type { LayoutInteractiveRecord } from "../layout-intelligence/types";

const makeCandidate = (
  candidateId: string,
  overrides: Partial<LayoutInteractiveRecord>
): LayoutInteractiveRecord => ({
  candidateId,
  frameTreeNodeId: 1,
  tagName: "div",
  selectorPreview: `div[data-id="${candidateId}"]`,
  visibilityState: "visible",
  interactable: {
    clickable: true,
    typable: false,
    selectable: false,
    focusable: true
  },
  bounds: {
    x: 20,
    y: 20,
    width: 200,
    height: 36
  },
  selectorAddress: {
    frameTreeNodeId: 1,
    path: `r/d:${candidateId}`
  },
  stableSignature: {
    tagName: "div"
  },
  documentOrder: 0,
  ...overrides
});

describe("buildLayoutIntelligenceSnapshot", () => {
  test("classifies chat history rows as list items with trailing menu triggers", () => {
    const historyContainer = {
      selectorAddress: {
        frameTreeNodeId: 1,
        path: "r/d:history"
      },
      tagName: "nav",
      role: "navigation",
      label: "history",
      selectorPreview: "nav.history",
      bounds: {
        x: 0,
        y: 0,
        width: 320,
        height: 720
      }
    };
    const composerContainer = {
      selectorAddress: {
        frameTreeNodeId: 1,
        path: "r/d:composer"
      },
      tagName: "section",
      role: "form",
      label: "chat",
      selectorPreview: "section.composer",
      bounds: {
        x: 320,
        y: 520,
        width: 720,
        height: 180
      }
    };

    const snapshot = buildLayoutIntelligenceSnapshot({
      scope: "visible",
      candidates: [
        makeCandidate("row1-label", {
          tagName: "button",
          textSnippet: "Conversation A",
          bounds: { x: 16, y: 120, width: 200, height: 34 },
          containerHint: historyContainer
        }),
        makeCandidate("row1-menu", {
          tagName: "button",
          role: "button",
          ariaLabel: "Open conversation options",
          bounds: { x: 248, y: 118, width: 36, height: 36 },
          containerHint: historyContainer
        }),
        makeCandidate("row2-label", {
          tagName: "button",
          textSnippet: "Conversation B",
          bounds: { x: 16, y: 170, width: 200, height: 34 },
          containerHint: historyContainer
        }),
        makeCandidate("row2-menu", {
          tagName: "button",
          role: "button",
          ariaLabel: "Open conversation options",
          bounds: { x: 248, y: 168, width: 36, height: 36 },
          containerHint: historyContainer
        }),
        makeCandidate("composer-field", {
          tagName: "textarea",
          role: "textbox",
          textSnippet: "",
          interactable: {
            clickable: true,
            typable: true,
            selectable: false,
            focusable: true
          },
          bounds: { x: 360, y: 560, width: 520, height: 72 },
          containerHint: composerContainer
        }),
        makeCandidate("composer-send", {
          tagName: "button",
          role: "button",
          ariaLabel: "Send message",
          bounds: { x: 900, y: 590, width: 44, height: 44 },
          containerHint: composerContainer
        })
      ]
    });

    expect(snapshot.pageMode).toBe("chat");
    expect(snapshot.widgets.some((widget) => widget.kind === "history-list")).toBe(true);
    expect(snapshot.widgets.filter((widget) => widget.kind === "history-item")).toHaveLength(2);
    expect(snapshot.widgets.some((widget) =>
      widget.kind === "composer" || widget.kind === "chat-composer"
    )).toBe(true);
    expect(snapshot.candidates.find((candidate) => candidate.candidateId === "row1-menu")?.widgetKind).toBe("menu-trigger");
    expect(snapshot.candidates.find((candidate) => candidate.candidateId === "row1-menu")?.itemIdentity?.label).toBe("Conversation A");
  });

  test("classifies a collapsed left rail as sidebar and preserves chat mode", () => {
    const sidebarContainer = {
      selectorAddress: {
        frameTreeNodeId: 1,
        path: "r/d:sidebar"
      },
      tagName: "div",
      label: "panel",
      selectorPreview: "div.sidebar-rail",
      bounds: {
        x: 0,
        y: 0,
        width: 52,
        height: 680
      }
    };
    const composerContainer = {
      selectorAddress: {
        frameTreeNodeId: 1,
        path: "r/d:composer"
      },
      tagName: "div",
      label: "chat",
      selectorPreview: "div.chat-composer",
      bounds: {
        x: 280,
        y: 560,
        width: 640,
        height: 120
      }
    };

    const snapshot = buildLayoutIntelligenceSnapshot({
      scope: "visible",
      candidates: [
        makeCandidate("open-sidebar", {
          tagName: "button",
          ariaLabel: "Open sidebar",
          affordanceLabel: "Open sidebar",
          affordanceAction: "expand",
          cursorStyle: "e-resize",
          stateHint: "collapsed",
          bounds: { x: 8, y: 8, width: 36, height: 36 },
          containerHint: sidebarContainer
        }),
        makeCandidate("new-chat", {
          tagName: "a",
          textSnippet: "New chat",
          affordanceLabel: "New chat",
          affordanceAction: "open menu",
          bounds: { x: 8, y: 60, width: 36, height: 36 },
          containerHint: sidebarContainer
        }),
        makeCandidate("search-chats", {
          tagName: "button",
          textSnippet: "Search chats",
          affordanceLabel: "Search chats",
          affordanceAction: "open menu",
          bounds: { x: 8, y: 104, width: 36, height: 36 },
          containerHint: sidebarContainer
        }),
        makeCandidate("composer-field", {
          tagName: "textarea",
          role: "textbox",
          ariaLabel: "Message ChatGPT",
          placeholder: "Message ChatGPT",
          interactable: {
            clickable: true,
            typable: true,
            selectable: false,
            focusable: true
          },
          bounds: { x: 320, y: 588, width: 520, height: 72 },
          containerHint: composerContainer
        })
      ]
    });

    expect(snapshot.pageMode).toBe("chat");
    expect(snapshot.widgets.some((widget) => widget.kind === "sidebar")).toBe(true);
    expect(snapshot.widgets.some((widget) =>
      widget.kind === "composer" || widget.kind === "chat-composer"
    )).toBe(true);
    expect(snapshot.candidates.find((candidate) => candidate.candidateId === "open-sidebar")?.widgetKind).toBe("sidebar");
  });
});
