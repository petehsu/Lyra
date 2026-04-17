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

  test("parses stringified navigation action payloads", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      tabId: "browser-tab-1",
      action: "{\"kind\":\"goto_url\",\"address\":\"https://chatgpt.com/\",\"target\":\"active-tab\"}"
    });

    expect(request.tabId).toBe("browser-tab-1");
    expect(request.action.kind).toBe("goto_url");
    if (request.action.kind !== "goto_url") {
      throw new Error("expected goto_url action");
    }
    expect(request.action.address).toBe("https://chatgpt.com/");
    expect(request.action.target).toBe("active-tab");
  });

  test("parses stringified mutate action payloads with nested target", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: "{\"kind\":\"click\",\"target\":{\"candidateId\":\"candidate-1\",\"scanSessionId\":\"scan-1\"}}"
    });

    expect(request.action.kind).toBe("click");
    if (request.action.kind !== "click") {
      throw new Error("expected click action");
    }
    expect(request.action.target.candidateId).toBe("candidate-1");
    expect(request.action.target.scanSessionId).toBe("scan-1");
  });

  test("preserves semantic query-style target fields for action resolution", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: {
        kind: "click",
        target: {
          role: "button",
          tagName: "button",
          testId: "model-switcher-dropdown-button",
          ariaLabel: "Model selector",
          text: "Thinking"
        }
      }
    });

    expect(request.action.kind).toBe("click");
    if (request.action.kind !== "click") {
      throw new Error("expected click action");
    }
    expect(request.action.target.role).toBe("button");
    expect(request.action.target.tagName).toBe("button");
    expect(request.action.target.testId).toBe("model-switcher-dropdown-button");
    expect(request.action.target.ariaLabel).toBe("Model selector");
    expect(request.action.target.text).toBe("Thinking");
    expect(request.action.target.stableSignature).toMatchObject({
      tagName: "button",
      role: "button",
      testId: "model-switcher-dropdown-button",
      ariaLabel: "Model selector"
    });
  });

  test("normalizes role arrays by selecting the first role", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: {
        kind: "click",
        target: {
          role: ["button", "link"],
          textContains: "Hide side"
        }
      }
    });

    expect(request.action.kind).toBe("click");
    if (request.action.kind !== "click") {
      throw new Error("expected click action");
    }
    expect(request.action.target.role).toBe("button");
    expect(request.action.target.textContains).toBe("Hide side");
  });

  test("preserves indexed targets for disambiguation", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: {
        kind: "click",
        target: {
          role: "button",
          textSnippet: "…",
          index: 0
        }
      }
    });

    expect(request.action.kind).toBe("click");
    if (request.action.kind !== "click") {
      throw new Error("expected click action");
    }
    expect(request.action.target.role).toBe("button");
    expect(request.action.target.textSnippet).toBe("…");
    expect(request.action.target.index).toBe(0);
  });

  test("preserves nodeRef targets in action payloads", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: {
        kind: "focus",
        target: {
          nodeRef: {
            nodeId: "candidate-9",
            revision: "skeleton-v1",
            scanSessionId: "scan-9",
            stableFingerprint: {
              tagName: "textarea",
              ariaLabel: "Message ChatGPT"
            }
          }
        }
      }
    });

    expect(request.action.kind).toBe("focus");
    if (request.action.kind !== "focus") {
      throw new Error("expected focus action");
    }
    expect(request.action.target.nodeRef).toEqual({
      nodeId: "candidate-9",
      revision: "skeleton-v1",
      scanSessionId: "scan-9",
      stableFingerprint: {
        tagName: "textarea",
        ariaLabel: "Message ChatGPT"
      }
    });
  });

  test("maps legacy scan action kind to expand_probe", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: {
        kind: "scan"
      }
    });

    expect(request.action.kind).toBe("expand_probe");
    if (request.action.kind !== "expand_probe") {
      throw new Error("expected expand_probe action");
    }
    expect(request.action.target).toEqual({});
  });

  test("maps query_find action kind to expand_probe", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: {
        kind: "query_find"
      }
    });

    expect(request.action.kind).toBe("expand_probe");
    if (request.action.kind !== "expand_probe") {
      throw new Error("expected expand_probe action");
    }
    expect(request.action.target).toEqual({});
  });

  test("allows expand_probe without explicit target", () => {
    const request = parseWorkbenchWebActionRequestPayload({
      action: {
        kind: "expand_probe"
      }
    });

    expect(request.action.kind).toBe("expand_probe");
    if (request.action.kind !== "expand_probe") {
      throw new Error("expected expand_probe action");
    }
    expect(request.action.target).toEqual({});
  });
});
