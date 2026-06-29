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
    expect(iconClass(call({ kind: "task", title: "Write todos" }))).toContain("clipboard-paste");
    expect(iconClass(call({ kind: "task", title: "Update todo" }))).toContain("check-check");
  });

  test("uses Git icon when status is only visible through details", () => {
    expect(iconClass(call({
      kind: "read",
      title: "Status",
      details: { type: "read", file: "/tools/git/status" }
    }))).toContain("git-branch");
  });

  test("keeps direct tool labels out of the thought fallback", () => {
    expect(iconClass(call({ title: "Searched project" }))).toContain("search");
    expect(iconClass(call({ title: "Read Lyra artifact" }))).toContain("file-text");
  });
});
