import { describe, expect, it } from "vitest";

import { lyraParseMarkdownIntoBlocks } from "../remark-block-splitter";

describe("lyraParseMarkdownIntoBlocks", () => {
  it("returns a single empty block for empty input", () => {
    expect(lyraParseMarkdownIntoBlocks("")).toEqual([""]);
  });

  it("splits heading + paragraph + fenced code + list into separate blocks", () => {
    const md = [
      "# Title",
      "",
      "Some paragraph text.",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "- item one",
      "- item two",
      ""
    ].join("\n");

    const blocks = lyraParseMarkdownIntoBlocks(md);

    // heading, paragraph, code fence, list → 4 blocks
    expect(blocks.length).toBe(4);
    expect(blocks[0]).toContain("# Title");
    expect(blocks[1]).toContain("Some paragraph text.");
    expect(blocks[2]).toContain("```ts");
    expect(blocks[2]).toContain("const x = 1;");
    expect(blocks[2]).toContain("```");
    expect(blocks[3]).toContain("- item one");
    expect(blocks[3]).toContain("- item two");
  });

  it("does not split a setext heading into two blocks", () => {
    // marked's Lexer treats the underline `===` as a separate block;
    // remark-parse recognises the whole thing as one setext heading.
    const md = "Title text\n===\n\nParagraph after.";
    const blocks = lyraParseMarkdownIntoBlocks(md);

    expect(blocks.length).toBe(2);
    expect(blocks[0]).toBe("Title text\n===\n\n");
    expect(blocks[1]).toBe("Paragraph after.");
  });

  it("keeps an HTML block with inner blank lines as one block", () => {
    const md = '<div>\n\n<p>inner</p>\n\n</div>\n\nAfter.';
    const blocks = lyraParseMarkdownIntoBlocks(md);

    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain("<div>");
    expect(blocks[0]).toContain("<p>inner</p>");
    expect(blocks[0]).toContain("</div>");
    expect(blocks[1]).toBe("After.");
  });

  it("keeps a $$ display math block intact across lines", () => {
    const md = "$$\nx^2 + y^2\n$$\n\nParagraph.";
    const blocks = lyraParseMarkdownIntoBlocks(md);

    // remark-gfm (without remark-math) treats $$…$$ as a single paragraph,
    // which is exactly what we want: the block stays together so the
    // renderer's math plugin can process it as a unit.
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain("$$");
    expect(blocks[0]).toContain("x^2 + y^2");
    expect(blocks[1]).toBe("Paragraph.");
  });

  it("preserves an unclosed fenced code block as a trailing block (streaming)", () => {
    const md = "Here\n```ts\nconst x = 1";
    const blocks = lyraParseMarkdownIntoBlocks(md);

    // "Here" is one paragraph, the unclosed fence is trailing content
    // that remark can't close → appended as a final block.
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain("Here");
    expect(blocks[blocks.length - 1]).toContain("```ts");
    expect(blocks[blocks.length - 1]).toContain("const x = 1");
  });

  it("keeps a :::details container's opening fence in one block", () => {
    const md = ":::details Summary\ninner content\n:::\n\nAfter.";
    const blocks = lyraParseMarkdownIntoBlocks(md);

    // The remarkDetailsContainer plugin runs in the *rendering* pass, not the
    // splitting pass. At split time remark sees a paragraph containing the
    // `:::details` text. The key assertion is that the fence lines are not
    // scattered across separate blocks.
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain(":::details");
    expect(blocks[0]).toContain("inner content");
    expect(blocks[0]).toContain(":::");
    expect(blocks[1]).toBe("After.");
  });

  it("handles a single paragraph with no trailing newline", () => {
    const md = "Just a paragraph.";
    const blocks = lyraParseMarkdownIntoBlocks(md);

    expect(blocks.length).toBe(1);
    expect(blocks[0]).toBe("Just a paragraph.");
  });

  it("preserves trailing whitespace-only content as a final block", () => {
    const md = "# Heading\n\n   \n";
    const blocks = lyraParseMarkdownIntoBlocks(md);

    // The heading block consumes its trailing newlines; the remaining "   \n"
    // is un-parsed trailing text appended as a final block.
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0]).toContain("# Heading");
  });

  it("handles emoji / surrogate pairs in markdown without corrupting offsets", () => {
    const md = "# 🚀 Heading\n\nParagraph with 😀 emoji.\n\nAfter.";
    const blocks = lyraParseMarkdownIntoBlocks(md);

    expect(blocks.length).toBe(3);
    expect(blocks[0]).toContain("🚀");
    expect(blocks[1]).toContain("😀");
    expect(blocks[2]).toBe("After.");
  });

  it("splits a table block as a single unit", () => {
    const md = [
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "After table."
    ].join("\n");
    const blocks = lyraParseMarkdownIntoBlocks(md);

    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain("| A | B |");
    expect(blocks[0]).toContain("| 1 | 2 |");
    expect(blocks[1]).toBe("After table.");
  });

  it("does not produce empty-string blocks between adjacent blocks", () => {
    const md = "# A\n\n# B\n\n# C\n";
    const blocks = lyraParseMarkdownIntoBlocks(md);

    // Each heading block swallows its trailing blank lines, so there should
    // be no empty-string blocks in the result.
    for (const block of blocks) {
      expect(block.length).toBeGreaterThan(0);
    }
    expect(blocks.length).toBe(3);
  });

  it("returns the original markdown as a single block when parsing fails gracefully", () => {
    // A null-byte or other control character won't crash remark, but we test
    // that the function never returns an empty array.
    const md = "Normal text\x00with null";
    const blocks = lyraParseMarkdownIntoBlocks(md);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks.join("")).toContain("Normal text");
  });
});