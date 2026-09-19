import { describe, expect, test } from "vitest";

import { createComputerToolHost } from "./computer-tool-host";
import {
  assertAgentHostCapabilityHandlers,
  isAgentHostCapabilityMethod,
  type AgentHostCapabilityHandlers
} from "./host-payload";

describe("assertAgentHostCapabilityHandlers", () => {
  test("rejects a method that is not on the frozen list", () => {
    expect(() =>
      assertAgentHostCapabilityHandlers({
        "not.a.host.method": async () => ({})
      } as AgentHostCapabilityHandlers)
    ).toThrow("unfrozen host capability method: not.a.host.method");
  });

  test("computer host only registers frozen method names", () => {
    const { handlers } = createComputerToolHost();
    assertAgentHostCapabilityHandlers(handlers);
    for (const method of Object.keys(handlers)) {
      expect(isAgentHostCapabilityMethod(method)).toBe(true);
    }
  });
});
