import assert from "node:assert/strict";
import test from "node:test";
import { getWorkbenchCameraFrame, getWorkbenchFlowLayout, getWorkbenchFlowOffset, getWorkbenchFrameSize, getWorkbenchRevealState } from "./workbench-reveal";

test("scene and film hand off to native flow with continuous position and velocity", () => {
  const layout = getWorkbenchFlowLayout(900, 1900, 3000);
  const { release } = layout;
  const at = (scroll: number) => getWorkbenchFlowOffset(scroll, release, layout.handoffDistance) - Math.max(0, scroll - release);
  const slope = (scroll: number) => (at(scroll + 0.01) - at(scroll)) / 0.01;
  assert.equal(at(release - layout.handoffDistance), 0);
  assert.ok(Math.abs(slope(release - layout.handoffDistance)) < 0.001);
  assert.ok(Math.abs(slope(release - 0.01) + 1) < 0.001);
  assert.ok(Math.abs(slope(release) + 1) < 0.001);
  assert.ok(Math.abs(at(release + 0.01) - at(release - 0.01)) < 0.021);
  assert.equal(layout.sceneHeight - layout.stickyHeight, release);
  // The following pricing section starts at the film's visual bottom, no spacer gap.
  assert.equal(1900 + at(release), layout.stickyHeight);
});

test("handoff moves one shared scene, is reversible and never overshoots", () => {
  const { handoffDistance, release } = getWorkbenchFlowLayout(720, 1600, 2000);
  let previous = 0;
  for (let scroll = 0; scroll <= 2200; scroll++) {
    const offset = getWorkbenchFlowOffset(scroll, release, handoffDistance);
    assert.ok(offset <= previous);
    assert.ok(offset >= -handoffDistance / 2);
    previous = offset;
  }
  assert.equal(getWorkbenchFlowOffset(1000, 2000, handoffDistance), 0);
  assert.equal(getWorkbenchFlowOffset(1000, 2000, 0), 0);
});

test("the full desktop remains in view at zoom completion before the shared exit starts", () => {
  const layout = getWorkbenchFlowLayout(720, 1600, 2000);
  assert.equal(getWorkbenchFlowOffset(2000, layout.release, layout.handoffDistance), 0);
  assert.ok(getWorkbenchFlowOffset(2001, layout.release, layout.handoffDistance) < 0);
});

const range = {
  totalDistance: 3000,
  storyDistance: 2200,
  revealStart: 1800,
  revealDistance: 1200
};
const at = (scroll: number) => getWorkbenchRevealState(scroll / range.totalDistance, range);

test("reading keeps the camera full screen until the existing reveal boundary", () => {
  assert.equal(at(0).cameraProgress, 0);
  assert.equal(at(1799).cameraProgress, 0);
  assert.equal(at(1800).cameraMoving, false);
  assert.equal(at(1800).storyTravel, 1800);
});

test("camera and caption finish together at the section release, without a dead scroll segment", () => {
  assert.ok(at(2832).cameraProgress < 1);
  assert.equal(at(2832).cameraMoving, true);
  assert.ok(at(2832).captionProgress > 0);
  assert.equal(at(3000).cameraProgress, 1);
  assert.equal(at(3000).cameraMoving, false);
  assert.equal(at(3000).captionProgress, 1);
  assert.equal(at(3000).storyTravel, 2200);
});

test("camera starts and settles gently without reversing direction", () => {
  assert.ok(at(1801).cameraProgress < 0.00001);
  assert.ok(1 - at(2999).cameraProgress < 0.00001);
  let previous = 0;
  for (let scroll = 0; scroll <= 3000; scroll += 5) {
    const current = at(scroll).cameraProgress;
    assert.ok(current >= previous);
    previous = current;
  }
});

test("each scroll step through the former final hold still changes the camera", () => {
  for (let scroll = 2832; scroll < 3000; scroll += 1) {
    assert.ok(at(scroll + 1).cameraProgress > at(scroll).cameraProgress);
  }
});

