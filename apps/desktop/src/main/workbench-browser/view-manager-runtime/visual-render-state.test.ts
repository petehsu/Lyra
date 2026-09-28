import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeRenderStates, renderStateId } from "./visual-render-state";
import type { VisualMark } from "./visual-scene-types";

const region = (rows: number, columns: number, unique = false): VisualMark => {
  const base = {
    targetRef: "region",
    mark: "a",
    documentId: "doc",
    frameTreeNodeId: 1,
    signature: "sig",
    kind: "region" as const,
    role: "div",
    disabled: false,
    bounds: { x: 0, y: 0, width: columns * 12, height: rows * 12 },
  };
  return {
    ...base,
    grid: {
      source: "dom",
      xs: Array.from({ length: columns }, (_, i) => (i + 0.5) / columns),
      ys: Array.from({ length: rows }, (_, i) => (i + 0.5) / rows),
      cells: Array.from({ length: rows * columns }, (_, i) => ({
        ...base,
        kind: "control",
        targetRef: "cell-" + i,
        renderState: {
          attributes: {},
          layers: [{ background: unique ? "color-" + i : "same" }],
        },
      })),
    },
  };
};
test("large heterogeneous state is bounded and focused detail recovers the exact omitted descriptor", () => {
  const grid = region(40, 40, true);
  const compact = summarizeRenderStates([grid]);
  assert(JSON.stringify(compact).length < 14000);
  assert.equal(compact.structures[0]!.detailRequired, true);
  assert(compact.statesOmitted > 0);
  const focused = summarizeRenderStates([grid], {
    region: "a",
    cell: { row: 38, column: 39 },
  });
  const expected = grid.grid!.cells![37 * 40 + 38]!.renderState;
  assert.deepEqual(focused.states[renderStateId(expected)], expected);
  assert.equal(
    focused.structures[0]!.focusedCell!.state,
    renderStateId(expected),
  );
});
test("homogeneous large structures represent all positions through a baseline without per-cell output", () => {
  const compact = summarizeRenderStates([region(40, 40)]);
  const structure = compact.structures[0]!;
  assert.equal(
    Object.values(structure.counts).reduce((a, b) => a + b, 0),
    1600,
  );
  assert.deepEqual(structure.exceptions, []);
  assert(JSON.stringify(compact).length < 2000);
});
test("render changes are scoped to identical documents and grid geometry", () => {
  const before = region(3, 5),
    after = region(3, 5);
  (after.grid!.cells![7] as { renderState: unknown }).renderState = {
    attributes: { checked: true },
    layers: [],
  };
  const changes = summarizeRenderStates([after], undefined, [before])
    .structures[0]!;
  assert.equal(changes.changedCount, 1);
  assert.equal(changes.changed![0]!.row, 2);
  assert.equal(changes.changed![0]!.column, 3);
  const other = { ...after, documentId: "other" };
  assert.equal(
    summarizeRenderStates([other], undefined, [before]).structures[0]!
      .comparison,
    "baseline",
  );
});
test("many regions declare omitted detail while retaining their public object references", () => {
  const marks = Array.from({ length: 40 }, (_, i) => ({
    ...region(8, 8, true),
    mark: String(i),
    targetRef: String(i),
  }));
  const compact = summarizeRenderStates(marks);
  assert.equal(compact.structures.length, 8);
  assert.equal(compact.structuresOmitted, 32);
  assert.equal(compact.objects.length, 40);
  assert(JSON.stringify(compact).length < 24000);
});
