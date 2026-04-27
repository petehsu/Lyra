import { describe, expect, test } from "vitest";

import { CLASSIC_WORKBENCH_INTERACTION_POLICIES } from "../../interaction-policy";
import {
  hasClassicCtrlLeftSplitIntent,
  hasMovedPastRightDragThreshold,
  isClassicRightDragSplitEnabled,
  resolveWorkspaceTabDropTarget
} from "../tab-interactions";

const classicTabsPolicy = CLASSIC_WORKBENCH_INTERACTION_POLICIES.workspaceTabs;

describe("browser tab interactions", () => {
  test("resolves basic drop target by tab midpoint", () => {
    const target = resolveWorkspaceTabDropTarget({
      clientX: 155,
      hostLeft: 100,
      hostWidth: 400,
      stripLeft: 120,
      tabIds: ["a", "b", "c"],
      tabRects: [
        { id: "a", left: 120, right: 180 },
        { id: "b", left: 180, right: 240 },
        { id: "c", left: 240, right: 300 }
      ],
      splitGroupTabIds: [],
      reorderSnapPx: classicTabsPolicy.reorderSnapPx
    });

    expect(target).toEqual({
      targetIndex: 1,
      indicatorX: 80
    });
  });

  test("keeps split group drop targets outside the joined group", () => {
    const target = resolveWorkspaceTabDropTarget({
      clientX: 215,
      hostLeft: 100,
      hostWidth: 400,
      stripLeft: 120,
      tabIds: ["a", "b", "c", "d"],
      tabRects: [
        { id: "a", left: 120, right: 180 },
        { id: "b", left: 180, right: 240 },
        { id: "c", left: 240, right: 300 },
        { id: "d", left: 300, right: 360 }
      ],
      splitGroupTabIds: ["b", "c"],
      reorderSnapPx: classicTabsPolicy.reorderSnapPx,
      draggingWorkspaceTabId: "a"
    });

    expect(target.targetIndex).toBe(1);
    expect(target.indicatorX).toBe(80);
  });

  test("resolves split trigger policies", () => {
    expect(hasClassicCtrlLeftSplitIntent("ctrl_left_drag", true, true, classicTabsPolicy)).toBe(true);
    expect(hasClassicCtrlLeftSplitIntent("ctrl_left_drag", false, true, classicTabsPolicy)).toBe(false);
    expect(isClassicRightDragSplitEnabled("right_drag", true, classicTabsPolicy)).toBe(true);
    expect(isClassicRightDragSplitEnabled("ctrl_left_drag", true, classicTabsPolicy)).toBe(false);
  });

  test("applies right drag movement threshold", () => {
    expect(hasMovedPastRightDragThreshold(0, 0, 6, 8, 10)).toBe(true);
    expect(hasMovedPastRightDragThreshold(0, 0, 5, 5, 10)).toBe(false);
  });
});
