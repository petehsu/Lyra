import { describe, expect, test } from "vitest";

import {
  AGENT_HOST_CAPABILITY_METHODS,
  isAgentHostCapabilityMethod
} from "./agent-host-capabilities";

describe("agent host capability method freeze", () => {
  test("names are unique", () => {
    expect(new Set(AGENT_HOST_CAPABILITY_METHODS).size).toBe(
      AGENT_HOST_CAPABILITY_METHODS.length
    );
  });

  test("accepts frozen names and rejects names that are not on the list", () => {
    expect(isAgentHostCapabilityMethod("lyraLumen.map")).toBe(true);
    expect(isAgentHostCapabilityMethod("workbench.browser.readSessionSnapshot")).toBe(true);
    expect(isAgentHostCapabilityMethod("sensitiveValues.storeForAgentUse")).toBe(true);
    expect(isAgentHostCapabilityMethod("lyraLumen.judgeTask")).toBe(false);
    expect(isAgentHostCapabilityMethod("agent.session.read")).toBe(false);
  });
});
