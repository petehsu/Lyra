import { describe, expect, test } from "vitest";

import {
  inferSubgoalFromAction,
  inferSubgoalFromIntent,
  isActionRevealTriggerCandidate,
  isRevealStateTransition,
  resolveActiveItemId,
  shouldResetWorkflowContext,
} from "../service-modules/workflow-heuristics";

describe("workflow heuristics", () => {
  test("maps intent operations to subgoals", () => {
    expect(inferSubgoalFromIntent({ operation: "hover" } as any)).toBe("reveal item actions");
    expect(inferSubgoalFromIntent({ operation: "type" } as any)).toBe("locate composer");
    expect(inferSubgoalFromIntent({ operation: "focus" } as any)).toBe("locate target");
  });

  test("resolves active item id by widget kind", () => {
    expect(resolveActiveItemId({
      widgetKind: "list-item",
      widgetId: "item-1",
      ownerWidgetId: "list-1"
    } as any)).toBe("item-1");
    expect(resolveActiveItemId({
      widgetKind: "button",
      widgetId: "button-1",
      ownerWidgetId: "toolbar-1"
    } as any)).toBe("toolbar-1");
  });

  test("maps action kinds to subgoals", () => {
    expect(inferSubgoalFromAction({ kind: "click" } as any)).toBe("execute menu action");
    expect(inferSubgoalFromAction({ kind: "goto_url" } as any)).toBe("navigate");
    expect(inferSubgoalFromAction({ kind: "expand_probe" } as any)).toBe("act");
  });

  test("detects reveal trigger candidates", () => {
    expect(isActionRevealTriggerCandidate({
      widgetKind: "menu-trigger"
    } as any)).toBe(true);
    expect(isActionRevealTriggerCandidate({
      widgetKind: "button",
      affordanceAction: "open menu"
    } as any)).toBe(true);
    expect(isActionRevealTriggerCandidate({
      widgetKind: "button",
      stateHint: "expanded"
    } as any)).toBe(true);
    expect(isActionRevealTriggerCandidate({
      widgetKind: "button",
      affordanceAction: "submit"
    } as any)).toBe(false);
  });

  test("decides whether workflow context should reset", () => {
    expect(shouldResetWorkflowContext({
      actionKind: "goto_url",
      verification: undefined
    } as any)).toBe(true);

    expect(shouldResetWorkflowContext({
      actionKind: "click",
      verification: {
        stateTransition: "navigation_changed",
        widgetKind: "menu-trigger"
      }
    } as any)).toBe(false);

    expect(shouldResetWorkflowContext({
      actionKind: "click",
      verification: {
        stateTransition: "navigation_changed",
        widgetKind: "button"
      }
    } as any)).toBe(true);
  });

  test("detects reveal state transitions", () => {
    expect(isRevealStateTransition("menu_opened")).toBe(true);
    expect(isRevealStateTransition("region_expanded")).toBe(true);
    expect(isRevealStateTransition("state_changed")).toBe(true);
    expect(isRevealStateTransition("navigation_changed" as any)).toBe(false);
  });
});
