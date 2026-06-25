import { describe, expect, it } from "vitest";

import {
  parseMarkdownBlocks,
  replaceMarkdownLine,
  type EditableMarkdownBlock
} from "./markdown-blocks";

const richBlock = (markdown: string): EditableMarkdownBlock => {
  const block = parseMarkdownBlocks(markdown).find((entry) => entry.kind === "rich");
  if (block === undefined || block.kind !== "rich") throw new Error("expected a rich block");
  return block;
};

describe("parseMarkdownBlocks", () => {
  it("groups a table (header + delimiter + rows) into one rich block", () => {
    const markdown = ["| A | B |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |"].join("\n");
    const blocks = parseMarkdownBlocks(markdown);
    expect(blocks).toHaveLength(1);
    const [block] = blocks;
    expect(block?.kind).toBe("rich");
    if (block?.kind !== "rich") throw new Error("expected rich");
    expect(block.text).toBe(markdown);
    expect(block.lineIndex).toBe(0);
    expect(block.lineEnd).toBe(4);
  });

  it("groups a multi-line blockquote into one rich block", () => {
    const markdown = ["> first", "> second"].join("\n");
    const blocks = parseMarkdownBlocks(markdown);
    expect(blocks).toHaveLength(1);
    const [block] = blocks;
    expect(block?.kind).toBe("rich");
    if (block?.kind !== "rich") throw new Error("expected rich");
    expect(block.text).toBe(markdown);
    expect(block.lineEnd).toBe(2);
  });

  it("keeps headings, lists and paragraphs as single-line editable blocks", () => {
    const blocks = parseMarkdownBlocks("## Title\n- item\nparagraph");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "list", "paragraph"]);
  });
});

describe("replaceMarkdownLine", () => {
  it("replaces the whole source range of a rich block", () => {
    const markdown = ["intro", "> old quote", "> old quote 2", "outro"].join("\n");
    const block = richBlock(markdown);
    const next = replaceMarkdownLine(markdown, block, "> new quote");
    expect(next).toBe(["intro", "> new quote", "outro"].join("\n"));
  });

  it("preserves the structural prefix when editing a heading", () => {
    const markdown = "## Title";
    const [block] = parseMarkdownBlocks(markdown);
    if (block === undefined || block.kind !== "heading") throw new Error("expected heading");
    const next = replaceMarkdownLine(markdown, block, "Renamed");
    expect(next).toBe("## Renamed");
  });
});
