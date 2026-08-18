import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { detectAffectedPlatforms } from "./component-source-map.ts";

const ALL_PLATFORMS = ["darwin-x64", "darwin-arm64", "windows-x64", "windows-arm64", "linux-x64", "linux-arm64"];

describe("detectAffectedPlatforms", () => {
  test("returns all platforms when shared code changes", () => {
    const result = detectAffectedPlatforms(["apps/desktop/src/main/index.ts"], ALL_PLATFORMS);
    assert.equal(result.allPlatforms, true);
    assert.deepEqual(result.affectedPlatforms, ALL_PLATFORMS);
  });

  test("returns only the affected platform when one platform-specific resource changes", () => {
    const result = detectAffectedPlatforms(
      ["apps/desktop/resources/aria2/darwin-arm64/bin/aria2c"],
      ALL_PLATFORMS
    );
    assert.equal(result.allPlatforms, false);
    assert.deepEqual(result.affectedPlatforms, ["darwin-arm64"]);
  });

  test("returns only affected platforms when multiple platform-specific resources change", () => {
    const result = detectAffectedPlatforms([
      "apps/desktop/resources/aria2/darwin-arm64/bin/aria2c",
      "apps/desktop/resources/lsp/linux-x64/rust-analyzer",
    ], ALL_PLATFORMS);
    assert.equal(result.allPlatforms, false);
    assert.deepEqual(result.affectedPlatforms.sort(), ["darwin-arm64", "linux-x64"]);
  });

  test("returns all platforms when both shared and platform-specific files change", () => {
    const result = detectAffectedPlatforms([
      "apps/desktop/resources/aria2/darwin-x64/bin/aria2c",
      "apps/desktop/src/main/index.ts",
    ], ALL_PLATFORMS);
    assert.equal(result.allPlatforms, true);
    assert.deepEqual(result.affectedPlatforms, ALL_PLATFORMS);
  });

  test("returns empty when no files changed", () => {
    const result = detectAffectedPlatforms([], ALL_PLATFORMS);
    assert.equal(result.allPlatforms, false);
    assert.equal(result.affectedPlatforms.length, 0);
  });

  test("treats shared resource files (outside platform subdirs) as shared", () => {
    const result = detectAffectedPlatforms(
      ["apps/desktop/resources/lsp/manifest-rust-analyzer.json"],
      ALL_PLATFORMS
    );
    assert.equal(result.allPlatforms, true);
  });

  test("maps win32- resource dirs to windows- targets", () => {
    const result = detectAffectedPlatforms(
      ["apps/desktop/resources/aria2/win32-x64/bin/aria2.exe"],
      ALL_PLATFORMS
    );
    assert.equal(result.allPlatforms, false);
    assert.deepEqual(result.affectedPlatforms, ["windows-x64"]);
  });

  test("treats playwright-browsers as shared (no platform subdirs in repo)", () => {
    const result = detectAffectedPlatforms(
      ["apps/desktop/resources/playwright-browsers/chromium"],
      ALL_PLATFORMS
    );
    assert.equal(result.allPlatforms, true);
  });
});