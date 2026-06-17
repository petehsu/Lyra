import { describe, expect, test } from "vitest";

import { verifyBrowserAgentTrajectory } from "./browser-agent-verifier";

describe("browser-agent-verifier", () => {
  test("flags cache miss and no-diff acts", () => {
    const report = verifyBrowserAgentTrajectory({
      steps: [
        {
          toolPath: "/tools/browser/act",
          ok: true,
          elementDiffChanged: []
        },
        {
          toolPath: "/tools/browser/act",
          ok: false,
          cacheMiss: true
        }
      ]
    });
    expect(report.escalationRecommended).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
  });
});