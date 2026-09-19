import { describe, expect, test } from "vitest";

import { parseRipgrepJsonLine } from "./search-text";

describe("parseRipgrepJsonLine", () => {
  test("reads path, 1-based line, and column from a match event", () => {
    expect(parseRipgrepJsonLine(JSON.stringify({
      type: "match",
      data: {
        path: { text: "/project/src/main.rs" },
        lines: { text: "    println!(\"hello\");\n" },
        line_number: 2,
        submatches: [
          {
            start: 4,
            end: 11,
            match: { text: "println" }
          }
        ]
      }
    }))).toEqual({
      filePath: "/project/src/main.rs",
      line: 2,
      column: 5,
      preview: "println!(\"hello\");"
    });
  });

  test("ignores begin/end events and invalid json", () => {
    expect(parseRipgrepJsonLine(JSON.stringify({ type: "begin", data: {} }))).toBeNull();
    expect(parseRipgrepJsonLine("{")).toBeNull();
    expect(parseRipgrepJsonLine("")).toBeNull();
  });
});
