import { describe, expect, test } from "vitest";

import type { WorkbenchWebTargetIntent } from "../../../shared/workbench-web-automation";
import { createWorkbenchWebQueryIntentBuilder } from "../service-modules/query-intent-builder";

const FOCUS_INTENT: WorkbenchWebTargetIntent = {
  operation: "focus",
  desiredTags: ["textarea", "input", "button"],
  desiredRoles: ["textbox", "button"],
  allowContentEditable: true
};

describe("query intent builder", () => {
  const { buildQueryIntentFromRequest } = createWorkbenchWebQueryIntentBuilder({
    focusAtlasIntent: FOCUS_INTENT
  });

  test("returns focus intent for empty query", () => {
    expect(buildQueryIntentFromRequest()).toBe(FOCUS_INTENT);
    expect(buildQueryIntentFromRequest({} as any)).toBe(FOCUS_INTENT);
  });

  test("builds type operation intent for textbox-like roles", () => {
    const intent = buildQueryIntentFromRequest({
      role: "textbox",
      text: "message"
    } as any);

    expect(intent.operation).toBe("type");
    expect(intent.allowContentEditable).toBe(true);
    expect(intent.desiredRoles).toContain("textbox");
    expect(intent.desiredTags).toContain("input");
    expect(intent.textHints).toContain("message");
  });

  test("builds select operation intent for option-like roles", () => {
    const intent = buildQueryIntentFromRequest({
      role: "option",
      text: "GPT-5"
    } as any);

    expect(intent.operation).toBe("select");
    expect(intent.desiredRoles).toContain("option");
    expect(intent.desiredTags).toContain("option");
  });

  test("applies contextual role hints", () => {
    const intent = buildQueryIntentFromRequest({
      underMenu: true,
      inDialog: true
    } as any);

    expect(intent.operation).toBe("click");
    expect(intent.desiredRoles).toContain("menuitem");
    expect(intent.desiredRoles).toContain("textbox");
    expect(intent.desiredRoles).toContain("button");
  });
});
