import { describe, expect, test } from "vitest";

import type { WorkbenchLumenFollowAction } from "../../../shared/workbench-browser";
import { compactFollowSession } from "../lumen-follow-audit";

const followAction = (
  index: number,
  action: WorkbenchLumenFollowAction["action"],
  result: WorkbenchLumenFollowAction["result"],
  summary: string
): WorkbenchLumenFollowAction => ({
  id: `follow-action-${index}`,
  at: 1_000 + index,
  tabId: "browser-tab-1",
  targetMode: "live",
  action,
  inputActive: action === "act" || action === "type" || action === "press",
  ...(result === undefined ? {} : { result }),
  summary
});

describe("compactFollowSession", () => {
  test("preserves FollowAction success and failure timeline in compact text", () => {
    const compact = compactFollowSession({
      interruptedCount: 0,
      finalPageState: {
        address: "https://example.com/menu",
        title: "Menu",
        isLoading: false
      },
      actions: [
        followAction(1, "observe", "success", "observe"),
        followAction(2, "act", "success", "click"),
        followAction(3, "type", "failure", "type failure")
      ]
    });

    expect(compact.actions.map((action) => action.result)).toEqual(["success", "success", "failure"]);
    expect(compact.compactText).toContain("observe -> click -> type failure");
    expect(compact.compactText).toContain("Final page: Menu (https://example.com/menu).");
    expect(compact.compactSummary).toMatchObject({
      observeCount: 1,
      pointerCount: 1,
      typeCount: 1
    });
  });

  test("splits long FollowSession summaries into chunk manifest", () => {
    const actions = Array.from({ length: 45 }, (_value, index) =>
      followAction(index + 1, "wait", "success", `wait-${index + 1}`)
    );

    const compact = compactFollowSession({
      interruptedCount: 0,
      actions
    });

    expect(compact.chunks).toHaveLength(2);
    expect(compact.chunks[0]).toMatchObject({
      index: 0,
      actionStart: 1,
      actionEnd: 40
    });
    expect(compact.chunks[1]).toMatchObject({
      index: 1,
      actionStart: 41,
      actionEnd: 45
    });
    expect(compact.compactSummary.waitCount).toBe(45);
  });
});
