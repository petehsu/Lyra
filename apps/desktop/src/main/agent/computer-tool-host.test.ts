import { describe, expect, test } from "vitest";

import { createComputerToolHost } from "./computer-tool-host";

describe("computer-tool-host", () => {
  test("rejects unknown computer actions before native invocation", async () => {
    const { handlers } = createComputerToolHost();
    const result = await handlers["lyraComputer.act"]({
      osRef: "osax:0/1",
      action: "drag"
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "unsupportedAction" }
    });
  });

  test("map returns a structured native envelope", async () => {
    const { handlers } = createComputerToolHost();
    const result = await handlers["lyraComputer.map"]({ strategy: "interactive" });
    expect(typeof result.platform).toBe("string");
    expect(result.ok === true || result.error !== undefined).toBe(true);
  });

  test("requires a valid sensitiveValueRef for credential autofill", async () => {
    const { handlers } = createComputerToolHost({
      resolveSensitiveValueForFill: async () => "secret"
    });
    const result = await handlers["lyraComputer.act"]({
      osRef: "osax:0/2",
      sensitiveValueRef: { not: "a-ref" }
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "invalidArgument" }
    });
  });
});