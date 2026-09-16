import assert from "node:assert/strict";
import test from "node:test";

import { resolveMessages } from "./src/l10n/resolve.ts";

test("zh and zh-Hans resolve to the Simplified Chinese catalog", () => {
  assert.equal(resolveMessages("zh").emptyTitle, "暂无通知");
  assert.equal(resolveMessages("zh-Hans").emptyTitle, "暂无通知");
  assert.equal(resolveMessages("zh-CN").emptyTitle, "暂无通知");
});

test("unknown locale falls back to en-US", () => {
  assert.equal(resolveMessages("ja-JP").emptyTitle, "No notifications");
  assert.equal(resolveMessages("").emptyTitle, "No notifications");
});

test("English language prefixes use the en-US catalog", () => {
  assert.equal(resolveMessages("en-US").emptyTitle, "No notifications");
  assert.equal(resolveMessages("en-GB").emptyTitle, "No notifications");
});
