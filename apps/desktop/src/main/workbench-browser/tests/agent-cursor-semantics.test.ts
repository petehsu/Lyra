import { describe, expect, test } from "vitest";
import { CURSOR_DEFINITIONS, CURSOR_RUNTIME, formatCursorHint, readCursorObservation } from "../view-manager-runtime/agent-cursor-semantics";

const parse = (value: string) => window.eval(CURSOR_RUNTIME).parse(value);
const keywords = "auto default none context-menu help pointer progress wait cell crosshair text vertical-text alias copy move no-drop not-allowed grab grabbing all-scroll col-resize row-resize n-resize e-resize s-resize w-resize ne-resize nw-resize se-resize sw-resize ew-resize ns-resize nesw-resize nwse-resize zoom-in zoom-out".split(" ");

describe("cursor vocabulary", () => {
  test("covers exactly the 36 CSS keywords", () => {
    expect(Object.keys(CURSOR_DEFINITIONS).sort()).toEqual([...keywords].sort());
    for (const keyword of keywords) {
      const observation = readCursorObservation(parse(keyword));
      expect(observation).toEqual({ keyword, customImage: false });
      expect(formatCursorHint(observation!)).toContain(`cursor=${keyword}`);
      expect(formatCursorHint(observation!)).toContain("cssHint=");
    }
  });
  test("handles URL commas, data URLs, hotspots and fallbacks without returning image URLs", () => {
    for (const raw of ['url("https://site.test/a,b.cur") 4 8, grab', 'url("data:image/svg+xml,a,b") 0 0, url("secret.cur"), grab']) {
      const observation = readCursorObservation(parse(raw))!;
      expect(observation).toEqual({ keyword: "grab", customImage: true });
      expect(formatCursorHint(observation)).toContain("fallback=grab");
      expect(formatCursorHint(observation)).toContain("uninspected");
      expect(JSON.stringify(observation)).not.toMatch(/https:|secret|data:/);
    }
  });
  test("normalizes legacy hand but never invents a keyword or uses prototype properties", () => {
    expect(parse(" HAND ")).toEqual({ keyword: "pointer", customImage: false });
    for (const raw of ["garbage", "inherit", "url(pointer)", "constructor", "__proto__"]) expect(parse(raw)).toBeNull();
    expect(readCursorObservation({ keyword: "constructor" })).toBeUndefined();
  });
});
