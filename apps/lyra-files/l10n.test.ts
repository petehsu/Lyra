import assert from "node:assert/strict";
import test from "node:test";

import { resolveMessages } from "./src/l10n/resolve.ts";

test("zh and zh-Hans resolve to the Simplified Chinese catalog", () => {
  assert.equal(resolveMessages("zh").home, "文件");
  assert.equal(resolveMessages("zh-Hans").downloads, "下载");
  assert.equal(resolveMessages("zh-CN").emptyTrash, "清空废纸篓");
});

test("unknown locale falls back to en-US", () => {
  assert.equal(resolveMessages("ja-JP").back, "Back");
  assert.equal(resolveMessages("").newFile, "New file");
});

test("English language prefixes use the en-US catalog", () => {
  assert.equal(resolveMessages("en-US").addFavorite, "Add favorite");
  assert.equal(resolveMessages("en-GB").createName, "Name");
});
