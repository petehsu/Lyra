import { describe, expect, test } from "vitest";

import { parseWorkbenchCommand } from "../service";

describe("intent parser", () => {
  test("parses shell command", () => {
    expect(parseWorkbenchCommand("> pnpm test")).toEqual({
      kind: "command",
      value: "pnpm test"
    });
  });

  test("parses url", () => {
    expect(parseWorkbenchCommand("https://localhost:3000")).toEqual({
      kind: "url",
      value: "https://localhost:3000"
    });
  });

  test("parses file path", () => {
    expect(parseWorkbenchCommand("src/main.ts")).toEqual({
      kind: "file",
      value: "src/main.ts"
    });
  });

  test("falls back to task", () => {
    expect(parseWorkbenchCommand("修复结算页错误")).toEqual({
      kind: "task",
      value: "修复结算页错误"
    });
  });
});
