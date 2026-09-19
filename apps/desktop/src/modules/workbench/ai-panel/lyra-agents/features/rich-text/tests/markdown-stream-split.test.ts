import { describe, expect, it } from "vitest";

import { splitSettledMarkdown } from "../markdown-stream-split";

describe("splitSettledMarkdown", () => {
  it("keeps an incomplete paragraph in the tail", () => {
    expect(splitSettledMarkdown("A **bold phrase")).toEqual({
      settled: [],
      tail: "A **bold phrase"
    });
  });

  it("settles a completed paragraph on a blank line", () => {
    expect(splitSettledMarkdown("# Title\n\nBody still writing")).toEqual({
      settled: ["# Title\n\n"],
      tail: "Body still writing"
    });
  });

  it("does not settle blank lines inside an open fence", () => {
    const text = "Intro\n\n```ts\nconst x = 1\n\nconst y = 2";
    expect(splitSettledMarkdown(text)).toEqual({
      settled: ["Intro\n\n"],
      tail: "```ts\nconst x = 1\n\nconst y = 2"
    });
  });

  it("settles a closed fence and keeps the following tail", () => {
    const text = "```ts\nconst x = 1\n```\n\nAfter";
    expect(splitSettledMarkdown(text)).toEqual({
      settled: ["```ts\nconst x = 1\n```\n\n"],
      tail: "After"
    });
  });

  it("does not settle blank lines inside display math", () => {
    const text = "Before\n\n$$\na = b\n\nc = d\n$$\n\nAfter";
    expect(splitSettledMarkdown(text)).toEqual({
      settled: ["Before\n\n", "$$\na = b\n\nc = d\n$$\n\n"],
      tail: "After"
    });
  });

  it("treats a one-line bracket formula as closed", () => {
    expect(splitSettledMarkdown("Display:\n\n\\[e = mc^2\\]\n\nInline")).toEqual({
      settled: ["Display:\n\n", "\\[e = mc^2\\]\n\n"],
      tail: "Inline"
    });
  });

  it("keeps a list without a blank line in one tail", () => {
    expect(splitSettledMarkdown("- a\n- b\n- c")).toEqual({
      settled: [],
      tail: "- a\n- b\n- c"
    });
  });

  it("preserves already-settled block text when the tail grows", () => {
    const first = splitSettledMarkdown("One\n\nTw");
    const second = splitSettledMarkdown("One\n\nTwo");
    expect(second.settled).toEqual(first.settled);
    expect(second.settled[0]).toBe("One\n\n");
    expect(second.tail).toBe("Two");
  });
});
