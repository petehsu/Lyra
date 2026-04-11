import { afterEach, describe, expect, test, vi } from "vitest";

import { LiveSelectorScanRegistry } from "../live-selector/scan-session";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

const makeCandidate = (candidateId: string): LiveSelectorScanCandidateRecord => ({
  candidateId,
  frameTreeNodeId: 1,
  tagName: "textarea",
  selectorPreview: "textarea.compose",
  visibilityState: "visible",
  interactable: {
    clickable: true,
    typable: true,
    selectable: false,
    focusable: true
  },
  bounds: {
    x: 10,
    y: 20,
    width: 300,
    height: 48
  },
  score: 0.95,
  selectorAddress: {
    frameTreeNodeId: 1,
    path: "textarea.compose"
  },
  stableSignature: {
    tagName: "textarea",
    role: "textbox"
  }
});

describe("live selector scan registry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("finds recent candidate by id within the same tab", () => {
    const registry = new LiveSelectorScanRegistry();
    const older = registry.write({
      tabId: "browser-tab-1",
      scope: "visible",
      intent: { operation: "type" },
      candidates: [makeCandidate("older-candidate")]
    });
    const newer = registry.write({
      tabId: "browser-tab-1",
      scope: "nearby",
      intent: { operation: "type" },
      candidates: [makeCandidate("newer-candidate")]
    });

    const resolved = registry.readRecentCandidate("newer-candidate", {
      tabId: "browser-tab-1"
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.scanSessionId).toBe(newer.scanSessionId);
    expect(resolved?.candidate.candidateId).toBe("newer-candidate");
    expect(resolved?.scanSessionId).not.toBe(older.scanSessionId);
  });

  test("prefers the provided scan session before falling back to recent lookup", () => {
    const registry = new LiveSelectorScanRegistry();
    const first = registry.write({
      tabId: "browser-tab-2",
      scope: "visible",
      intent: { operation: "click" },
      candidates: [makeCandidate("shared-candidate")]
    });
    registry.write({
      tabId: "browser-tab-2",
      scope: "nearby",
      intent: { operation: "click" },
      candidates: [makeCandidate("shared-candidate")]
    });

    const resolved = registry.readRecentCandidate("shared-candidate", {
      tabId: "browser-tab-2",
      preferredScanSessionId: first.scanSessionId
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.scanSessionId).toBe(first.scanSessionId);
  });

  test("keeps scan candidates alive across short approval delays", () => {
    vi.useFakeTimers();
    const registry = new LiveSelectorScanRegistry();
    registry.write({
      tabId: "browser-tab-3",
      scope: "visible",
      intent: { operation: "type" },
      candidates: [makeCandidate("approval-candidate")]
    });

    vi.advanceTimersByTime(15_000);

    const resolved = registry.readRecentCandidate("approval-candidate", {
      tabId: "browser-tab-3"
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.candidate.candidateId).toBe("approval-candidate");
  });
});
