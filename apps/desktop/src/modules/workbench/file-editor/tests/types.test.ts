import { describe, expect, test } from "vitest";

import { isLspLanguageId } from "../types";

describe("file editor types", () => {
  test("recognizes supported lsp languages", () => {
    expect(isLspLanguageId("typescript")).toBe(true);
    expect(isLspLanguageId("javascript")).toBe(true);
    expect(isLspLanguageId("rust")).toBe(true);
    expect(isLspLanguageId("python")).toBe(true);
  });

  test("rejects unsupported languages", () => {
    expect(isLspLanguageId("json")).toBe(false);
    expect(isLspLanguageId("go")).toBe(false);
    expect(isLspLanguageId("")).toBe(false);
  });
});
