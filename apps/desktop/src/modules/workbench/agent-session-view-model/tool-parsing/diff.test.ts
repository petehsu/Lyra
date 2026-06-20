import { describe, expect, test } from "vitest";

import { parseUnifiedDiff, reconstructContentAfterDiff } from "./diff";

describe("parseUnifiedDiff", () => {
  test("parses diffy-style hunks with file headers", () => {
    const text = [
      "--- src/a.ts",
      "+++ src/a.ts",
      "@@ -1,2 +1,3 @@",
      " line",
      "-old",
      "+new",
      "+added"
    ].join("\n");
    const parsed = parseUnifiedDiff(text);
    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(1);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0]?.lines.map((line) => line.kind)).toEqual(["ctx", "del", "add", "add"]);
  });

  test("returns empty stats for blank diff", () => {
    expect(parseUnifiedDiff("")).toEqual({
      hunks: [],
      additions: 0,
      deletions: 0
    });
  });

  test("reconstructs post-edit content from hunks", () => {
    const diff = [
      "--- src/a.ts",
      "+++ src/a.ts",
      "@@ -1,2 +1,3 @@",
      " line",
      "-old",
      "+new",
      "+added"
    ].join("\n");
    const parsed = parseUnifiedDiff(diff);
    expect(reconstructContentAfterDiff("line\nold", parsed.hunks)).toBe("line\nnew\nadded");
  });
});