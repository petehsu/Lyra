import { describe, expect, test } from "vitest";

import { rankLiveSelectorCandidates } from "../live-selector/candidate-ranker";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

const baseCandidate = (
  overrides: Partial<LiveSelectorScanCandidateRecord>
): LiveSelectorScanCandidateRecord => ({
  candidateId: "candidate",
  frameTreeNodeId: 1,
  tagName: "button",
  selectorPreview: "button",
  visibilityState: "visible",
  interactable: {
    clickable: true,
    typable: false,
    selectable: false,
    focusable: true
  },
  bounds: {
    x: 900,
    y: 560,
    width: 32,
    height: 32
  },
  score: 0,
  selectorAddress: {
    frameTreeNodeId: 1,
    path: "button"
  },
  stableSignature: {
    tagName: "button"
  },
  ...overrides
});

describe("candidate ranker", () => {
  test("prefers compact icon-like submit controls over wide toolbar chips for click scans", () => {
    const ranked = rankLiveSelectorCandidates([
      baseCandidate({
        candidateId: "toolbar-chip",
        textSnippet: "图像生成",
        bounds: {
          x: 540,
          y: 567,
          width: 94,
          height: 32
        }
      }),
      baseCandidate({
        candidateId: "send-icon",
        ariaLabel: "发送",
        bounds: {
          x: 980,
          y: 560,
          width: 32,
          height: 32
        }
      })
    ], {
      operation: "click",
      desiredTags: ["button"],
      textHints: ["发送"]
    });

    expect(ranked[0]?.candidateId).toBe("send-icon");
    expect(ranked[1]?.candidateId).toBe("toolbar-chip");
  });

  test("prefers send-like compact button near typable composer without explicit text hints", () => {
    const ranked = rankLiveSelectorCandidates([
      baseCandidate({
        candidateId: "composer-input",
        tagName: "textarea",
        interactable: {
          clickable: false,
          typable: true,
          selectable: false,
          focusable: true
        },
        bounds: {
          x: 480,
          y: 540,
          width: 760,
          height: 32
        }
      }),
      baseCandidate({
        candidateId: "toolbar-chip",
        textSnippet: "图像生成",
        bounds: {
          x: 920,
          y: 590,
          width: 94,
          height: 32
        }
      }),
      baseCandidate({
        candidateId: "send-icon",
        bounds: {
          x: 1260,
          y: 540,
          width: 32,
          height: 32
        }
      })
    ], {
      operation: "click",
      desiredTags: ["button"]
    });

    expect(ranked[0]?.candidateId).toBe("send-icon");
  });
});
