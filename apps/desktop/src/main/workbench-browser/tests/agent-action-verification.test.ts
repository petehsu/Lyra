import { describe, expect, test } from "vitest";

import { verifyActionOutcome } from "../view-manager-runtime/agent-action-verification";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentObservation
} from "../types";

const agentElement = (
  overrides: Partial<WorkbenchBrowserAgentElement> = {}
): WorkbenchBrowserAgentElement => ({
  id: 1,
  targetRef: "lumen:test",
  stableId: "test",
  target: {
    targetRef: "lumen:test",
    targetKind: "element",
    tabId: "tab-1",
    frameRef: "main",
    frameChain: [],
    elementFingerprint: "test",
    mapEpoch: 1,
    expiresAt: Date.now() + 60_000
  },
  frameRef: "main",
  elementFingerprint: "test",
  frameTreeNodeId: 1,
  tagName: "div",
  role: "generic",
  label: "",
  selectorPreview: "div",
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  focusable: false,
  disabled: false,
  editable: false,
  ...overrides
});

const baseObservation = (
  overrides: Partial<WorkbenchBrowserAgentObservation> = {}
): WorkbenchBrowserAgentObservation => ({
  ok: true,
  kind: "lyraLumenMap",
  tabId: "tab-1",
  targetMode: "live",
  observationId: "obs-1",
  mapEpoch: 1,
  url: "https://example.test/feed",
  title: "Feed",
  elements: [],
  targets: [],
  strategy: "interactiveOnly",
  activeElementId: null,
  focusOrder: [],
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
        elements: [agentElement({
          targetRef: "lumen:btn-1",
          stableId: "btn-1",
          tagName: "button",
          role: "button",
          label: "发表",
          disabled: true,
          selectorPreview: "button",
          discoveryScope: "document",
          actionHint: "click",
          focusable: true
        })]
      })
    });
    expect(result.verified).toBe(true);
    expect(result.signals).toContain("target_element_changed");
  });

  test("detects feed-level changes via observation diff", () => {
    const priorElement = agentElement({
      id: 10,
      targetRef: "lumen:feed-old",
      stableId: "feed-old",
      role: "article",
      label: "Older post",
      bounds: { x: 0, y: 120, width: 10, height: 10 },
      selectorPreview: "article",
      discoveryScope: "document",
      actionHint: "click",
      tagName: "article"
    });
    const addedElement = agentElement({
      id: 11,
      targetRef: "lumen:feed-new",
      stableId: "feed-new",
      role: "article",
      label: "大家好，我是 Lyra",
      bounds: { x: 0, y: 40, width: 10, height: 10 },
      selectorPreview: "article",
      discoveryScope: "document",
      actionHint: "click",
      tagName: "article"
    });
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
        elements: [agentElement({
          id: 2,
          targetRef: "lumen:text-1",
          stableId: "text-1",
          role: "textbox",
          label: "说点儿什么吧",
          editable: true,
          textSnippet: "",
          disabled: false,
          selectorPreview: "textarea",
          discoveryScope: "document",
          actionHint: "type",
          tagName: "textarea",
          focusable: true
        })]
      })
    });
    expect(result.verified).toBe(true);
    expect(result.signals).toContain("editable_field_cleared");
  });
});
