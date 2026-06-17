import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import type { WorkbenchBrowserAgentElement } from "../types";
import {
  executeWorkflowReplay,
  resolveWorkflowStepTarget
} from "../view-manager-runtime/agent-workflow-runtime";

let tempHome = "";

afterEach(async () => {
  const { setWorkflowCacheRootForTests } = await import("../view-manager-runtime/lumen-workflow-cache");
  setWorkflowCacheRootForTests(null);
  if (tempHome.length > 0) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = "";
  }
});

const element = (targetRef: string, fingerprint: string): WorkbenchBrowserAgentElement => ({
  id: 1,
  targetRef,
  stableId: targetRef.replace("lumen:", ""),
  target: {
    targetRef,
    targetKind: "button",
    frameRef: "lumen-frame:1",
    frameChain: ["lumen-frame:1"],
    elementFingerprint: fingerprint,
    mapEpoch: 1,
    expiresAt: Date.now() + 60_000
  },
  frameRef: "lumen-frame:1",
  elementFingerprint: fingerprint,
  frameTreeNodeId: 1,
  tagName: "button",
  role: "button",
  label: "Continue",
  selectorPreview: "button#continue",
  bounds: { x: 0, y: 0, width: 80, height: 32 },
  focusable: true,
  disabled: false,
  editable: false
});

describe("agent-workflow-replay", () => {
  test("resolveWorkflowStepTarget remaps stale targetRef via identity", async () => {
    const resolved = await resolveWorkflowStepTarget({
      tabId: "tab-1",
      targetMode: "live",
      normalizedUrl: "https://example.test/",
      step: {
        targetRef: "lumen:stale",
        interaction: "click",
        identity: {
          elementFingerprint: "fp-old",
          stableFingerprint: "stable-old",
          label: "Continue",
          role: "button",
          frameRef: "lumen-frame:1",
          selectorPreview: "button#continue"
        }
      },
      resolveTargetRef: () => ({ ok: false }),
      observePage: async () => ({
        ok: true,
        kind: "lyraLumenMap",
        tabId: "tab-1",
        targetMode: "live",
        observationId: "obs-1",
        mapEpoch: 2,
        strategy: "interactiveOnly",
        url: "https://example.test/",
        title: "Example",
        targets: [],
        elements: [element("lumen:fresh", "fp-new")],
        activeElementId: null,
        focusOrder: []
      })
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.targetRef).toBe("lumen:fresh");
      expect(resolved.matchLevel).toBe("axName");
    }
  });

  test("executeWorkflowReplay records resolvedSteps and succeeds", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "lyra-workflow-replay-"));
    const {
      appendWorkflowCacheStep,
      setWorkflowCacheRootForTests
    } = await import("../view-manager-runtime/lumen-workflow-cache");
    setWorkflowCacheRootForTests(join(tempHome, ".lyra", "browser-workflows"));

    const url = "https://example.test/";
    appendWorkflowCacheStep(
      "wf-test",
      { normalizedUrl: url, targetMode: "live" },
      {
        targetRef: "lumen:stale",
        interaction: "click",
        identity: {
          elementFingerprint: "fp-old",
          stableFingerprint: "stable-old",
          label: "Continue",
          role: "button",
          frameRef: "lumen-frame:1",
          selectorPreview: "button#continue"
        }
      }
    );

    const actStep = vi.fn(async () => ({
      ok: true,
      kind: "lyraLumenActionResult" as const,
      tabId: "tab-1",
      inputMode: "chromium" as const,
      targetMode: "live" as const,
      elementDiff: {
        before: { role: "button", label: "Continue", disabled: false },
        after: { role: "button", label: "Continue", disabled: false, checked: true },
        changed: ["checked"]
      }
    }));

    const result = await executeWorkflowReplay({
      tabId: "tab-1",
      targetMode: "live",
      workflowId: "wf-test",
      normalizedUrl: url,
      resolveStep: async (step) => ({
        ok: true,
        targetRef: step.targetRef === "lumen:stale" ? "lumen:fresh" : step.targetRef,
        matchLevel: step.targetRef === "lumen:stale" ? "stable" : "exact"
      }),
      actStep
    });

    expect(result.ok).toBe(true);
    expect(result.cacheHit).toBe(true);
    expect(result.resolvedSteps).toEqual([
      { index: 0, from: "lumen:stale", to: "lumen:fresh", matchLevel: "stable" }
    ]);
    expect(actStep).toHaveBeenCalledWith(
      expect.objectContaining({ targetRef: "lumen:stale" }),
      expect.objectContaining({ targetRef: "lumen:fresh", matchLevel: "stable" })
    );
  });
});