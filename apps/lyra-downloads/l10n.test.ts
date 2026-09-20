import assert from "node:assert/strict";
import test from "node:test";

import { resolveMessages } from "./src/l10n/resolve.ts";

test("zh and zh-Hans resolve to the Simplified Chinese catalog", () => {
  assert.equal(resolveMessages("zh").downloadPause, "暂停");
  assert.equal(resolveMessages("zh-Hans").emptyDownloads, "暂无下载");
  assert.equal(resolveMessages("zh-CN").downloadPauseAll, "全部暂停");
});

test("unknown locale falls back to en-US", () => {
  assert.equal(resolveMessages("ja-JP").downloadUrlPlaceholder, "Paste URL or batch URLs");
  assert.equal(resolveMessages("").emptyDownloads, "No download tasks yet.");
});

test("English language prefixes use the en-US catalog", () => {
  assert.equal(resolveMessages("en-US").downloadAddUrl, "Add download");
  assert.equal(resolveMessages("en-GB").downloadRevealFile, "Reveal");
});
