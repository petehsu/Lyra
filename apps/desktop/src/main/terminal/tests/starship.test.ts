import { describe, expect, test } from "vitest";

import { buildStarshipPromptInjection } from "../starship";

const missingRuntime = {
  binaryPath: null,
  source: "missing",
  reason: "missing",
  configDir: "/tmp/lyra"
} as const;

describe("starship prompt injection", () => {
  test("uses shell fallback prompt when starship is unavailable", () => {
    const result = buildStarshipPromptInjection(missingRuntime, {
      shell: "/bin/bash",
      presetId: "glacier-blocks",
      uiThemeId: "one-dark"
    });

    expect(result.applied).toBe(true);
    expect(result.deferred).toBe(false);
    expect(result.command).toContain("PS1=");
  });

  test("creates visibly different fallback prompt structures per preset", () => {
    const ocean = buildStarshipPromptInjection(missingRuntime, {
      shell: "/bin/bash",
      presetId: "ocean-matrix",
      uiThemeId: "one-dark"
    });
    const amber = buildStarshipPromptInjection(missingRuntime, {
      shell: "/bin/bash",
      presetId: "amber-forge",
      uiThemeId: "one-dark"
    });

    expect(ocean.command).toContain("┌─");
    expect(amber.command).toContain("");
  });
});

