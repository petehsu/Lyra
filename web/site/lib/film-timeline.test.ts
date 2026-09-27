import { strict as assert } from "node:assert";
import { test } from "node:test";
import { clampFilmTime, filmSourceTime, filmTimeLabel, FILM_DURATION } from "./film-timeline";

test("film follows the three Premiere source in-points, not uncut source time", () => {
  assert.ok(Math.abs(filmSourceTime(0) - 416.666667) < .001);
  assert.ok(Math.abs(filmSourceTime(56.083334) - 57083.334) < .001);
  assert.ok(Math.abs(filmSourceTime(58.666668) - 60000.001333) < .001);
  assert.ok(filmSourceTime(66) < 67210);
});
test("film controls clamp non-finite and out-of-range input", () => {
  assert.equal(clampFilmTime(NaN), 0);
  assert.equal(clampFilmTime(-1), 0);
  assert.equal(clampFilmTime(1000), FILM_DURATION);
  assert.equal(filmTimeLabel(65), "1:05");
});
