import { describe, expect, test, vi } from "vitest";

import { accumulateExtractedText } from "../text/accumulate";

describe("accumulateExtractedText", () => {
  test("continues internally until the full text fits the safe result budget", async () => {
    const fetchChunk = vi.fn(async () => ({
      tabId: "browser-tab-1",
      scope: "main" as const,
      text: "b".repeat(2_288),
      startChar: 24_000,
      endChar: 26_288,
      totalChars: 26_288,
      hasMore: false,
      truncated: false,
      extractionMethod: "dom:main-text(main)"
    }));

    const result = await accumulateExtractedText({
      initial: {
        tabId: "browser-tab-1",
        scope: "main",
        text: "a".repeat(24_000),
        startChar: 0,
        endChar: 24_000,
        totalChars: 26_288,
        hasMore: true,
        nextCursor: 24_000,
        truncated: true,
        extractionMethod: "dom:main-text(main)"
      },
      maxCharsPerFetch: 28_000,
      fetchChunk
    });

    expect(fetchChunk).toHaveBeenCalledTimes(1);
    expect(result.text).toHaveLength(26_288);
    expect(result.endChar).toBe(26_288);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
    expect(result.truncated).toBe(false);
  });
});
