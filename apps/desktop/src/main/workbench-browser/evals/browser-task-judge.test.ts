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
        elements: [{
          id: 1,
          targetRef: "lumen:status",
          stableId: "status",
          target: {
            targetRef: "lumen:status",
            targetKind: "element",
            tabId: "tab-1",
            frameRef: "main",
            frameChain: [],
            elementFingerprint: "status",
            mapEpoch: 1,
            expiresAt: Date.now() + 60_000
          },
          frameRef: "main",
          elementFingerprint: "status",
          frameTreeNodeId: 1,
          tagName: "div",
          role: "status",
          label: "Completed",
          selectorPreview: "[role=status]",
          bounds: { x: 0, y: 0, width: 100, height: 20 },
          focusable: false,
          disabled: false,
          editable: false
        }],
        authChallengeSignals: [],
        blockedRegions: []
      }
    });
    expect(verdict.status).toBe("uncertain");
  });
});
