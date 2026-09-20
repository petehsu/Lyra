import assert from "node:assert/strict";
import test from "node:test";

import { resolveMessages } from "./src/l10n/resolve.ts";

test("zh and zh-Hans resolve to the Simplified Chinese catalog", () => {
  assert.equal(resolveMessages("zh").credentialsTab, "密码");
  assert.equal(resolveMessages("zh-Hans").searchPlaceholder, "搜索网站、账户、方式或备注");
  assert.equal(resolveMessages("zh-CN").sessionsTab, "会话");
});

test("unknown locale falls back to en-US", () => {
  assert.equal(resolveMessages("ja-JP").searchPlaceholder, "Search sites, accounts, methods, or notes");
  assert.equal(resolveMessages("").credentialsTab, "Passwords");
});

test("English language prefixes use the en-US catalog", () => {
  assert.equal(resolveMessages("en-US").reviewTab, "Review");
  assert.equal(resolveMessages("en-GB").openSite, "Open site");
});
