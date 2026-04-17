import { describe, expect, test } from "vitest";

import { prioritizeSurfaceCandidates } from "../live-selector/surface-filter";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

const candidate = (
  id: string,
  overrides: Partial<LiveSelectorScanCandidateRecord>
): LiveSelectorScanCandidateRecord => ({
  candidateId: id,
  frameTreeNodeId: 1,
  tagName: "button",
  selectorPreview: `button[data-id="${id}"]`,
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
    path: `r/d:${id}`
  },
  stableSignature: {
    tagName: "button"
  },
  ...overrides
});

describe("prioritizeSurfaceCandidates", () => {
  test("suppresses low-value noise and keeps local revealed controls first", () => {
    const noise = candidate("noise", {
      tagName: "div",
      role: undefined,
      ariaLabel: undefined,
      textSnippet: undefined,
      widgetKind: undefined,
      bounds: {
        x: 0,
        y: 0,
        width: 800,
        height: 120
      }
    });
    const localReveal = candidate("local-reveal", {
      ariaLabel: "Open conversation options",
      discoveryMode: "hover_revealed",
      ownerWidgetId: "row-1",
      widgetKind: "menu-trigger",
      bounds: {
        x: 240,
        y: 120,
        width: 36,
        height: 36
      }
    });
    const globalButton = candidate("global", {
      ariaLabel: "Share",
      bounds: {
        x: 720,
        y: 24,
        width: 40,
        height: 36
      }
    });

    const surfaced = prioritizeSurfaceCandidates({
      candidates: [noise, globalButton, localReveal],
      session: {
        sessionKey: "a:b:c",
        agentSessionId: "a",
        agentTurnId: "b",
        tabId: "c",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        activeItemId: "row-1",
        revealRegion: {
          x: 120,
          y: 80,
          width: 220,
          height: 120
        }
      },
      limit: 8
    });

    expect(surfaced.map((entry) => entry.candidateId)).toEqual(["local-reveal", "global"]);
  });

  test("promotes semantic matches ahead of stale local focus controls", () => {
    const localFocusButton = candidate("local-focus", {
      ariaLabel: "Model selector",
      inActiveFocusRegion: true,
      widgetKind: "mode-switcher",
      bounds: {
        x: 720,
        y: 640,
        width: 120,
        height: 36
      }
    });
    const historyRow = candidate("history-row", {
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

    const surfaced = prioritizeSurfaceCandidates({
      candidates: [localFocusButton, historyRow],
      session: {
        sessionKey: "a:b:c",
        agentSessionId: "a",
        agentTurnId: "b",
        tabId: "c",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        activeWidgetId: "mode-switcher-1",
        workflowRegion: {
          x: 640,
          y: 600,
          width: 260,
          height: 120
        }
      },
      intent: {
        operation: "hover",
        textHints: ["人机验证测试网站"]
      },
      limit: 8
    });

    expect(surfaced.map((entry) => entry.candidateId)).toEqual(["history-row", "local-focus"]);
  });
});
