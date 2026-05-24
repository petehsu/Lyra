import { describe, expect, test } from "vitest";

import { createExtractedObservationText } from "../text/flatten";

describe("createExtractedObservationText", () => {
  test("keeps cursor continuation for truncated file editor buffers", () => {
    const result = createExtractedObservationText({
      tabId: "file-tab-1",
      scope: "full",
      cursor: 0,
      maxChars: 100,
      observation: {
        kind: "file-editor",
        filePath: "/tmp/example.ts",
        title: "example.ts",
        languageId: "typescript",
        status: "ready",
        isDirty: true,
        isReadOnly: false,
        content: "x".repeat(100),
        truncated: true
      }
    });

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(100);
    expect(result.truncated).toBe(true);
  });

  test("does not invent cursor continuation for truncated structured search summaries", () => {
    const result = createExtractedObservationText({
      tabId: "search-tab-1",
      scope: "full",
      cursor: 0,
      maxChars: 10_000,
      observation: {
        kind: "search-results",
        query: "gpt-5.4",
        searchMode: "standard",
        webStatus: "done",
        localStatus: "done",
        blendedResults: [],
        localResults: [],
        truncated: true
      }
    });

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
    expect(result.truncated).toBe(true);
  });
});