test("reversing and stopping return exactly the same frame without catch-up", () => {
  const frames = [1799, 1800, 1801, 2100, 2600, 2832, 3000].map(at);
  [3000, 2832, 2600, 2100, 1801, 1800, 1799].forEach((scroll, index) => {
    assert.deepEqual(at(scroll), frames[frames.length - 1 - index]);
    assert.deepEqual(at(scroll), at(scroll));
  });
});

test("overscroll cannot move beyond the first or last frame", () => {
  assert.deepEqual(at(-100), at(0));
  assert.deepEqual(at(3100), at(3000));
});

const camera = {
  width: 1000, height: 700,
  contentLeft: 420, contentTop: 34, contentWidth: 580, contentHeight: 604,
  viewportWidth: 1440, viewportHeight: 900
};

test("short desktop viewports do not accidentally select the app's mobile layout", () => {
  for (const [width, height] of [[1081, 600], [1280, 720], [1920, 1080]]) {
    const frame = getWorkbenchFrameSize(width, height);
    assert.ok(frame.width > 980);
    assert.ok(frame.width <= width - 64);
    assert.ok(frame.height <= height - 112);
  }
});

test("a short workspace does not make the opening headline wider than the screen", () => {
  const frame = getWorkbenchCameraFrame({ ...camera, contentHeight: 250 }, 0, 0);
  assert.equal(frame.storyWidth, camera.viewportWidth + 2);
});

test("opening covers the viewport without resizing the desktop renderer", () => {
  const frame = getWorkbenchCameraFrame(camera, 0, 0);
  assert.ok(camera.contentWidth * frame.scale >= camera.viewportWidth + 2);
  assert.ok(camera.contentHeight * frame.scale >= camera.viewportHeight + 2);
  assert.ok(Math.abs(frame.x + camera.contentLeft * frame.scale + 1) < 1e-9);
  assert.ok(Math.abs(frame.y + camera.contentTop * frame.scale + 1) < 1e-9);
});

test("revealed desktop is native size, not a permanently shrunken UI", () => {
  const frame = getWorkbenchCameraFrame(camera, 1, 2200);
  assert.equal(frame.scale, 1);
  assert.equal(frame.x, 220);
  assert.ok(Math.abs(frame.y - 90) < 1e-9);
  assert.equal(frame.storyWidth, camera.contentWidth);
});

test("website counter-scale preserves type size and vertical reading position", () => {
  for (const contentLeft of [0, 320, 420]) {
    const geometry = { ...camera, contentLeft };
    for (const progress of [0, 0.1, 0.5, 0.9, 1]) {
      const frame = getWorkbenchCameraFrame(geometry, progress, 1800);
      assert.ok(Math.abs(frame.scale * frame.storyScale - 1) < 1e-9);
      assert.ok(Math.abs(frame.y + geometry.contentTop * frame.scale + frame.storyY * frame.scale + 1801) < 1e-9);
    }
  }
});

test("every AI-side / terminal-position / resized-boundary combination covers all four viewport edges", () => {
  for (const left of [0, 176, 420, 660]) {
    for (const right of [0, 176, 420]) {
      for (const top of [34, 217, 380]) {
        for (const bottom of [62, 220, 300]) {
          const geometry = { ...camera, contentLeft: left, contentTop: top,
            contentWidth: Math.max(100, camera.width - left - right),
            contentHeight: Math.max(100, camera.height - top - bottom) };
          const frame = getWorkbenchCameraFrame(geometry, 0, 0);
          const x = frame.x + left * frame.scale;
          const y = frame.y + top * frame.scale;
          assert.ok(x <= 0 && y <= 0);
          assert.ok(x + geometry.contentWidth * frame.scale >= camera.viewportWidth);
          assert.ok(y + geometry.contentHeight * frame.scale >= camera.viewportHeight);
          assert.ok(frame.storyWidth <= camera.viewportWidth + 2);
        }
      }
    }
  }
});
