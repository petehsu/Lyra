import { describe, expect, test } from "vitest";

import {
  inferCandidateSemanticRole,
  matchesRequestedRoles,
  matchesSemanticWithinScope,
} from "../query-semantics";
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
    x: 20,
    y: 20,
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

describe("query semantics", () => {
  test("infers semantic role for native buttons without explicit aria role", () => {
    const candidate = baseCandidate({
      tagName: "button",
      stableSignature: {
        tagName: "button"
      }
    });

    expect(inferCandidateSemanticRole(candidate)).toBe("button");
    expect(matchesRequestedRoles(candidate, ["button"])).toBe(true);
  });

  test("infers textbox role for typable composer inputs", () => {
    const candidate = baseCandidate({
      tagName: "div",
      interactable: {
        clickable: true,
        typable: true,
        selectable: false,
        focusable: true
      },
      stableSignature: {
        tagName: "div"
      }
    });

    expect(inferCandidateSemanticRole(candidate)).toBe("textbox");
    expect(matchesRequestedRoles(candidate, ["textbox", "searchbox"])).toBe(true);
  });

  test("treats within main as a real content/composer scope instead of a text hint", () => {
    const regionKindById = new Map([
      ["region-sidebar", "sidebar" as const],
      ["region-composer", "composer" as const]
    ]);
    const sidebarCandidate = baseCandidate({
      candidateId: "sidebar-profile",
      tagName: "div",
      role: "button",
      focusRegionId: "region-sidebar",
      widgetKind: "sidebar"
    });
    const composerCandidate = baseCandidate({
      candidateId: "composer-input",
      tagName: "textarea",
      role: "textbox",
      focusRegionId: "region-composer",
      widgetKind: "chat-composer",
      interactable: {
        clickable: true,
        typable: true,
        selectable: false,
        focusable: true
      }
    });

    expect(matchesSemanticWithinScope({
      candidate: sidebarCandidate,
      within: "main",
      regionKindById
    })).toBe(false);
    expect(matchesSemanticWithinScope({
      candidate: composerCandidate,
      within: "main",
      regionKindById
    })).toBe(true);
  });
});
