import assert from "node:assert/strict";
import test from "node:test";
import { workbenchModalCutout } from "./workbench-modal";
import { isWebCursorSurfaceActive } from "./workbench-cursor";

test("modal compositing cuts the measured browser slot, not the dialog bounds", () => {
  for (const bounds of [
    { left: 320, top: 34, right: 1206, bottom: 440 },
    { left: 0, top: 234, right: 886, bottom: 570 },
    { left: 250.5, top: 34, right: 603, bottom: 350.25 }
  ]) {
    const { left, top, right, bottom } = bounds;
    assert.equal(workbenchModalCutout(bounds), `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`);
  }
});

test("invalid or collapsed browser slots never generate invalid clip paths", () => {
  for (const right of [NaN, Infinity, -1, 0]) {
    assert.equal(workbenchModalCutout({ left: 0, top: 34, right, bottom: 570 }), "none");
  }
});

test("global dialogs suppress the website's agent cursor without deactivating its tab", () => {
  assert.equal(isWebCursorSurfaceActive("true", "true"), false);
  assert.equal(isWebCursorSurfaceActive("true", "false"), true);
  assert.equal(isWebCursorSurfaceActive("false", "false"), false);
});
