import assert from "node:assert/strict";
import { test } from "node:test";
import { createFilmPointerTrack, filmPointerAt, type FilmPointerTargets } from "../../../Lyra宣传视频/ui-studio/src/runtime/film-pointer-track";

const targets: FilmPointerTargets = {
  input: { x: 340, y: 720 }, send: { x: 520, y: 820 },
  divider: { x: 600, y: 500 }, settings: { x: 1600, y: 90 },
  language: { x: 1300, y: 400 }, option: { x: 1240, y: 530 }
};
const at = (time: number) => filmPointerAt(time, targets, 1920, 1080);

test("pointer stays visible throughout the software demo, including typing and idle", () => {
  for (let time = 5.2; time < 58.6; time += .01) assert.equal(at(time).visible, true);
  assert.ok(at(5.2).x > 1920);
  assert.ok(at(58.6).x > 1920);
  assert.equal(at(60).visible, false);
});
test("every pointer movement joins its previous position without a teleport", () => {
  for (const cut of [7.8, 8.05, 9.063333, 13.833333, 14.216667, 14.5, 15, 21.23, 21.75, 23.45, 24.1, 55.2, 56.02, 56.083333, 56.24, 56.89, 57.24, 57.89, 58.12, 58.6]) {
    const before = at(cut - .00001), after = at(cut + .00001);
    assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < .1, `jump at ${cut}`);
  }
});
test("drag uses the live divider hotspot exactly, without easing lag or offset", () => {
  for (let time = 21.85; time <= 23.233333; time += .01) {
    const divider = { x: 1000 - (time - 21.85) * 220, y: 540 };
    const pointer = filmPointerAt(time, { ...targets, divider }, 1920, 1080);
    assert.equal(pointer.x, divider.x);
    assert.equal(pointer.y, divider.y);
    assert.equal(pointer.mode, "col-resize");
  }
});

test("after Send the cursor leaves the clicked screen point, not the offscreen composer", () => {
  const track = createFilmPointerTrack();
  track(14.21, targets, 1920, 1080);
  for (let time = 14.22; time < 15.1; time += .01) {
    const frame = track(time, { ...targets, send: { x: 1500, y: 1700 } }, 1920, 1080);
    assert.ok(frame.y < 1080, `camera carried mouse below the frame at ${time}`);
    assert.deepEqual(frame, at(time));
  }
  const replayTargets = { ...targets, send: { x: 510, y: 810 } };
  track(0, replayTargets, 1920, 1080);
  assert.equal(track(14.3, replayTargets, 1920, 1080).y, 810);
});
