import { describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  utilityProcess: { fork: vi.fn() }
}));

const { runtimeRoleForMethod } = await import("./role-runtime-client");

describe("runtime host routing", () => {
  test("sends each method family to its own host", () => {
    expect(runtimeRoleForMethod("terminal.session.create")).toBe("terminal");
    expect(runtimeRoleForMethod("files.list")).toBe("files");
    expect(runtimeRoleForMethod("agent.turn")).toBe("agent");
    expect(runtimeRoleForMethod("agent.proactive.list")).toBe("agent");
    expect(runtimeRoleForMethod("download.list")).toBe("services");
    expect(runtimeRoleForMethod("runtime.identity")).toBe("services");
  });
});
