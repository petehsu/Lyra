import { describe, expect, test } from "vitest";

import { deriveLocalDeltaFromReveal, deriveLocalDeltaFromVerification } from "../live-selector/local-delta";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

const candidate = (
  id: string,
  discoveryMode?: LiveSelectorScanCandidateRecord["discoveryMode"],
  overrides: Partial<LiveSelectorScanCandidateRecord> = {}
): LiveSelectorScanCandidateRecord => ({
  candidateId: id,
  frameTreeNodeId: 1,
  tagName: "button",
  selectorPreview: `button#${id}`,
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
    width: 32,
    height: 32
  },
  score: 0,
  selectorAddress: {
    frameTreeNodeId: 1,
    path: `r/d:${id}`
  },
  stableSignature: {
    tagName: "button"
  },
  ...(discoveryMode === undefined ? {} : { discoveryMode }),
  ...overrides
});

describe("local delta helpers", () => {
  test("derives reveal delta when local controls appear", () => {
    const delta = deriveLocalDeltaFromReveal({
      baseline: [candidate("baseline")],
      revealed: [
        candidate("baseline"),
        candidate("revealed", "hover_revealed"),
        candidate("tooltip", "hover_revealed", {
          tooltipText: "Open conversation options",
          cursorStyle: "pointer",
          stateHint: "expanded"
        })
      ],
      workflowRegion: {
        x: 0,
        y: 0,
        width: 300,
        height: 80
      }
    });

    expect(delta?.kinds).toEqual([
      "revealed_controls_added",
      "tooltip_opened",
      "cursor_changed",
      "hover_state_changed"
    ]);
    expect(delta?.candidateCount).toBe(2);
    expect(delta?.cursorStyle).toBe("pointer");
    expect(delta?.tooltipText).toBe("Open conversation options");
    expect(delta?.stateHint).toBe("expanded");
  });

  test("maps workflow verification into local delta semantics", () => {
    const delta = deriveLocalDeltaFromVerification({
      result: {
        tabId: "browser-tab-1",
        actionKind: "click",
        ok: true,
        verified: true,
        verification: {
          stateTransition: "menu_opened",
          cursorStyle: "pointer",
          tooltipText: "Delete conversation",
          affordanceHints: [{
            kind: "state",
            label: "Control state changed",
            detail: "expanded"
          }]
        }
      }
    });

    expect(delta?.kinds).toEqual(["menu_opened", "cursor_changed", "tooltip_opened"]);
    expect(delta?.cursorStyle).toBe("pointer");
    expect(delta?.tooltipText).toBe("Delete conversation");
    expect(delta?.stateHint).toBe("expanded");
  });
});
