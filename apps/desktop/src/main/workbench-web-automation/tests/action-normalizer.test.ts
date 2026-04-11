import { describe, expect, test } from "vitest";

import { parseWorkbenchWebActionRequestPayload } from "../action-normalizer";

describe("workbench web action normalizer", () => {
  test("drops weak body selector for typing so auto-target fallback can engage", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: {
        kind: "type",
        selector: "body",
        text: "hello"
      }
    });

    expect(request.action.kind).toBe("type");
    if (request.action.kind !== "type") {
      throw new Error("expected type action");
    }
    expect(request.action.target.cssSelector).toBeUndefined();
    expect(request.action.text).toBe("hello");
  });

  test("normalizes legacy modifier typing payload into press_key", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: {
        type: "type",
        selector: "body",
        modifierKey: "Meta",
        text: "k"
      }
    });

    expect(request.action.kind).toBe("press_key");
    if (request.action.kind !== "press_key") {
      throw new Error("expected press_key action");
    }
    expect(request.action.key).toBe("k");
    expect(request.action.meta).toBe(true);
    expect(request.action.target.cssSelector).toBeUndefined();
  });

  test("preserves explicit submit false for typing actions", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: {
        kind: "clear_and_type",
        candidateId: "candidate-1",
        text: "hello",
        submit: false
      }
    });

    expect(request.action.kind).toBe("clear_and_type");
    if (request.action.kind !== "clear_and_type") {
      throw new Error("expected clear_and_type action");
    }
    expect(request.action.submit).toBe(false);
  });
});
