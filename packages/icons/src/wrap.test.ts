import assert from "node:assert/strict";
import { test } from "node:test";

import { GitBranch, Search } from "./ui";
import { mapIconWeight } from "./wrap";

test("filled phosphor aliases become Reicon Filled", () => {
  assert.equal(mapIconWeight("fill", undefined), "Filled");
  assert.equal(mapIconWeight("Filled", undefined), "Filled");
});

test("outline stays Outline unless fill paints the glyph", () => {
  assert.equal(mapIconWeight("regular", undefined), "Outline");
  assert.equal(mapIconWeight(undefined, "none"), "Outline");
  assert.equal(mapIconWeight(undefined, "currentColor"), "Filled");
});

test("ui wrappers keep lucide class names", () => {
  assert.equal(Search.displayName, "Search");
  assert.equal(GitBranch.displayName, "GitBranch");
});
