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

  test("flattens image viewer metadata for text extraction", () => {
    const result = createExtractedObservationText({
      tabId: "image-tab-1",
      scope: "main",
      cursor: 0,
      maxChars: 10_000,
      observation: {
        kind: "image-viewer",
        filePath: "/tmp/ChatGPT Image 2026年5月10日 00_10_01.png",
        title: "ChatGPT Image 2026年5月10日 00_10_01.png",
        status: "ready",
        mimeType: "image/png",
        width: 1024,
        height: 768,
        levels: [],
        viewport: {
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          background: "checkerboard"
        },
        siblingIndex: 0,
        siblingCount: 1,
        truncated: false
      }
    });

    expect(result.text).toContain("Image: /tmp/ChatGPT Image 2026年5月10日 00_10_01.png");
    expect(result.text).toContain("Dimensions: 1024x768");
    expect(result.extractionMethod).toBe("structured:image-viewer");
  });
});
