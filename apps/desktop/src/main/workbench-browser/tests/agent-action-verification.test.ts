import { describe, expect, test } from "vitest";

import { verifyActionOutcome } from "../view-manager-runtime/agent-action-verification";
import type { WorkbenchBrowserAgentObservation } from "../types";

const baseObservation = (
  overrides: Partial<WorkbenchBrowserAgentObservation> = {}
): WorkbenchBrowserAgentObservation => ({
  observationId: "obs-1",
  mapEpoch: 1,
  url: "https://example.test/feed",
  title: "Feed",
  elements: [],
  targets: [],
  strategy: "interactiveOnly",
  inputMode: "chromium",
  ...overrides
});

describe("verifyActionOutcome", () => {
  test("detects target element state changes after an act", () => {
    const result = verifyActionOutcome({
      interaction: "click",
      targetRef: "lumen:btn-1",
      priorElement: {
        role: "button",
        label: "发表",
        disabled: false
      },
      observation: baseObservation({
        elements: [{
          id: 1,
          targetRef: "lumen:btn-1",
          role: "button",
          label: "发表",
          disabled: true,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          selectorPreview: "button",
          discoveryScope: "dom",
          actionHint: "click",
          tagName: "button"
        }]
      })
    });
    expect(result.verified).toBe(true);
    expect(result.signals).toContain("target_element_changed");
  });

  test("detects feed-level changes via observation diff", () => {
    const priorElement = {
      id: 10,
      targetRef: "lumen:feed-old",
      role: "article",
      label: "Older post",
      bounds: { x: 0, y: 120, width: 10, height: 10 },
      selectorPreview: "article",
      discoveryScope: "dom" as const,
      actionHint: "click",
      tagName: "article"
    };
    const addedElement = {
      id: 11,
      targetRef: "lumen:feed-new",
      role: "article",
      label: "大家好，我是 Lyra",
      bounds: { x: 0, y: 40, width: 10, height: 10 },
      selectorPreview: "article",
      discoveryScope: "dom" as const,
      actionHint: "click",
      tagName: "article"
    };
    const result = verifyActionOutcome({
      interaction: "click",
      priorObservation: {
        url: "https://example.test/feed",
        elements: [priorElement]
      },
      observation: baseObservation({
        elements: [priorElement, addedElement]
      })
    });
    expect(result.verified).toBe(true);
    expect(result.signals).toContain("observation_elements_added");
    expect(result.observationDiff?.added).toHaveLength(1);
    expect(result.observationDiff?.added[0]?.targetRef).toBe("lumen:feed-new");
  });

  test("detects cleared editable fields after submit-like clicks", () => {
    const result = verifyActionOutcome({
      interaction: "click",
      priorElement: {
        role: "textbox",
        label: "说点儿什么吧",
        value: "大家好，我是 Lyra",
        disabled: false
      },
      observation: baseObservation({
        elements: [{
          id: 2,
          targetRef: "lumen:text-1",
          role: "textbox",
          label: "说点儿什么吧",
          editable: true,
          textSnippet: "",
          disabled: false,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          selectorPreview: "textarea",
          discoveryScope: "dom",
          actionHint: "type",
          tagName: "textarea"
        }]
      })
    });
    expect(result.verified).toBe(true);
    expect(result.signals).toContain("editable_field_cleared");
  });
});