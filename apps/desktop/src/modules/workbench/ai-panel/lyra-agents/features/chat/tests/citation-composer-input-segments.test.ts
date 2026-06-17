import { describe, expect, test } from "vitest";

import { createComposerChipElement } from "../citation-chip-dom";
import type { AgentImageAttachment } from "../../../core/types";

/**
 * Regression guard for drag/paste image inserts: chips must round-trip into segments
 * via known-segment parsing (see CitationComposerInput insertImage).
 */
describe("citation composer chip segments", () => {
  test("image chips carry attachment id for known-segment parsing", () => {
    const image: AgentImageAttachment = {
      id: "dropped-image-test",
      mediaType: "image/png",
      data: "abc",
      label: "Screen Shot.png",
      source: "/Users/demo/Desktop/Screen Shot.png"
    };
    const chip = createComposerChipElement({ type: "image", image });
    expect(chip.dataset.attachmentId).toBe("dropped-image-test");
    expect(chip.dataset.attachmentSource).toBe("/Users/demo/Desktop/Screen Shot.png");
  });
});