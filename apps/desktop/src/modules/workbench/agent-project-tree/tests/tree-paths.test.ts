import { describe, expect, test } from "vitest";

import {
  createParentPath,
  isValidEntryName,
  joinPath,
  parentDirectoryOf,
  relativeProjectPath
} from "../tree-paths";

describe("project tree paths", () => {
  test("joins, parents, and relativizes posix paths", () => {
    expect(parentDirectoryOf("/Users/petehsu/Documents/Lyra/src/main.ts")).toBe(
      "/Users/petehsu/Documents/Lyra/src"
    );
    expect(joinPath("/Users/petehsu/Documents/Lyra/src", "lib.ts")).toBe(
      "/Users/petehsu/Documents/Lyra/src/lib.ts"
    );
    expect(relativeProjectPath("/Users/petehsu/Documents/Lyra", "/Users/petehsu/Documents/Lyra/src/main.ts")).toBe(
      "src/main.ts"
    );
    expect(relativeProjectPath("/Users/petehsu/Documents/Lyra", "/Users/petehsu/Documents/Lyra")).toBe(".");
    expect(createParentPath("/Users/petehsu/Documents/Lyra/src", "directory")).toBe(
      "/Users/petehsu/Documents/Lyra/src"
    );
    expect(createParentPath("/Users/petehsu/Documents/Lyra/src/main.ts", "file")).toBe(
      "/Users/petehsu/Documents/Lyra/src"
    );
  });

  test("rejects empty or path-like entry names", () => {
    expect(isValidEntryName("lib.ts")).toBe(true);
    expect(isValidEntryName("")).toBe(false);
    expect(isValidEntryName(".")).toBe(false);
    expect(isValidEntryName("a/b")).toBe(false);
  });
});
