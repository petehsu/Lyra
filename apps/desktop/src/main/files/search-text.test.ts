import { describe, expect, test } from "vitest";

import { collectLineHits } from "./search-text";

describe("collectLineHits", () => {
  test("returns 1-based line and column for the first match on a line", () => {
    const result = collectLineHits(
      "/project/src/main.rs",
      "fn main() {}\n    println!(\"hello\");\n",
      "PRINTLN",
      10
    );

    expect(result.hits).toEqual([
      {
        filePath: "/project/src/main.rs",
        line: 2,
        column: 5,
        preview: "println!(\"hello\");"
      }
    ]);
    expect(result.remaining).toBe(9);
  });

  test("stops when the remaining budget is exhausted", () => {
    const result = collectLineHits(
      "/project/a.ts",
      "alpha\nalpha\nalpha\n",
      "alpha",
      2
    );

    expect(result.hits).toHaveLength(2);
    expect(result.remaining).toBe(0);
  });
});
