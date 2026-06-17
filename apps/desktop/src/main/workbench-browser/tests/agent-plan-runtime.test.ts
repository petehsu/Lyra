import { describe, expect, test } from "vitest";

import { buildPlanCandidates } from "../view-manager-runtime/agent-plan-runtime";
import type { WorkbenchBrowserAgentObservation } from "../types";

const observation = (): WorkbenchBrowserAgentObservation => ({
  ok: true,
  kind: "lyraLumenMap",
  tabId: "tab-1",
  targetMode: "live",
  observationId: "obs-1",
  mapEpoch: 1,
  strategy: "interactiveOnly",
  url: "https://example.test",
  title: "Example",
  targets: [],
  elements: [
    {
      id: 1,
      targetRef: "lumen:email",
      stableId: "s1",
      target: {
        targetRef: "lumen:email",
        targetKind: "textbox",
        frameRef: "frame:1",
        stableId: "s1",
        elementFingerprint: "fp1",
        mapEpoch: 1
      },
      frameRef: "frame:1",
      elementFingerprint: "fp1",
      frameTreeNodeId: 1,
      tagName: "input",
      role: "textbox",
      label: "Email",
      selectorPreview: "input#email",
      bounds: { x: 10, y: 10, width: 200, height: 30 },
      focusable: true,
      disabled: false,
      editable: true,
      inputType: "email"
    },
    {
      id: 2,
      targetRef: "lumen:pass",
      stableId: "s2",
      target: {
        targetRef: "lumen:pass",
        targetKind: "textbox",
        frameRef: "frame:1",
        stableId: "s2",
        elementFingerprint: "fp2",
        mapEpoch: 1
      },
      frameRef: "frame:1",
      elementFingerprint: "fp2",
      frameTreeNodeId: 1,
      tagName: "input",
      role: "textbox",
      label: "Password",
      selectorPreview: "input#password",
      bounds: { x: 10, y: 60, width: 200, height: 30 },
      focusable: true,
      disabled: false,
      editable: true,
      inputType: "password"
    }
  ],
  activeElementId: null,
  focusOrder: []
});

describe("agent-plan-runtime", () => {
  test("buildPlanCandidates derives type interaction and sensitive slots", () => {
    const candidates = buildPlanCandidates({
      observation: observation(),
      labelIncludes: ["password"]
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.interaction).toBe("type");
    expect(candidates[0]?.sensitiveSlot).toBe("password");
  });
});