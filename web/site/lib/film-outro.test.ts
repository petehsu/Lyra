import assert from "node:assert/strict";
import { test } from "node:test";
import { FILM_GLASS, OUTRO_BEATS } from "./film-outro";
import { FILM_DURATION, filmSourceTime } from "./film-timeline";

test("glass waits for the desktop entrance, not the opening particles", () => {
  assert.ok(filmSourceTime(FILM_GLASS.start) > 5500);
  assert.ok(filmSourceTime(FILM_GLASS.start) < 5700);
  assert.ok(Math.abs(filmSourceTime(FILM_GLASS.start + FILM_GLASS.duration) - (8 + 1 / 30) * 1000) < 30);
});

test("ending cuts use the exported 24fps film clock and three-quarter-second beats", () => {
  assert.equal(OUTRO_BEATS.black * 24, 1589);
  for (let i = 1; i < OUTRO_BEATS.words.length; i++) {
    assert.equal(OUTRO_BEATS.words[i] - OUTRO_BEATS.words[i - 1], .75);
  }
  assert.equal(OUTRO_BEATS.shrink + 3.5, OUTRO_BEATS.settle);
  assert.ok(OUTRO_BEATS.name > OUTRO_BEATS.settle);
  assert.ok(OUTRO_BEATS.dissolve > OUTRO_BEATS.name + 1);
  assert.ok(OUTRO_BEATS.dissolved < FILM_DURATION);
  assert.equal(filmSourceTime(66.1), filmSourceTime(65.875));
});
