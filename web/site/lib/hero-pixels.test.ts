import assert from "node:assert/strict";
import test from "node:test";
import { heroPixelCovered, heroPixelNoise, heroPixelResponse } from "./hero-pixels";

test("pixel pattern is deterministic, starts open and seals the section edge", () => {
  for (let column = 0; column < 500; column++) {
    assert.equal(heroPixelNoise(column, 12), heroPixelNoise(column, 12));
    assert.equal(heroPixelCovered(column, 0, 40), false);
    assert.equal(heroPixelCovered(column, 38, 40), true);
    assert.equal(heroPixelCovered(column, 39, 40), true);
  }
});

test("coverage gradually increases instead of one abrupt horizontal cut", () => {
  const count = (row: number) => Array.from({ length: 500 }, (_, col) => heroPixelCovered(col, row, 40)).filter(Boolean).length;
  assert.ok(count(5) < count(15));
  assert.ok(count(15) < count(25));
  assert.ok(count(25) < count(35));
});

test("pointer response is local, bounded and never opens the bottom seam", () => {
  assert.equal(heroPixelResponse(80, 0.5, 1), 1);
  assert.equal(heroPixelResponse(0, 1, 1), 1);
  assert.equal(heroPixelResponse(0, 0.5, 0), 1);
  assert.ok(heroPixelResponse(0, 0.5, 1) < 0.3);
  assert.ok(heroPixelResponse(0, 0.5, 100) > 0);
});
