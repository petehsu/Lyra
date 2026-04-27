import { describe, expect, test } from "vitest";

import { formatWorkbenchSearchIndexStatusForTests } from "../use-workbench-settings-surface-props";

describe("formatWorkbenchSearchIndexStatusForTests", () => {
  test("formats idle search index status", () => {
    expect(formatWorkbenchSearchIndexStatusForTests(null)).toBe("idle");
  });

  test("includes indexed counts, progress, and error details", () => {
    expect(
      formatWorkbenchSearchIndexStatusForTests({
        state: "failed",
        indexedFiles: 42,
        indexedDirs: 7,
        progress: 0.625,
        error: "permission denied"
      })
    ).toBe("failed · files 42 · dirs 7 · 63% · permission denied");
  });
});
