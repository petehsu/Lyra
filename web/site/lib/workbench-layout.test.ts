import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("camera crops cannot become hidden scroll containers when iframe controls receive focus", () => {
  for (const selector of ["hero-workbench-stage", "real-workbench-frame", "real-workbench-site-viewport"]) {
    const rule = css.match(new RegExp(`^\\.${selector}\\s*\\{([^}]+)\\}`, "m"))?.[1];
    assert.ok(rule, `${selector} has a layout rule`);
    assert.match(rule, /overflow:\s*clip\s*;/, `${selector} must crop without permitting focus-induced scrolling`);
  }
});

test("website hit-testing yields to the actual desktop throughout splitter drags", () => {
  assert.match(css, /\.real-workbench-frame\[data-layout-resizing="true"\]\s+\.real-workbench-site-viewport\s*\{\s*pointer-events:\s*none;/);
});
