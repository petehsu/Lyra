import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { ToolCallIcon } from "./Icons";
import type { ToolCall } from "../types";

const call = (overrides: Partial<ToolCall>): ToolCall => ({
  id: "tool-1",
  kind: "thought",
  title: "Tool activity",
  status: "success",
  ...overrides
});

const iconClass = (toolCall: ToolCall): string => {
  const { container } = render(<ToolCallIcon call={toolCall} />);
  return container.querySelector("svg")?.getAttribute("class") ?? "";
};

describe("ToolCallIcon", () => {
  test("uses distinct icons for todo actions", () => {
    expect(iconClass(call({ kind: "task", domain: "todo", operation: "write" }))).toContain("clipboard-paste");
    expect(iconClass(call({ kind: "task", domain: "todo", operation: "update" }))).toContain("check-check");
  });

  test("uses Git icon from the structured domain", () => {
    expect(iconClass(call({
      kind: "read",
      domain: "git",
      operation: "status"
    }))).toContain("git-branch");
  });

  test("does not infer icons from localized display titles", () => {
    expect(iconClass(call({ title: "Searched project" }))).toContain("clock");
    expect(iconClass(call({ title: "任意语言", operation: "search" }))).toContain("search");
  });
});
