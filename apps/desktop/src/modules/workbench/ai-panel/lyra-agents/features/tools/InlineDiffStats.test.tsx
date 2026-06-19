import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { InlineDiffStats, editDiffCounts, shouldShowEditDiffStats } from "./InlineDiffStats";

describe("InlineDiffStats", () => {
  test("renders ticking additions and deletions", () => {
    render(<InlineDiffStats additions={3} deletions={1} />);
    expect(screen.getByLabelText("+3 -1")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  test("hides when both counts are zero", () => {
    const { container } = render(<InlineDiffStats additions={0} deletions={0} />);
    expect(container.firstChild).toBeNull();
  });

  test("extracts edit diff counts from tool details", () => {
    const counts = editDiffCounts({
      type: "edit",
      file: "src/a.ts",
      additions: 2,
      deletions: 1,
      hunks: []
    });
    expect(shouldShowEditDiffStats(counts)).toBe(true);
    expect(counts).toEqual({ additions: 2, deletions: 1 });
  });
});