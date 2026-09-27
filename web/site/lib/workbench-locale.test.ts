import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbenchLocaleSync } from "./workbench-locale";

test("opening Chinese ignores English startup reports instead of redirecting", () => {
  const sync = createWorkbenchLocaleSync("zh");
  assert.equal(sync("en-US"), null);
  assert.equal(sync("en-US"), null);
  assert.equal(sync("zh-CN"), null);
  assert.equal(sync("zh-CN"), null);
  assert.equal(sync("en-US"), "en");
  assert.equal(sync("en-US"), null);
});

test("English routes also win over persisted Chinese during initialization", () => {
  const sync = createWorkbenchLocaleSync("en");
  assert.equal(sync("zh-CN"), null);
  assert.equal(sync("en-US"), null);
  assert.equal(sync("zh-CN"), "zh");
});

test("unsupported languages do not acknowledge startup or change the route", () => {
  const sync = createWorkbenchLocaleSync("zh");
  assert.equal(sync("fr"), null);
  assert.equal(sync("english"), null);
  assert.equal(sync("en-US"), null);
  assert.equal(sync("zh-TW"), null);
  assert.equal(sync("fr"), null);
  assert.equal(sync("EN_us"), "en");
});
