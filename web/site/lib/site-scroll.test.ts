import assert from "node:assert/strict";
import test from "node:test";
import { clampSiteScrollTarget, createSiteWheelMotion, getSiteWheelDelta, rebaseWorkbenchScroll, SITE_SCROLL_DURATION, siteScrollEase } from "./site-scroll";

test("switching away makes the workspace the actual document top, without visual displacement", () => {
  const locked = rebaseWorkbenchScroll(2104, 0, false);
  assert.deepEqual(locked, { prefix: 2104, scroll: 0 });
  assert.equal(-locked.prefix - locked.scroll, -2104);
  // Changing between two non-site tabs must not consume the sections below.
  assert.deepEqual(rebaseWorkbenchScroll(650, locked.prefix, false), { prefix: 2104, scroll: 650 });
});

test("returning to the site restores exactly the old scene position, also below the workspace", () => {
  for (const scroll of [0, 650, 3000]) {
    const restored = rebaseWorkbenchScroll(scroll, 2104, true);
    assert.equal(-restored.prefix - restored.scroll, -2104 - scroll);
    assert.deepEqual(restored, { prefix: 0, scroll: 2104 + scroll });
  }
});

test("anchor easing advances immediately, slows down, and stops within half a second", () => {
  assert.equal(SITE_SCROLL_DURATION, 0.5);
  assert.equal(siteScrollEase(0), 0);
  assert.equal(siteScrollEase(1), 1);
  assert.equal(siteScrollEase(2), 1);
  const steps = Array.from({ length: 30 }, (_, i) => siteScrollEase((i + 1) / 30) - siteScrollEase(i / 30));
  assert.ok(steps.every(step => step > 0));
  assert.ok(steps.every((step, i) => i === 0 || step < steps[i - 1]!));
});

test("wheel speed adjusts both duration and curve within a finite tail", () => {
  const slow = createSiteWheelMotion().sample(12, 0);
  const fast = createSiteWheelMotion().sample(480, 0);
  assert.ok(slow.duration >= 0.18 && slow.duration < 0.2);
  assert.ok(fast.duration > slow.duration && fast.duration <= 0.6);
  assert.notEqual(slow.easing(0.5), fast.easing(0.5));
  for (const motion of [slow, fast]) {
    assert.equal(motion.easing(0), 0);
    assert.equal(motion.easing(1), 1);
    assert.equal(motion.easing(2), 1);
    const steps = Array.from({ length: 30 }, (_, i) => motion.easing((i + 1) / 30) - motion.easing(i / 30));
    assert.ok(steps.every(step => step > 0));
    assert.ok(steps.every((step, i) => i === 0 || step < steps[i - 1]!));
  }
});

test("rapid repeated input gets more tail than isolated notches", () => {
  const fast = createSiteWheelMotion();
  const slow = createSiteWheelMotion();
  let fastDuration = 0;
  let slowDuration = 0;
  for (let i = 0; i < 8; i++) {
    fastDuration = fast.sample(80, i * 16).duration;
    slowDuration = slow.sample(80, i * 300).duration;
  }
  assert.ok(fastDuration > slowDuration);
});

test("similar physical speed has similar damping across input event frequencies", () => {
  const run = (interval: number) => {
    const motion = createSiteWheelMotion();
    let duration = 0;
    for (let time = 0; time < 1000; time += interval) duration = motion.sample(interval * 2, time).duration;
    return duration;
  };
  assert.ok(Math.abs(run(8) - run(16)) < 0.03);
});

test("reversal responds immediately; a pause or cancellation resets accumulated speed", () => {
  const motion = createSiteWheelMotion();
  motion.sample(500, 0);
  const reversed = motion.sample(-20, 16);
  assert.equal(reversed.reversing, true);
  assert.equal(reversed.duration, 0.18);
  assert.equal(getSiteWheelDelta(1000, 1500, -20, null), -520);
  assert.equal(getSiteWheelDelta(1000, 500, 20, null), 520);
  assert.equal(getSiteWheelDelta(1000, 1500, -20, 990), -510);
  assert.equal(getSiteWheelDelta(1000, 1500, 20, null), 20);
  const afterPause = motion.sample(20, 1000);
  assert.equal(afterPause.reversing, false);
  assert.equal(afterPause.duration, createSiteWheelMotion().sample(20, 0).duration);
  motion.reset();
  assert.equal(motion.sample(20, 1016).duration, createSiteWheelMotion().sample(20, 0).duration);
});

test("workspace lock clamps the smooth target before it crosses the story boundary", () => {
  assert.equal(getSiteWheelDelta(2400, 2400, -500, 2200), -200);
  assert.equal(getSiteWheelDelta(2200, 2200, -500, 2200), 0);
  assert.equal(getSiteWheelDelta(2200, 2200, 500, 2200), 500);
  assert.equal(getSiteWheelDelta(3200, 3200, -500, 2200), -500);
  assert.equal(clampSiteScrollTarget(0, 2200), 2200);
});

test("returning to the website restores unrestricted upward scrolling", () => {
  assert.equal(getSiteWheelDelta(2200, 2200, -500, null), -500);
  assert.equal(clampSiteScrollTarget(0, null), 0);
});
