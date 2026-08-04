import { describe, expect, test, vi } from "vitest";

import { createUnavailableRuntimeClient } from "../unavailable-client";

describe("Runtime repair client", () => {
  test("keeps Core alive while refusing Runtime work", async () => {
    const client = createUnavailableRuntimeClient(new Error("signature mismatch"));
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);

    await expect(client.request("runtime.identity", {})).rejects.toMatchObject({
      code: "RUNTIME_REPAIR_REQUIRED",
      message: expect.stringContaining("signature mismatch")
    });
    expect(() => client.registerRequestHandler("host.test", vi.fn())).not.toThrow();
    expect(() => unsubscribe()).not.toThrow();
  });
});
