import { describe, expect, test } from "vitest";

import {
  captureQueryIntentCue,
  pickRevealContinuationCandidate,
  rankRevealContinuationCandidates,
  readFreshQueryIntentCue,
} from "../reveal-continuation";
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
    x: 40,
    y: 80,
    width: 140,
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

describe("reveal continuation", () => {
  test("captures meaningful query cues", () => {
    const cue = captureQueryIntentCue({
      request: {
        name: "Switch model",
        role: ["menuitem", "option"],
        within: "menu"
      },
      context: {
        agentSessionId: "session-1"
      },
      now: 1_000
    });

    expect(cue).not.toBeNull();
    expect(cue?.textHints).toContain("switch model");
    expect(cue?.roles).toContain("menuitem");
    expect(cue?.agentSessionId).toBe("session-1");
  });

  test("drops stale cues", () => {
    const cueByTab = new Map<string, NonNullable<ReturnType<typeof captureQueryIntentCue>>>();
    const cue = captureQueryIntentCue({
      request: {
        text: "target row"
      },
      now: 1_000
    });
    expect(cue).not.toBeNull();
    cueByTab.set("tab-1", cue!);

    const fresh = readFreshQueryIntentCue({
      cueByTab,
      tabId: "tab-1",
      now: 40_500,
      ttlMs: 30_000
    });
    expect(fresh).toBeNull();
    expect(cueByTab.has("tab-1")).toBe(false);
  });

  test("uses query cue to select the correct revealed candidate", () => {
    const source = baseCandidate({
      candidateId: "open-model-menu",
      tagName: "button",
      role: "button",
      widgetKind: "mode-switcher",
      stateHint: "expanded"
    });
    const revealed = [
      baseCandidate({
        candidateId: "model-a",
        tagName: "button",
        role: "menuitem",
        widgetKind: "list-item",
        textSnippet: "Model A",
        stateHint: "selected",
        ownerWidgetId: "mode-group"
      }),
      baseCandidate({
        candidateId: "model-b",
        tagName: "button",
        role: "menuitem",
        widgetKind: "list-item",
        textSnippet: "Model B",
        stateHint: "unselected",
        ownerWidgetId: "mode-group"
      })
    ];

    const next = pickRevealContinuationCandidate({
      sourceCandidate: source,
      revealedCandidates: revealed,
      queryCue: {
        capturedAt: Date.now(),
        textHints: ["model b"],
        roles: ["menuitem"]
      },
    });
    expect(next?.candidateId).toBe("model-b");
  });

  test("falls back to structural mode-switch continuation when no cue exists", () => {
    const source = baseCandidate({
      candidateId: "toggle",
      widgetKind: "toggle-group",
      stateHint: "selected"
    });
    const revealed = [
      baseCandidate({
        candidateId: "already-selected",
        role: "option",
        widgetKind: "list-item",
        stateHint: "selected"
      }),
      baseCandidate({
        candidateId: "next-option",
        role: "option",
        widgetKind: "list-item",
        stateHint: "unselected"
      })
    ];

    const next = pickRevealContinuationCandidate({
      sourceCandidate: source,
      revealedCandidates: revealed,
      queryCue: null
    });
    expect(next?.candidateId).toBe("next-option");
  });

  test("uses deterministic adjacent toggle option when multiple unselected candidates exist", () => {
    const source = baseCandidate({
      candidateId: "toggle",
      widgetKind: "toggle-group",
      stateHint: "selected"
    });
    const revealed = [
      baseCandidate({
        candidateId: "option-a",
        role: "option",
        widgetKind: "list-item",
        stateHint: "unselected",
        bounds: { x: 10, y: 40, width: 120, height: 28 }
      }),
      baseCandidate({
        candidateId: "option-b-current",
        role: "option",
        widgetKind: "list-item",
        stateHint: "selected",
        bounds: { x: 10, y: 72, width: 120, height: 28 }
      }),
      baseCandidate({
        candidateId: "option-c",
        role: "option",
        widgetKind: "list-item",
        stateHint: "unselected",
        bounds: { x: 10, y: 104, width: 120, height: 28 }
      })
    ];

    const next = pickRevealContinuationCandidate({
      sourceCandidate: source,
      revealedCandidates: revealed,
      queryCue: null
    });

    expect(next?.candidateId).toBe("option-c");
  });

  test("prefers same-widget continuation candidates over unrelated list items", () => {
    const source = baseCandidate({
      candidateId: "toggle",
      widgetKind: "toggle-group",
      widgetId: "mode-widget",
      stateHint: "selected"
    });
    const revealed = [
      baseCandidate({
        candidateId: "unrelated-nav-item",
        role: "option",
        widgetKind: "list-item",
        widgetId: "history-widget",
        stateHint: "unselected",
        bounds: { x: 10, y: 40, width: 120, height: 28 }
      }),
      baseCandidate({
        candidateId: "mode-selected",
        role: "option",
        widgetKind: "list-item",
        widgetId: "mode-widget",
        stateHint: "selected",
        bounds: { x: 10, y: 72, width: 120, height: 28 }
      }),
      baseCandidate({
        candidateId: "mode-next",
        role: "option",
        widgetKind: "list-item",
        widgetId: "mode-widget",
        stateHint: "unselected",
        bounds: { x: 10, y: 104, width: 120, height: 28 }
      })
    ];

    const next = pickRevealContinuationCandidate({
      sourceCandidate: source,
      revealedCandidates: revealed,
      queryCue: null
    });

    expect(next?.candidateId).toBe("mode-next");
  });

  test("does not auto-continue generic menus without cue", () => {
    const source = baseCandidate({
      candidateId: "row-menu",
      widgetKind: "menu-trigger",
      role: "button"
    });
    const revealed = [
      baseCandidate({
        candidateId: "item-1",
        role: "menuitem",
        widgetKind: "list-item",
        textSnippet: "Item 1"
      }),
      baseCandidate({
        candidateId: "item-2",
        role: "menuitem",
        widgetKind: "list-item",
        textSnippet: "Item 2"
      })
    ];

    const next = pickRevealContinuationCandidate({
      sourceCandidate: source,
      revealedCandidates: revealed,
      queryCue: null
    });
    expect(next).toBeUndefined();
  });

  test("builds ordered continuation queue for mode switch and excludes selected option", () => {
    const source = baseCandidate({
      candidateId: "open-model-menu",
      role: "button",
      widgetKind: "mode-switcher",
      widgetId: "mode-widget",
      stateHint: "expanded"
    });
    const revealed = [
      baseCandidate({
        candidateId: "mode-selected",
        role: "menuitem",
        widgetKind: "list-item",
        widgetId: "mode-widget",
        textSnippet: "Default",
        stateHint: "selected"
      }),
      baseCandidate({
        candidateId: "mode-thinking",
        role: "menuitem",
        widgetKind: "list-item",
        widgetId: "mode-widget",
        textSnippet: "Thinking",
        stateHint: "unselected"
      }),
      baseCandidate({
        candidateId: "mode-fast",
        role: "menuitem",
        widgetKind: "list-item",
        widgetId: "mode-widget",
        textSnippet: "Fast",
        stateHint: "unselected"
      })
    ];

    const queue = rankRevealContinuationCandidates({
      sourceCandidate: source,
      revealedCandidates: revealed,
      queryCue: {
        capturedAt: Date.now(),
        roles: ["menuitem"],
        textHints: ["thinking"]
      },
      maxCandidates: 3
    });

    expect(queue.map((candidate) => candidate.candidateId)).toEqual([
      "mode-thinking",
      "mode-fast"
    ]);
  });

  test("filters redundant trigger candidates after reveal and keeps selection candidates", () => {
    const source = baseCandidate({
      candidateId: "open-model-menu",
      tagName: "button",
      role: "button",
      widgetKind: "mode-switcher",
      ariaLabel: "Model selector",
      affordanceAction: "open menu",
      bounds: { x: 120, y: 44, width: 120, height: 30 },
      stableSignature: {
        tagName: "button",
        id: "model-selector"
      }
    });

    const revealed = [
      baseCandidate({
        candidateId: "open-model-menu-duplicate",
        tagName: "button",
        role: "button",
        widgetKind: "toggle-group",
        ariaLabel: "Model selector",
        affordanceAction: "open menu",
        bounds: { x: 122, y: 46, width: 120, height: 30 },
        stableSignature: {
          tagName: "button",
          id: "model-selector"
        }
      }),
      baseCandidate({
        candidateId: "thinking-mode",
        tagName: "button",
        role: "menuitem",
        widgetKind: "list-item",
        textSnippet: "Thinking",
        stateHint: "unselected",
        widgetId: "mode-widget",
        bounds: { x: 120, y: 88, width: 160, height: 32 }
      })
    ];

    const queue = rankRevealContinuationCandidates({
      sourceCandidate: source,
      revealedCandidates: revealed,
      queryCue: {
        capturedAt: Date.now(),
        roles: ["menuitem"],
        textHints: ["thinking"]
      },
      maxCandidates: 3
    });

    expect(queue.map((candidate) => candidate.candidateId)).toEqual(["thinking-mode"]);
  });
});
