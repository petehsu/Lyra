import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

let tempHome = "";

afterEach(async () => {
  const { setWorkflowCacheRootForTests } = await import("../view-manager-runtime/lumen-workflow-cache");
  setWorkflowCacheRootForTests(null);
  if (tempHome.length > 0) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = "";
  }
});

describe("lumen-workflow-cache", () => {
  test("record and replay workflow entries by url", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "lyra-workflow-cache-"));

    const {
      appendWorkflowCacheStep,
      detectWorkflowVariableKey,
      loadWorkflowCacheForReplay,
      normalizeUrlForWorkflowCache,
      setWorkflowCacheRootForTests
    } = await import("../view-manager-runtime/lumen-workflow-cache");
    expect(detectWorkflowVariableKey({
      interaction: "type",
      label: "Password",
      inputType: "password"
    })).toBe("password");
    setWorkflowCacheRootForTests(join(tempHome, ".lyra", "browser-workflows"));

    const url = normalizeUrlForWorkflowCache("https://example.test/login#frag");
    appendWorkflowCacheStep(
      "login-flow",
      { normalizedUrl: url, targetMode: "live" },
      {
        targetRef: "lumen:btn-1",
        interaction: "click",
        label: "Sign in",
        identity: {
          elementFingerprint: "fp-1",
          stableFingerprint: "stable-1",
          label: "Sign in",
          role: "button",
          frameRef: "lumen-frame:1",
          selectorPreview: "button#signin"
        }
      }
    );

    expect(existsSync(join(tempHome, ".lyra", "browser-workflows"))).toBe(true);

    const hit = loadWorkflowCacheForReplay("login-flow", {
      normalizedUrl: url,
      targetMode: "live"
    });
    expect(hit.mode).toBe("hit");
    if (hit.mode === "hit") {
      expect(hit.entry.steps).toHaveLength(1);
      expect(hit.entry.steps[0]?.targetRef).toBe("lumen:btn-1");
      expect(hit.entry.version).toBe(2);
      expect(hit.entry.steps[0]?.identity?.label).toBe("Sign in");
    }

    const miss = loadWorkflowCacheForReplay("login-flow", {
      normalizedUrl: normalizeUrlForWorkflowCache("https://example.test/other"),
      targetMode: "live"
    });
    expect(miss.mode).toBe("miss");
  });
});