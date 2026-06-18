import { describe, expect, test } from "vitest";

import { formatScrollHintsForMap } from "../view-manager-runtime/agent-map-format";

describe("agent-map-format", () => {
  test("formatScrollHintsForMap renders browser-use style appendix", () => {
    const appendix = formatScrollHintsForMap([
      {
        frameRef: "lumen-frame:2",
        tag: "button",
        text: "Submit",
        pagesDown: 2.3
      }
    ], 3);

    expect(appendix).toContain("... (2 more elements below - scroll to reveal):");
    expect(appendix).toContain('[lumen-frame:2] <button> "Submit" ~2.3 pages down');
  });

  test("formatScrollHintsForMap returns empty string when no hints", () => {
    expect(formatScrollHintsForMap([], 0)).toBe("");
  });
});