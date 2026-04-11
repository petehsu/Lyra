import { describe, expect, test } from "vitest";

import { resolveActiveDocumentCandidate } from "../resolver";

describe("resolveActiveDocumentCandidate", () => {
  test("prefers fetchable pdf candidates over generic viewer fallbacks", () => {
    const result = resolveActiveDocumentCandidate([
      {
        candidateId: "viewer",
        tabId: "browser-tab-1",
        sourceKind: "viewer_dom",
        formatHint: "unknown",
        visibleRatio: 1
      },
      {
        candidateId: "pdf",
        tabId: "browser-tab-1",
        sourceKind: "iframe",
        documentUrl: "https://example.com/file.pdf",
        formatHint: "pdf",
        visibleRatio: 0.6
      }
    ]);

    expect(result?.candidateId).toBe("pdf");
  });
});
