import { describe, expect, test } from "vitest";

import { rankLiveSelectorCandidates } from "../live-selector/candidate-ranker";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

const baseCandidate = (
  overrides: Partial<LiveSelectorScanCandidateRecord>
): LiveSelectorScanCandidateRecord => ({
  candidateId: "candidate",
  frameTreeNodeId: 1,
  tagName: "div",
  selectorPreview: "div",
  visibilityState: "visible",
  interactable: {
    clickable: true,
    typable: false,
    selectable: false,
    focusable: true
  },
  bounds: {
    x: 100,
    y: 120,
    width: 120,
    height: 36
  },
  score: 0,
  selectorAddress: {
    frameTreeNodeId: 1,
    path: "r/d:1"
  },
  stableSignature: {
    tagName: "div"
  },
  ...overrides
});

describe("rankLiveSelectorCandidates", () => {
  test("prefers clickable menu-like targets for hover intents", () => {
    const menuButton = baseCandidate({
      candidateId: "menu-button",
      tagName: "button",
      role: "button",
      ariaLabel: "Conversation options",
      bounds: {
        x: 240,
        y: 120,
        width: 38,
        height: 36
      }
    });
    const textInput = baseCandidate({
      candidateId: "text-input",
      tagName: "textarea",
      role: "textbox",
      interactable: {
        clickable: true,
        typable: true,
        selectable: false,
        focusable: true
      },
      bounds: {
        x: 120,
        y: 300,
        width: 600,
        height: 72
      }
    });

    const ranked = rankLiveSelectorCandidates(
      [textInput, menuButton],
      {
        operation: "hover",
        desiredTags: ["button", "div"],
        desiredRoles: ["button", "menuitem"],
        textHints: ["options", "more"]
      }
    );

    expect(ranked[0]?.candidateId).toBe("menu-button");
  });

  test("prefers hover-revealed local controls over unrelated global controls", () => {
    const globalToolbarButton = baseCandidate({
      candidateId: "global-share",
      tagName: "button",
      role: "button",
      ariaLabel: "Share",
      bounds: {
        x: 820,
        y: 82,
        width: 40,
        height: 36
      }
    });
    const revealedRowMenu = baseCandidate({
      candidateId: "row-menu",
      tagName: "button",
      role: "button",
      ariaLabel: "Open conversation options",
      discoveryMode: "hover_revealed",
      widgetKind: "menu-trigger",
      ownerWidgetId: "row-1",
      itemIdentity: {
        label: "Conversation A",
        title: "Conversation A"
      },
      bounds: {
        x: 246,
        y: 122,
        width: 38,
        height: 36
      }
    });

    const ranked = rankLiveSelectorCandidates(
      [globalToolbarButton, revealedRowMenu],
      {
        operation: "click",
        desiredTags: ["button"],
        desiredRoles: ["button", "menuitem"],
        textHints: ["options", "menu"]
      }
    );

    expect(ranked[0]?.candidateId).toBe("row-menu");
  });

  test("does not rank non-typable sidebar items ahead of a real composer target", () => {
    const sidebarItem = baseCandidate({
      candidateId: "sidebar-item",
      tagName: "a",
      role: "link",
      ariaLabel: "Deep research",
      textSnippet: "Deep research",
      widgetKind: "list-item",
      interactable: {
        clickable: true,
        typable: false,
        selectable: false,
        focusable: true
      },
      bounds: {
        x: 12,
        y: 196,
        width: 248,
        height: 36
      }
    });
    const composer = baseCandidate({
      candidateId: "composer",
      tagName: "textarea",
      role: "textbox",
      ariaLabel: "Send a message",
      placeholder: "Message ChatGPT",
      widgetKind: "chat-composer",
      interactable: {
        clickable: true,
        typable: true,
        selectable: false,
        focusable: true
      },
      bounds: {
        x: 520,
        y: 648,
        width: 720,
        height: 88
      },
      stableSignature: {
        tagName: "textarea",
        role: "textbox",
        name: "prompt-textarea"
      }
    });

    const ranked = rankLiveSelectorCandidates(
      [sidebarItem, composer],
      {
        operation: "type",
        desiredTags: ["textarea", "input"],
        desiredRoles: ["textbox", "searchbox", "combobox"],
        textHints: ["message", "send a message"],
        allowContentEditable: true
      }
    );

    expect(ranked[0]?.candidateId).toBe("composer");
  });

  test("penalizes resize affordances when a real sidebar toggle exists", () => {
    const resizeRail = baseCandidate({
      candidateId: "resize-rail",
      tagName: "div",
      ariaLabel: "Open sidebar",
      affordanceLabel: "Open sidebar",
      affordanceAction: "expand",
      cursorStyle: "e-resize",
      stateHint: "collapsed",
      widgetKind: "sidebar",
      bounds: {
        x: 8,
        y: 8,
        width: 36,
        height: 36
      },
      focusOrder: 0,
      atlasConfidence: 0.98
    });
    const openSidebarButton = baseCandidate({
      candidateId: "open-sidebar-button",
      tagName: "button",
      role: "button",
      ariaLabel: "Open sidebar",
      affordanceLabel: "Open sidebar",
      affordanceAction: "expand",
      cursorStyle: "pointer",
      stateHint: "collapsed",
      widgetKind: "sidebar",
      bounds: {
        x: 10,
        y: 10,
        width: 36,
        height: 36
      },
      focusOrder: 1,
      atlasConfidence: 0.98
    });

    const ranked = rankLiveSelectorCandidates(
      [resizeRail, openSidebarButton],
      {
        operation: "click",
        desiredTags: ["button", "a"],
        textHints: ["open sidebar", "expand"]
      }
    );

    expect(ranked[0]?.candidateId).toBe("open-sidebar-button");
  });

  test("penalizes candidates that miss explicit text hints", () => {
    const unrelatedLocalControl = baseCandidate({
      candidateId: "local-control",
      tagName: "button",
      role: "button",
      ariaLabel: "Model selector",
      inActiveFocusRegion: true,
      bounds: {
        x: 720,
        y: 640,
        width: 120,
        height: 36
      }
    });
    const hintedHistoryRow = baseCandidate({
      candidateId: "history-row",
      tagName: "a",
      role: "link",
      ariaLabel: "人机验证测试网站",
      textSnippet: "人机验证测试网站",
      widgetKind: "history-item",
      bounds: {
        x: 24,
        y: 280,
        width: 200,
        height: 36
      }
    });

    const ranked = rankLiveSelectorCandidates(
      [unrelatedLocalControl, hintedHistoryRow],
      {
        operation: "hover",
        textHints: ["人机验证测试网站"]
      }
    );

    expect(ranked[0]?.candidateId).toBe("history-row");
  });

  test("prefers a keyboard-reachable button over a pointer-only wrapper", () => {
    const wrapper = baseCandidate({
      candidateId: "wrapper",
      tagName: "div",
      ariaLabel: "Open settings",
      interactable: {
        clickable: true,
        typable: false,
        selectable: false,
        focusable: false
      }
    });
    const button = baseCandidate({
      candidateId: "button",
      tagName: "button",
      role: "button",
      ariaLabel: "Open settings",
      interactable: {
        clickable: true,
        typable: false,
        selectable: false,
        focusable: true
      }
    });

    const ranked = rankLiveSelectorCandidates(
      [wrapper, button],
      {
        operation: "click",
        desiredTags: ["button", "div"],
        desiredRoles: ["button"],
        textHints: ["open settings"]
      }
    );

    expect(ranked[0]?.candidateId).toBe("button");
  });
});
