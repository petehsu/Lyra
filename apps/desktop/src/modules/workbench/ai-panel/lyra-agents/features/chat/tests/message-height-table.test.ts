import { describe, expect, test } from "vitest";

import {
  createMessageHeightStore,
  offsetOfIndex,
  totalHeight,
  lastIndexEndingAtOrAbove,
  visibleIndexRange,
  HEIGHT_EPSILON_PX
} from "../message-height-table";

const FALLBACK = 100;

describe("createMessageHeightStore", () => {
  test("measured supersedes estimate; epsilon dedupes", () => {
    const store = createMessageHeightStore();
    store.setEstimate("a", 50);
    expect(store.heightOf("a", FALLBACK)).toBe(50);
    expect(store.hasMeasured("a")).toBe(false);

    expect(store.setMeasured("a", 80)).toBe(true);
    expect(store.heightOf("a", FALLBACK)).toBe(80);
    expect(store.hasMeasured("a")).toBe(true);

    // Sub-epsilon change is ignored.
    expect(store.setMeasured("a", 80 + HEIGHT_EPSILON_PX / 2)).toBe(false);
    // Above-epsilon change applies.
    expect(store.setMeasured("a", 120)).toBe(true);
    expect(store.heightOf("a", FALLBACK)).toBe(120);
  });

  test("estimate does not override an existing measurement", () => {
    const store = createMessageHeightStore();
    store.setMeasured("a", 70);
    store.setEstimate("a", 999);
    expect(store.heightOf("a", FALLBACK)).toBe(70);
  });

  test("heightOf falls back when unknown", () => {
    const store = createMessageHeightStore();
    expect(store.heightOf("missing", FALLBACK)).toBe(FALLBACK);
  });

  test("retain drops ids outside the keep set", () => {
    const store = createMessageHeightStore();
    store.setMeasured("a", 10);
    store.setEstimate("b", 20);
    store.retain(["a"]);
    expect(store.hasMeasured("a")).toBe(true);
    expect(store.heightOf("b", FALLBACK)).toBe(FALLBACK);
  });
});

describe("prefix-sum math", () => {
  const ids = ["a", "b", "c", "d"];
  const build = () => {
    const store = createMessageHeightStore();
    store.setMeasured("a", 10);
    store.setMeasured("b", 20);
    store.setMeasured("c", 30);
    store.setMeasured("d", 40);
    return store;
  };

  test("offsetOfIndex sums preceding heights", () => {
    const store = build();
    expect(offsetOfIndex(store, ids, 0, FALLBACK)).toBe(0);
    expect(offsetOfIndex(store, ids, 1, FALLBACK)).toBe(10);
    expect(offsetOfIndex(store, ids, 3, FALLBACK)).toBe(60);
    expect(offsetOfIndex(store, ids, 99, FALLBACK)).toBe(100);
  });

  test("totalHeight sums all", () => {
    expect(totalHeight(build(), ids, FALLBACK)).toBe(100);
  });

  test("unmeasured items use fallback in sums", () => {
    const store = createMessageHeightStore();
    store.setMeasured("b", 20);
    // a,c,d unknown -> fallback 100 each; b -> 20
    expect(totalHeight(store, ids, FALLBACK)).toBe(320);
  });

});

describe("lastIndexEndingAtOrAbove (sticky)", () => {
  const ids = ["u0", "a1", "u2", "a3"];
  const build = () => {
    const store = createMessageHeightStore();
    store.setMeasured("u0", 100); // bottom 100
    store.setMeasured("a1", 100); // bottom 200
    store.setMeasured("u2", 100); // bottom 300
    store.setMeasured("a3", 100); // bottom 400
    return store;
  };

  test("returns last item fully above the edge", () => {
    const store = build();
    expect(lastIndexEndingAtOrAbove(store, ids, 250, FALLBACK)).toBe(1);
    expect(lastIndexEndingAtOrAbove(store, ids, 200, FALLBACK)).toBe(1);
    expect(lastIndexEndingAtOrAbove(store, ids, 50, FALLBACK)).toBe(-1);
  });

  test("predicate filters to user messages", () => {
    const store = build();
    const isUser = (i: number) => ids[i]!.startsWith("u");
    // edge past u2's bottom (300): last user above is u2 at index 2.
    expect(lastIndexEndingAtOrAbove(store, ids, 350, FALLBACK, isUser)).toBe(2);
    // edge at 250: items above are u0,a1; last user is u0 at index 0.
    expect(lastIndexEndingAtOrAbove(store, ids, 250, FALLBACK, isUser)).toBe(0);
  });
});

describe("visibleIndexRange", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const build = () => {
    const store = createMessageHeightStore();
    for (const id of ids) store.setMeasured(id, 100);
    return store;
  };

  test("selects items intersecting the viewport", () => {
    const store = build();
    // viewport [150, 350] intersects b(100-200), c(200-300), d(300-400)
    expect(visibleIndexRange(store, ids, 150, 350, FALLBACK)).toEqual([1, 3]);
  });

  test("top of list", () => {
    expect(visibleIndexRange(build(), ids, 0, 250, FALLBACK)).toEqual([0, 2]);
  });

  test("empty list", () => {
    const store = createMessageHeightStore();
    expect(visibleIndexRange(store, [], 0, 100, FALLBACK)).toEqual([0, -1]);
  });

  test("viewport past end clamps to last item", () => {
    expect(visibleIndexRange(build(), ids, 9000, 9200, FALLBACK)).toEqual([4, 4]);
  });
});
