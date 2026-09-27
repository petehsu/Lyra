import { describe, expect, test } from "vitest";

import type { WorkbenchBrowserAgentElement, WorkbenchBrowserAgentObservation } from "../types";
import { compactMapObservation } from "../view-manager-runtime/agent-map-compaction";
import { compareSurface } from "../view-manager-runtime/agent-surface-change";

const element = (
  overrides: Partial<WorkbenchBrowserAgentElement> = {}
): WorkbenchBrowserAgentElement => ({
  id: 1,
  targetRef: "lumen:a",
  stableId: "a",
  target: {
    targetRef: "lumen:a",
    targetKind: "button",
    tabId: "tab-1",
    frameRef: "lumen-frame:1",
    frameChain: ["lumen-frame:1"],
    elementFingerprint: "fp",
    mapEpoch: 1,
    expiresAt: Date.now() + 60_000
  },
  frameRef: "lumen-frame:1",
  elementFingerprint: "fp",
  frameTreeNodeId: 1,
  tagName: "button",
  role: "button",
  label: "Save",
  selectorPreview: "button#save",
  bounds: { x: 10, y: 20, width: 80, height: 32 },
  focusable: true,
  disabled: false,
  editable: false,
  ...overrides
});

const observation = (
  elements: readonly WorkbenchBrowserAgentElement[],
  observationId: string
): WorkbenchBrowserAgentObservation => ({
  ok: true,
  kind: "lyraLumenMap",
  tabId: "tab-1",
  targetMode: "live",
  observationId,
  mapEpoch: 1,
  strategy: "interactiveOnly",
  url: "https://example.test/app",
  title: "App",
  targets: [],
  elements,
  activeElementId: null,
  focusOrder: []
});

describe("agent-map-compaction", () => {
  test("publishes cursor changes without claiming operation success or DOM disability", () => {
    const previous = observation([element({ cursor: { keyword: "pointer", customImage: false } })], "before");
    const next = { ...observation([element({ cursor: { keyword: "wait", customImage: false } })], "after"), mapAppendix: "full", pageNotes: [{ id: "css:1", kind: "cursor" as const, text: "Page: wait" }] };
    expect(compactMapObservation(previous, next).observation.mapAppendix).toContain("Updated");
    expect(compactMapObservation(previous, next).observation.mapAppendix).toContain("cursor=wait");
    expect(compareSurface(previous, next)).toMatchObject({ changed: false, cursorChanged: true });
    expect(next.elements[0]?.disabled).toBe(false);
  });
  test("focus alone is not outcome evidence, but new controls and dialogs are", () => {
    const previous = observation([element()], "before");
    const focused = { ...observation([element({ semantics: { focused: true } })], "after"), pageNotes: [{ id: "focus:1", kind: "focus" as const, text: "Save" }] };
    expect(compareSurface(previous, focused).changed).toBe(false);
    const anonymous = observation([element({ label: "" })], "anonymous");
    expect(compareSurface(anonymous, { ...anonymous, elements: [element({ label: "", bounds: { x: 250, y: 80, width: 80, height: 32 } })] }).changed).toBe(false);
    const opened = { ...focused, elements: [...focused.elements, element({ id: 2, targetRef: "lumen:delete", label: "Delete" })] };
    expect(compareSurface(previous, opened)).toMatchObject({ changed: true, addedTargetRefs: ["lumen:delete"] });
    expect(compareSurface(previous, { ...previous, pageNotes: [{ id: "dialog:1", kind: "dialog", text: "Delete this conversation?" }] }).changed).toBe(true);
  });

  test("large map transitions retain removal evidence instead of only replacing the map", () => {
    const previous = observation([element({ label: "Deleted conversation" })], "before");
    const next = { ...observation(Array.from({ length: 8 }, (_, id) => element({ id: id + 2, targetRef: `lumen:new${id}` })), "after"), mapAppendix: "Full updated map" };
    const text = compactMapObservation(previous, next).observation.mapAppendix;
    expect(text).toContain('No longer mapped lumen:a "Deleted conversation"');
    expect(text).toContain('8 added, 1 removed');
    expect(text).toContain('Full updated map');
  });
  test("retains all new-control facts in a small delta", () => {
    const previous = observation([element()], "obs-1");
    const next = { ...observation([element(), element({ id: 2, targetRef: "lumen:field", tagName: "input", role: "textbox", label: "Email", disabled: true,
      semantics: { required: true, invalid: "true", validationMessage: "Email is already used", description: "Work address" }, textSnippet: "a@example.test" })], "obs-2"), mapAppendix: "full" };
    const result = compactMapObservation(previous, next).observation.mapAppendix;
    for (const fact of ["Added", "disabled", "required", "Email is already used", "Work address", "a@example.test"]) expect(result).toContain(fact);
  });
  test("reports result messages when controls are unchanged, and explicitly clears context", () => {
    const previous = observation([element()], "obs-1");
    const next: WorkbenchBrowserAgentObservation = { ...observation([element()], "obs-2"), mapAppendix: "full", pageNotes: [{ id: "status:1", kind: "status", text: "Saved successfully" }] };
    const result = compactMapObservation(previous, next).observation;
    expect(result.mapAppendix).toContain("Saved successfully");
    expect(result.mapAppendix).not.toContain("unchanged");
    const cleared = compactMapObservation(result, { ...previous, mapAppendix: "full", pageNotes: [] }).observation;
    expect(cleared.mapAppendix).toContain("context cleared");
  });
  test("publishes keyboard candidate and validation changes, including cleared states", () => {
    const previous = observation([element({ semantics: { focused: true, invalid: "true", activeDescendant: "option: London" } })], "obs-1");
    const next = { ...observation([element({ semantics: { focused: true, activeDescendant: "option: Paris" } })], "obs-2"), mapAppendix: "full" };
    const result = compactMapObservation(previous, next).observation.mapAppendix;
    expect(result).toContain("Updated");
    expect(result).toContain("Paris");
    expect(result).not.toContain("invalid");
  });
  test("reports enabled and expanded transitions even when the label stays the same", () => {
    const previous = observation([element({ disabled: true, expanded: false })], "obs-1");
    const next = { ...observation([element({ disabled: false, expanded: true })], "obs-2"), mapAppendix: "full" };
    const result = compactMapObservation(previous, next).observation.mapAppendix;
    expect(result).toContain("enabled");
    expect(result).toContain("expanded");
    expect(result).not.toContain("unchanged");
  });
  test("keeps the same targetRef when a control only moves", () => {
    const previous = observation([element()], "obs-1");
    const next = { ...observation(
      [element({ bounds: { x: 400, y: 500, width: 80, height: 32 } })],
      "obs-2"
    ), mapAppendix: "full" };
    const compacted = compactMapObservation(previous, next);
    expect(compacted.observation.elements[0]?.targetRef).toBe("lumen:a");
    expect(compacted.observation.mapAppendix).toBe("Controls unchanged. Use the same targetRefs.");
  });
});
