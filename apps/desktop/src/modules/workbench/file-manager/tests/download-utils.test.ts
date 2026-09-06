import { describe, expect, test } from "vitest";

import { formatDownloadEta } from "../download-utils";

const labels = {
  downloadDurationSeconds: "{seconds}s",
  downloadDurationMinutes: "{minutes}m {seconds}s",
  downloadDurationHours: "{hours}h {minutes}m",
  downloadEta: "{duration} left"
};

describe("download display utilities", () => {
  test("formats remaining time compactly", () => {
    expect(formatDownloadEta(124_000, labels)).toBe("2m 4s left");
    expect(formatDownloadEta(undefined, labels)).toBeNull();
  });
});