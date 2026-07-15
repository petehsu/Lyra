import { describe, expect, test } from "vitest";
import type { WorkbenchBrowserAgentElement } from "../types";
import { browserElementEffectConflict } from "../view-manager-runtime/agent-action-effect";

const element = (
  overrides: Partial<WorkbenchBrowserAgentElement>
): WorkbenchBrowserAgentElement => ({
  id: 1,
  targetRef: "lumen:test",
  stableId: "test",
  target: {
    targetRef: "lumen:test",
    targetKind: "button",
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
  tagName: "button",
  role: "button",
  label: "Action",
  selectorPreview: "button",
  bounds: { x: 0, y: 0, width: 100, height: 32 },
  focusable: true,
  disabled: false,
  editable: false,
  ...overrides
});

describe("browserElementEffectConflict", () => {
  test("raises risk from file-input facts without reading labels", () => {
    const fileInput = element({ tagName: "input", inputType: "file", controlKind: "input" });
    expect(browserElementEffectConflict(fileInput, "editDraft")).toContain("effect=upload");
    expect(browserElementEffectConflict(fileInput, "upload")).toBeNull();
  });

  test("raises risk from OAuth protocol parameters", () => {
    const oauth = element({
      destinationUrl:
        "https://identity.example/authorize?client_id=client&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback"
    });
    expect(browserElementEffectConflict(oauth, "navigate")).toContain("effect=authorize");
    expect(browserElementEffectConflict(oauth, "authorize")).toBeNull();
  });

  test("does not allow form submission to be declared as navigation", () => {
    const submit = element({
      formAction: "https://app.example/search",
      formMethod: "get"
    });
    expect(browserElementEffectConflict(submit, "navigate")).toContain("form submission");
    expect(browserElementEffectConflict(submit, "submitExternal")).toBeNull();
  });
});
