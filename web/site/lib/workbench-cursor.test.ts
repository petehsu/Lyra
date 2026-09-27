import assert from "node:assert/strict";
import test from "node:test";
import { createCursorIdleState, CURSOR_IDLE_DELAY, isWebCursorSurfaceActive } from "./workbench-cursor";

test("only the website tab enables the cursor, including after the reveal", () => {
  assert.equal(isWebCursorSurfaceActive("true"), true);
  assert.equal(isWebCursorSurfaceActive("false"), false);
  assert.equal(isWebCursorSurfaceActive(undefined), false);
  assert.equal(isWebCursorSurfaceActive("settings"), false);
  assert.equal(isWebCursorSurfaceActive("file"), false);
});

function harness() {
  let now = 0;
  let sequence = 0;
  let schedules = 0;
  const pending = new Map<number, { time: number; callback: () => void }>();
  const states: boolean[] = [];
  const controller = createCursorIdleState(value => states.push(value), {
    now: () => now,
    schedule: (callback, ms) => {
      schedules++;
      pending.set(++sequence, { time: now + ms, callback });
      return sequence;
    },
    cancel: id => { pending.delete(id); }
  });
  const advance = (target: number) => {
    for (;;) {
      const next = [...pending.entries()].sort((a, b) => a[1].time - b[1].time)[0];
      if (!next || next[1].time > target) break;
      now = next[1].time;
      pending.delete(next[0]);
      next[1].callback();
    }
    now = target;
  };
  return { controller, advance, states, pending, schedules: () => schedules };
}

test("high-rate movement keeps one timer and does not repeatedly write idle state", () => {
  const h = harness();
  for (let t = 0; t < 150; t++) {
    h.advance(t);
    h.controller.move();
  }
  assert.equal(h.schedules(), 1);
  assert.equal(h.pending.size, 1);
  assert.deepEqual(h.states, []);
  h.advance(149 + CURSOR_IDLE_DELAY - 1);
  assert.deepEqual(h.states, []);
  h.advance(149 + CURSOR_IDLE_DELAY);
  assert.deepEqual(h.states, [true]);
  assert.equal(h.pending.size, 0);
  assert.equal(h.schedules(), 2);
});

test("sway starts after three stationary seconds and movement restarts the wait", () => {
  const h = harness();
  h.controller.move();
  h.advance(2999);
  assert.deepEqual(h.states, []);
  h.controller.move();
  h.advance(3000);
  assert.deepEqual(h.states, []);
  h.advance(5998);
  assert.deepEqual(h.states, []);
  h.advance(5999);
  assert.deepEqual(h.states, [true]);
});

test("movement immediately stops sway and leaving cancels pending idle animation", () => {
  const h = harness();
  h.controller.move();
  h.advance(CURSOR_IDLE_DELAY);
  assert.deepEqual(h.states, [true]);
  h.controller.move();
  assert.deepEqual(h.states, [true, false]);
  h.controller.stop();
  h.controller.stop();
  h.advance(CURSOR_IDLE_DELAY * 3);
  assert.equal(h.pending.size, 0);
  assert.deepEqual(h.states, [true, false]);
});
