import { describe, expect, test } from "vitest";

import {
  flattenFileSearchRows,
  groupFileSearchHits,
  relativeFileSearchPath,
  toSearchFileEntry
} from "../file-search";

describe("groupFileSearchHits", () => {
  test("keeps first-seen file order and groups line hits under each file", () => {
    expect(groupFileSearchHits([
      { filePath: "/p/a.ts", line: 2, column: 1, preview: "alpha" },
      { filePath: "/p/b.ts", line: 1, column: 4, preview: "beta" },
      { filePath: "/p/a.ts", line: 9, column: 2, preview: "again" }
    ])).toEqual([
      {
        filePath: "/p/a.ts",
        hits: [
          { filePath: "/p/a.ts", line: 2, column: 1, preview: "alpha" },
          { filePath: "/p/a.ts", line: 9, column: 2, preview: "again" }
        ]
      },
      {
        filePath: "/p/b.ts",
        hits: [
          { filePath: "/p/b.ts", line: 1, column: 4, preview: "beta" }
        ]
      }
    ]);
  });
});

describe("relativeFileSearchPath", () => {
  test("strips the project root prefix", () => {
    expect(relativeFileSearchPath("/p/src/main.ts", "/p")).toBe("src/main.ts");
    expect(relativeFileSearchPath("C:\\p\\src\\main.ts", "C:\\p")).toBe("src\\main.ts");
  });
});

describe("flattenFileSearchRows", () => {
  test("shows a loading row until the first hits arrive", () => {
    expect(flattenFileSearchRows({
      query: "alpha",
      rootPath: "/p",
      status: "searching",
      hits: [],
      truncated: false,
      collapsedFilePaths: []
    }, "/p")).toEqual([{ kind: "loading", key: "search-loading" }]);
  });

  test("nests line hits under file headers and can collapse a file", () => {
    const rows = flattenFileSearchRows({
      query: "alpha",
      rootPath: "/p",
      status: "ready",
      hits: [
        { filePath: "/p/a.ts", line: 2, column: 1, preview: "alpha" },
        { filePath: "/p/b.ts", line: 1, column: 4, preview: "alpha" }
      ],
      truncated: false,
      collapsedFilePaths: ["/p/a.ts"]
    }, "/p");

    expect(rows.map((row) => row.kind)).toEqual(["file", "file", "hit"]);
    expect(rows[0]).toMatchObject({
      kind: "file",
      relativePath: "a.ts",
      expanded: false,
      entry: toSearchFileEntry("/p/a.ts")
    });
    expect(rows[2]).toMatchObject({
      kind: "hit",
      hit: { filePath: "/p/b.ts", line: 1 }
    });
  });
});
