import { describe, expect, test } from "vitest";

import { createWorkbenchChromeBus } from "../workbench-chrome-bus";

describe("workbench chrome bus", () => {
  test("merges toolbar actions and chips from multiple owners", () => {
    const bus = createWorkbenchChromeBus();
    const scope = { kind: "workspaceTab" as const, tabId: "tab-1" };
    bus.set({
      scope,
      slot: "toolbarContext",
      ownerId: "lyra.core",
      contribution: {
        chips: [{ id: "core", text: "Core", order: 1 }]
      }
    });
    bus.set({
      scope,
      slot: "toolbarContext",
      ownerId: "lyra.notifications",
      contribution: {
        actions: [{
          id: "mark-all",
          label: "Mark all as read",
          commandId: "lyra.notifications.mark-all-read",
          order: 0
        }]
      }
    });
    const merged = bus.read(scope, "toolbarContext");
    expect(merged?.actions?.[0]?.id).toBe("mark-all");
    expect(merged?.chips?.[0]?.text).toBe("Core");
  });

  test("rejects empty aiSession scope", () => {
    const bus = createWorkbenchChromeBus();
    expect(() =>
      bus.set({
        scope: { kind: "aiSession", sessionId: "" },
        slot: "composerMeta",
        ownerId: "lyra.core",
        contribution: { metaItems: [{ kind: "builtin", id: "projectDir", order: 0 }] }
      })
    ).toThrow("Invalid workbench chrome scope.");
  });

  test("identical set does not notify again", () => {
    const bus = createWorkbenchChromeBus();
    const scope = { kind: "workspaceTab" as const, tabId: "tab-3" };
    const contribution = { navigation: { mode: "hidden" as const } };
    let notifications = 0;
    bus.subscribe(() => {
      notifications += 1;
    });
    bus.set({
      scope,
      slot: "navigation",
      ownerId: "lyra.notifications",
      contribution
    });
    bus.set({
      scope,
      slot: "navigation",
      ownerId: "lyra.notifications",
      contribution: { navigation: { mode: "hidden" } }
    });
    expect(notifications).toBe(1);
  });

  test("clears workspace tab scopes", () => {
    const bus = createWorkbenchChromeBus();
    const scope = { kind: "workspaceTab" as const, tabId: "tab-2" };
    bus.set({
      scope,
      slot: "navigation",
      ownerId: "lyra.notifications",
      contribution: { navigation: { mode: "hidden" } }
    });
    bus.clearWorkspaceTab("tab-2");
    expect(bus.read(scope, "navigation")).toBeNull();
  });
});
