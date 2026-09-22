import assert from "node:assert/strict";
import { test } from "node:test";

import { GitBranch, Search } from "./ui";
import { resolveLucideStrokeWidth } from "./wrap";

test("filled aliases thicken the Lucide stroke", () => {
  assert.equal(resolveLucideStrokeWidth("fill", undefined, undefined), 2.5);
  assert.equal(resolveLucideStrokeWidth("Filled", undefined, undefined), 2.5);
});

test("outline stays at the default Lucide stroke unless fill paints the glyph", () => {
  assert.equal(resolveLucideStrokeWidth("regular", undefined, undefined), 2);
  assert.equal(resolveLucideStrokeWidth(undefined, "none", undefined), 2);
  assert.equal(resolveLucideStrokeWidth(undefined, "currentColor", undefined), 2.5);
  assert.equal(resolveLucideStrokeWidth(undefined, undefined, 1.25), 1.25);
});

test("ui wrappers keep lucide class names", () => {
  assert.equal(Search.displayName, "Search");
  assert.equal(GitBranch.displayName, "GitBranch");
});
