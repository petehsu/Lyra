import { describe, expect, test } from "vitest";

import { fetchEngineResults } from "../providers";

describe("search providers", () => {
  test("returns deterministic unsupported-engine response", async () => {
    const response = await fetchEngineResults(
      {
        id: "custom-unsupported",
        label: "Custom",
        accentColor: "#fff"
      },
      "lyra",
      5
    );

    expect(response.results).toEqual([]);
    expect(response.error).toBe("unsupported engine: custom-unsupported");
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
