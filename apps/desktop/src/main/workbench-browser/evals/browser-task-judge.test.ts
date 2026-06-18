import { describe, expect, test } from "vitest";

import { judgeBrowserAgentTask } from "./browser-task-judge";

describe("browser-task-judge", () => {
  test("marks captcha-blocked tasks as blocked", () => {
    const verdict = judgeBrowserAgentTask({
      goal: "submit the form",
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
});