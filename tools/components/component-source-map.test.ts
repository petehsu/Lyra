import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyReleasePackaging,
  detectAffectedPlatforms
} from "./component-source-map.ts";

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

describe("classifyReleasePackaging", () => {
  test("treats first-party app and Classic UIUX trees as app-only", () => {
    const result = classifyReleasePackaging([
      "apps/lyra-notifications/src/l10n/zh-CN.ts",
      "components/first-party/uiux-classic/index.mjs"
    ]);
    assert.equal(result.packaging, "app-only");
    assert.deepEqual(result.rebuildComponentIds, ["lyra.notifications", "lyra.uiux.classic"]);
    assert.equal(
      classifyReleasePackaging(["apps/lyra-notifications/package.json"]).packaging,
      "app-only"
    );
  });

  test("Core inbox, language dictionary, and unmapped paths stay full", () => {
    assert.equal(
      classifyReleasePackaging(["apps/desktop/src/modules/workbench/notifications/service.ts"]).packaging,
      "full"
    );
    assert.equal(
      classifyReleasePackaging(["apps/desktop/src/shared/i18n/en-US/notifications.ts"]).packaging,
      "full"
    );
    assert.equal(
      classifyReleasePackaging(["docs/architecture/component-runtime.md"]).packaging,
      "full"
    );
  });

  test("mixing an app tree with Core source is a full release", () => {
    const result = classifyReleasePackaging([
      "apps/lyra-notifications/src/index.tsx",
      "apps/desktop/src/modules/workbench/shell/index.tsx"
    ]);
    assert.equal(result.packaging, "full");
    assert.deepEqual(result.rebuildComponentIds, []);
  });
});