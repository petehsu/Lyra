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

const withSignature = (
  candidate: LiveSelectorScanCandidateRecord,
  overrides: Partial<LiveSelectorScanCandidateRecord>
): LiveSelectorScanCandidateRecord => ({
  ...candidate,
  ...overrides,
  stableSignature: {
    ...candidate.stableSignature,
    ...(overrides.stableSignature ?? {})
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
      pageMode: "chat",
      widgets: [],
      containerNodes: [],
      candidates: [makeCandidate("older-candidate")]
    });
    const newer = registry.write({
      tabId: "browser-tab-1",
      scope: "nearby",
      intent: { operation: "type" },
      pageMode: "chat",
      widgets: [],
      containerNodes: [],
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
      pageMode: "form",
      widgets: [],
      containerNodes: [],
      candidates: [makeCandidate("shared-candidate")]
    });
    registry.write({
      tabId: "browser-tab-2",
      scope: "nearby",
      intent: { operation: "click" },
      pageMode: "form",
      widgets: [],
      containerNodes: [],
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
      pageMode: "chat",
      widgets: [],
      containerNodes: [],
      candidates: [makeCandidate("approval-candidate")]
    });

    vi.advanceTimersByTime(15_000);

    const resolved = registry.readRecentCandidate("approval-candidate", {
      tabId: "browser-tab-3"
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.candidate.candidateId).toBe("approval-candidate");
  });

  test("finds the best recent candidate by semantic matcher and preferred session", () => {
    const registry = new LiveSelectorScanRegistry();
    const older = registry.write({
      tabId: "browser-tab-4",
      scope: "visible",
      intent: { operation: "click" },
      pageMode: "chat",
      widgets: [],
      containerNodes: [],
      candidates: [
        withSignature(makeCandidate("profile-button"), {
          tagName: "button",
          ariaLabel: "Open profile menu",
          stableSignature: {
            tagName: "button",
            testId: "accounts-profile-button",
            ariaLabel: "Open profile menu"
          }
        })
      ]
    });
    const preferred = registry.write({
      tabId: "browser-tab-4",
      scope: "visible",
      intent: { operation: "click" },
      pageMode: "chat",
      widgets: [],
      containerNodes: [],
      candidates: [
        withSignature(makeCandidate("model-selector"), {
          tagName: "button",
          ariaLabel: "Model selector",
          stableSignature: {
            tagName: "button",
            testId: "model-switcher-dropdown-button",
            ariaLabel: "Model selector"
          }
        })
      ]
    });

    const resolved = registry.findRecentCandidate({
      tabId: "browser-tab-4",
      preferredScanSessionId: preferred.scanSessionId,
      match: (candidate) => candidate.stableSignature.testId === "model-switcher-dropdown-button" ? 100 : -100
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.scanSessionId).toBe(preferred.scanSessionId);
    expect(resolved?.candidate.candidateId).toBe("model-selector");
    expect(resolved?.scanSessionId).not.toBe(older.scanSessionId);
  });
});
