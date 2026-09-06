import { describe, expect, it } from "vitest";

import type { WorkbenchBrowserPageDiagnosticEntry } from "../../../shared/desktop-bridge";
import {
  authSignalsFromPageDiagnostics,
  normalizeAuthChallengeSignals
} from "./agent-auth-signals";

const diagnostic = (
  overrides: Partial<WorkbenchBrowserPageDiagnosticEntry>
): WorkbenchBrowserPageDiagnosticEntry => ({
  id: "diagnostic-1",
  at: 1,
  source: "network",
  severity: "error",
  message: "request failed",
  ...overrides
});

describe("browser authentication signals", () => {
  it("ignores authentication failures from subresources", () => {
    expect(authSignalsFromPageDiagnostics([
      diagnostic({ status: 401, resourceType: "Fetch", url: "https://example.test/api" }),
      diagnostic({ status: 403, resourceType: "Image", url: "https://example.test/avatar" })
    ])).toEqual([]);
  });

  it("keeps a main-document 401 informational until page observation confirms it", () => {
    expect(authSignalsFromPageDiagnostics([
      diagnostic({ status: 401, resourceType: "Document", url: "https://example.test/login" })
    ])).toEqual([expect.objectContaining({
      kind: "login_wall",
      scope: "main_document",
      actionability: "informational",
      confidence: "low",
      reasonCode: "http_auth_response",
      stableObservationCount: 1
    })]);
  });

  it("drops malformed DOM authentication observations", () => {
    expect(normalizeAuthChallengeSignals([
      { kind: "login_wall", confidence: "certain", source: "dom" },
      { kind: "unknown", confidence: "high", source: "dom" },
      null
    ])).toEqual([]);
  });
});
