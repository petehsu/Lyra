import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceFilmClock } from "./film-clock";
import { FILM_DURATION } from "./film-timeline";

test("silent autoplay advances without an audio autoplay permission", () => {
  assert.deepEqual(advanceFilmClock(12, .25, null), {time: 12.25, ended: false});
});
test("sound follows the same cut clock, including buffering and toggling off", () => {
  assert.equal(advanceFilmClock(12, .1, 12.02).time, 12.02);
  assert.equal(advanceFilmClock(12.02, 2, 12.02).time, 12.02);
  assert.equal(advanceFilmClock(12.02, .1, null).time, 12.12);
  assert.equal(advanceFilmClock(12.12, .1, 12.08).time, 12.12);
});
test("the film ends once and stays on its last frame, never looping implicitly", () => {
  assert.deepEqual(advanceFilmClock(FILM_DURATION - .01, .1, null), {time: FILM_DURATION, ended: true});
  assert.deepEqual(advanceFilmClock(FILM_DURATION, 20, null), {time: FILM_DURATION, ended: true});
  assert.deepEqual(advanceFilmClock(0, .1, null), {time: .1, ended: false});
});
