import { describe, expect, test } from "vitest";

import type { JsonValue } from "@lyra/app-runtime";

import type { WorkspaceTab } from "../workspace-tabs/types";
import { exclusiveSplitGroupTabIds } from "../workspace-tabs/split-model";
import {
  AGENT_SUBAGENT_APP_ID,
  isSubagentTabInGroup,
  orderSubagentSplitTabIds,
  parseSubagentOpaqueState,
  subagentSplitGroupKey
} from "./group";

const tab = (
  id: string,
  opaque: Record<string, JsonValue>
): WorkspaceTab => ({
  id,
  title: id,
  pageKind: "app",
  inputValue: "",
  displayAddress: `lyra://app/${AGENT_SUBAGENT_APP_ID}/${id}`,
  faviconUrl: undefined,
  query: undefined,
  appId: AGENT_SUBAGENT_APP_ID,
  appInstanceId: id,
  appOpaqueState: opaque
});

describe("agent-subagent grouping", () => {
  test("spawn workers group by parent session, plan workers by planId", () => {
    expect(subagentSplitGroupKey({ parentSessionId: "parent-1" })).toBe("spawn:parent-1");
    expect(subagentSplitGroupKey({
      parentSessionId: "parent-1",
      planId: "plan-9"
    })).toBe("plan:plan-9");
  });

  test("does not mix spawn tabs with plan workers or file tabs", () => {
    const spawn = tab("w1", { parentSessionId: "parent-1", subagentId: "child-1" });
    const plan = tab("w2", {
      parentSessionId: "parent-1",
      subagentId: "child-2",
      planId: "plan-9"
    });
    const file = {
      ...tab("file-1", {}),
      appId: "file-editor",
      appOpaqueState: {}
    };
    const group = subagentSplitGroupKey({ parentSessionId: "parent-1" });
    expect(isSubagentTabInGroup(spawn, group)).toBe(true);
    expect(isSubagentTabInGroup(plan, group)).toBe(false);
    expect(isSubagentTabInGroup(file, group)).toBe(false);
  });

  test("keeps existing split order and appends the newly opened worker", () => {
    expect(orderSubagentSplitTabIds(["a", "b"], ["a", "b", "c"], "c")).toEqual(["a", "b", "c"]);
    expect(orderSubagentSplitTabIds(["b", "a"], ["a", "b"], "a")).toEqual(["b", "a"]);
  });

  test("replace_oldest drops the earliest worker when a fifth joins the group", () => {
    expect(exclusiveSplitGroupTabIds(["a", "b", "c", "d", "e"])).toEqual(["b", "c", "d", "e"]);
  });

  test("rejects opaque state without parent and child ids", () => {
    expect(parseSubagentOpaqueState({ subagentId: "child-1" })).toBeNull();
    expect(parseSubagentOpaqueState({
      parentSessionId: "parent-1",
      subagentId: "child-1",
      planId: "plan-9"
    })).toEqual({
      parentSessionId: "parent-1",
      subagentId: "child-1",
      planId: "plan-9"
    });
  });
});
