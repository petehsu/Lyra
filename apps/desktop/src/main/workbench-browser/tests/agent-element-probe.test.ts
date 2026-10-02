import { describe, expect, test } from "vitest";

import {
  buildElementDiff,
  diffElementStates,
  elementStateFromCached
} from "../view-manager-runtime/agent-element-probe";
import type { WorkbenchBrowserAgentElement } from "../types";

const sampleElement = (): WorkbenchBrowserAgentElement => ({
  id: 3,
  targetRef: "lumen:test",
  stableId: "stable",
  target: {
    targetRef: "lumen:test",
    targetKind: "button",
    tabId: "tab-1",
    frameRef: "frame:1",
    frameChain: ["frame:1"],
    elementFingerprint: "fp",
    mapEpoch: 1,
    expiresAt: Date.now() + 60_000
  },
  frameRef: "frame:1",
  elementFingerprint: "fp",
  frameTreeNodeId: 1,
  tagName: "button",
  role: "button",
  label: "Save",
  selectorPreview: "button.save",
  bounds: { x: 10, y: 20, width: 80, height: 24 },
  focusable: true,
  disabled: false,
  editable: false,
  checked: false
});

describe("agent-element-probe", () => {
  test("diffElementStates reports checked transition", () => {
    const before = elementStateFromCached(sampleElement());
    const after = { ...before, checked: true };
    expect(diffElementStates(before, after)).toEqual(["checked: false -> true"]);
  });

  test("reads a pressed hint as the checked bit so a toggle click is a change", () => {
    const { checked: _omitted, ...withoutChecked } = sampleElement();
    const before = elementStateFromCached({ ...withoutChecked, stateHint: "unpressed" });
    const after = { ...before, checked: true };
    expect(before.checked).toBe(false);
    expect(diffElementStates(before, after)).toEqual(["checked: false -> true"]);
  });

  test("buildElementDiff marks noObservableChange when unchanged", () => {
    const before = elementStateFromCached(sampleElement());
    const diff = buildElementDiff(before, before);
    expect("noObservableChange" in diff && diff.noObservableChange).toBe(true);
  });
  test("an empty button value is not a state transition", () => {
    const before = { role: "button", label: "Open menu", disabled: false };
    expect(diffElementStates(before, { ...before, value: "" })).toEqual([]);
  });
});
