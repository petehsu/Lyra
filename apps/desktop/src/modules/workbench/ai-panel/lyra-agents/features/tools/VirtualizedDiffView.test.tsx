import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { DiffHunk } from "../../core/types";
import {
  VirtualizedDiffView,
  diffVisibleLineRange,
  flattenDiffHunks
} from "./VirtualizedDiffView";

const sampleHunks: DiffHunk[] = [
  {
    startLine: 10,
    lines: [
      { kind: "ctx", text: "unchanged" },
      { kind: "add", text: "added line" },
      { kind: "del", text: "removed line" }
    ]
  }
];

describe("VirtualizedDiffView helpers", () => {
  test("flattens hunks with stable line numbers", () => {
    const lines = flattenDiffHunks(sampleHunks);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ lineNumber: 10, kind: "ctx", text: "unchanged" });
    expect(lines[1]).toMatchObject({ lineNumber: 11, kind: "add", text: "added line" });
    expect(lines[2]).toMatchObject({ lineNumber: 12, kind: "del", text: "removed line" });
  });

  test("computes visible line window from scroll position", () => {
    const range = diffVisibleLineRange(100, 200, 50, 5);
    expect(range.start).toBe(0);
    expect(range.end).toBeGreaterThan(10);
  });
});

describe("VirtualizedDiffView", () => {
  test("renders diff lines inside a scroll viewport", () => {
    render(<VirtualizedDiffView hunks={sampleHunks} />);
    const viewport = document.querySelector(".lyra-agents-diff-viewport");
    expect(viewport).toBeTruthy();
    expect(document.querySelector(".lyra-agents-diff-width-probe")).toBeTruthy();
    expect(
      viewport?.querySelectorAll(".lyra-agents-diff-viewport-track > .lyra-agents-diff-line").length
    ).toBe(3);
    expect(screen.getByText("added line")).toBeTruthy();
    expect(screen.getAllByText("removed line").length).toBeGreaterThanOrEqual(1);
  });

  test("returns null when there are no diff lines", () => {
    const { container } = render(<VirtualizedDiffView hunks={[]} />);
    expect(container.firstChild).toBeNull();
  });
});