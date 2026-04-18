import { describe, expect, test } from "vitest";

import { isWeakStableSignatureTarget, toActionIntent } from "../service-modules/action-intent-utils";

describe("action intent utils", () => {
  test("builds typing intent with content editable support", () => {
    const intent = toActionIntent(
      { kind: "type" } as any,
      {
        tagName: "textarea",
        role: "textbox",
        ariaLabel: "Message",
        placeholder: "Type message"
      }
    );

    expect(intent.operation).toBe("type");
    expect(intent.allowContentEditable).toBe(true);
    expect(intent.desiredTags).toContain("textarea");
    expect(intent.desiredRoles).toContain("textbox");
    expect(intent.textHints).toContain("Message");
    expect(intent.placeholderHints).toEqual(["Type message"]);
  });

  test("builds click intent with semantic hints", () => {
    const intent = toActionIntent(
      { kind: "click" } as any,
      {
        role: "button",
        ariaLabel: "Send",
        textSnippet: "Send",
        selectorPreview: "button.send"
      }
    );

    expect(intent.operation).toBe("click");
    expect(intent.desiredRoles).toContain("button");
    expect(intent.textHints).toEqual(["Send", "Send", "button.send", "button"]);
  });

  test("detects weak stable signature targets", () => {
    expect(isWeakStableSignatureTarget({
      tagName: "button",
      role: "button"
    })).toBe(true);

    expect(isWeakStableSignatureTarget({
      tagName: "button",
      id: "send-button",
      role: "button"
    })).toBe(false);

    expect(isWeakStableSignatureTarget(null)).toBe(false);
    expect(isWeakStableSignatureTarget("button")).toBe(false);
  });
});
