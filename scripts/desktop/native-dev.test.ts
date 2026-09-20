import assert from "node:assert/strict";
import test from "node:test";

import { shouldSkipNativeCargo } from "./native-dev.ts";

test("skips cargo when staged natives are newer than sources", () => {
  assert.equal(shouldSkipNativeCargo(100, 200), true);
});

test("rebuilds when sources are newer than staged natives", () => {
  assert.equal(shouldSkipNativeCargo(200, 100), false);
});

test("rebuilds when nothing is staged yet", () => {
  assert.equal(shouldSkipNativeCargo(100, null), false);
});
