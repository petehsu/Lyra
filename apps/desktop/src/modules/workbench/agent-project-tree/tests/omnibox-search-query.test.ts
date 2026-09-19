import { describe, expect, test } from "vitest";

import { isProjectTreeFindQuery } from "../../shell/navigation-input";

describe("isProjectTreeFindQuery", () => {
  test("treats free-form and filename queries as find-in-files", () => {
    expect(isProjectTreeFindQuery("useEffect")).toBe(true);
    expect(isProjectTreeFindQuery("App.tsx")).toBe(true);
    expect(isProjectTreeFindQuery("github.com")).toBe(true);
  });

  test("leaves commands, explicit urls, and absolute paths to the omnibox", () => {
    expect(isProjectTreeFindQuery("")).toBe(false);
    expect(isProjectTreeFindQuery("> pnpm test")).toBe(false);
    expect(isProjectTreeFindQuery("https://github.com")).toBe(false);
    expect(isProjectTreeFindQuery("/Users/me/project")).toBe(false);
    expect(isProjectTreeFindQuery("file:///Users/me/project/file.ts")).toBe(false);
  });
});
