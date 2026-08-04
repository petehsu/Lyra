import { beforeEach, describe, expect, test } from "vitest";

import {
  hasAcceptedCurrentLegalDocuments,
  LEGAL_ACCEPTANCE_KEY,
  LEGAL_DOCUMENT_VERSION,
  readLegalAcceptance,
  recordLegalAcceptance
} from "./startup-legal";

beforeEach(() => {
  window.localStorage.clear();
});

describe("startup legal acceptance", () => {
  test("records the exact document version and timestamp", () => {
    const acceptedAt = new Date("2026-08-01T12:00:00.000Z");
    expect(recordLegalAcceptance(acceptedAt)).toEqual({
      termsVersion: LEGAL_DOCUMENT_VERSION,
      privacyVersion: LEGAL_DOCUMENT_VERSION,
      acceptedAt: acceptedAt.toISOString()
    });
    expect(hasAcceptedCurrentLegalDocuments()).toBe(true);
  });

  test("rejects stale, malformed, or missing acceptance", () => {
    expect(readLegalAcceptance()).toBeNull();
    window.localStorage.setItem(LEGAL_ACCEPTANCE_KEY, "not-json");
    expect(readLegalAcceptance()).toBeNull();
    window.localStorage.setItem(LEGAL_ACCEPTANCE_KEY, JSON.stringify({
      termsVersion: "0.2.0",
      privacyVersion: "0.2.0",
      acceptedAt: "2026-08-01T12:00:00.000Z"
    }));
    expect(readLegalAcceptance()).toBeNull();
  });
});
