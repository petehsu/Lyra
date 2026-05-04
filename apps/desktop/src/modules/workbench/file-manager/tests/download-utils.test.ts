import { describe, expect, test } from "vitest";

import {
  formatDownloadEta,
  resolveDownloadChecksumLabel
} from "../download-utils";

const labels = {
  downloadDurationSeconds: "{seconds}s",
  downloadDurationMinutes: "{minutes}m {seconds}s",
  downloadDurationHours: "{hours}h {minutes}m",
  downloadEta: "{duration} left",
  downloadChecksumPending: "{algorithm} pending",
  downloadChecksumVerified: "{algorithm} verified",
  downloadChecksumFailed: "{algorithm} mismatch"
};

describe("download display utilities", () => {
  test("formats remaining time compactly", () => {
    expect(formatDownloadEta(124_000, labels)).toBe("2m 4s left");
    expect(formatDownloadEta(undefined, labels)).toBeNull();
  });

  test("formats checksum verification state", () => {
    expect(resolveDownloadChecksumLabel({
      algorithm: "sha256",
      expected: "abc123"
    }, labels)).toBe("SHA256 pending");
    expect(resolveDownloadChecksumLabel({
      algorithm: "md5",
      expected: "abc123",
      verified: true
    }, labels)).toBe("MD5 verified");
    expect(resolveDownloadChecksumLabel({
      algorithm: "sha1",
      expected: "abc123",
      verified: false
    }, labels)).toBe("SHA1 mismatch");
  });
});
