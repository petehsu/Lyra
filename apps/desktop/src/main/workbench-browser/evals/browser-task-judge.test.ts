import { describe, expect, test } from "vitest";

import { judgeBrowserAgentTask } from "./browser-task-judge";

describe("browser-task-judge", () => {
  test("marks captcha-blocked tasks as blocked", () => {
    const verdict = judgeBrowserAgentTask({
      trajectory: { steps: [{ toolPath: "/tools/browser/act", ok: true }] },
      finalObservation: {
        url: "https://example.test/login",
        title: "Login",
        elements: [],
        authChallengeSignals: [{
          kind: "captcha",
          confidence: "high",
          source: "frame",
          label: "recaptcha"
        }],
        nextRecommendedAction: "ask_user"
      }
    });
    expect(verdict.status).toBe("blocked");
    expect(verdict.recommendedAction).toBe("ask_user");
  });

  test("marks empty trajectories as incomplete", () => {
    const verdict = judgeBrowserAgentTask({
      trajectory: { steps: [] }
    });
    expect(verdict.status).toBe("incomplete");
  });

  test("does not infer completion from visible page copy", () => {
    const verdict = judgeBrowserAgentTask({
      trajectory: {
        steps: [{
          toolPath: "/tools/browser/act",
          ok: true,
          elementDiffChanged: ["status"]
        }]
      },
      finalObservation: {
        url: "https://example.test/complete",
        title: "Completed",
        elements: [{ elementId: 1, role: "status", label: "Completed" }],
        authChallengeSignals: [],
        blockedRegions: []
      }
    });
    expect(verdict.status).toBe("uncertain");
  });
});
