/**
 * Remark-based semantic block splitter for streamdown's streaming mode.
 *
 * streamdown's default `parseMarkdownIntoBlocks` uses marked's `Lexer.lex()`
 * to split markdown into blocks, then renders each block with remark-parse.
 * The two parsers disagree on block boundaries (setext headings, HTML blocks,
 * `$$` math, footnotes), which produces visible rendering glitches during
 * streaming — the very problem reported after the rich-render unification.
 *
 * This splitter replaces marked with remark-parse so the splitting pass and
 * the rendering pass share one grammar. It parses the markdown into an mdast,
 * then slices the original string at each top-level node's position offsets.
 * The trailing text that remark could not parse into a complete node (common
 * during streaming) is appended as a final block so partial content is never
 * lost.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

/* eslint-disable @typescript-eslint/no-explicit-any -- mdast node types are
 * not a direct dependency; the position shape is stable per the mdast spec. */

/**
 * The remark processor used for block splitting.
 *
 * `remarkGfm` mirrors what streamdown applies internally (GFM tables,
 * strikethrough, autolink literals, task lists). Math (`$$…$$`) is left as a
 * plain paragraph here — that is intentional: remark will not split across a
 * `$$` block the way marked does, so the block stays intact for the renderer's
 * own math plugin to pick up. The goal is boundary *agreement*, not reproducing
 * every node type the renderer supports.
 */
const processor = unified().use(remarkParse).use(remarkGfm);

/**
 * Split markdown into raw block strings using remark-parse semantics.
 *
 * Returns one string per top-level mdast node, sliced from the original
 * markdown by position offset so each block is byte-for-byte identical to the
 * source region that produced it. Trailing whitespace between blocks is kept
 * with the preceding block. Any un-parsed trailing text (incomplete content
 * during streaming) is returned as a final block.
 */
export function lyraParseMarkdownIntoBlocks(markdown: string): string[] {
  if (markdown.length === 0) {
    return [""];
  }

  let tree: any;
  try {
    tree = processor.parse(markdown);
  } catch {
    // remark is extremely tolerant; if it somehow throws, fall back to a
    // single block so rendering still proceeds instead of crashing.
    return [markdown];
  }

  const children: readonly any[] = tree.children ?? [];
  if (children.length === 0) {
    return [markdown];
  }

  const blocks: string[] = [];
  let consumed = 0;

  for (const node of children) {
    const start = node.position?.start?.offset ?? null;
    const end = node.position?.end?.offset ?? null;
    if (start === null || end === null || end <= start) {
      continue;
    }
    // Extend the block to swallow trailing blank-line separators so they stay
    // with the preceding block (matches streamdown's default convention and
    // avoids empty-string blocks between adjacent nodes).
    const blockEnd = consumeTrailingNewlines(markdown, end);
    blocks.push(markdown.slice(start, blockEnd));
    consumed = blockEnd;
  }

  // remark-parse may leave trailing text that it could not lift into a
  // top-level node (e.g. an unclosed fenced code block during streaming).
  // Append it as a final block so the renderer still processes it.
  if (consumed < markdown.length) {
    blocks.push(markdown.slice(consumed));
  }

  // If every node had null positions (shouldn't happen, but stay safe), return
  // the whole document as one block — streamdown expects at least one block.
  if (blocks.length === 0) {
    return [markdown];
  }

  return blocks;
}

/**
 * Advance the offset past any blank lines that follow the block, so the
 * inter-block separator stays with the preceding block rather than becoming a
 * standalone empty block.
 */
function consumeTrailingNewlines(markdown: string, offset: number): number {
  let end = offset;
  const { length } = markdown;
  while (end < length) {
    const ch = markdown.charCodeAt(end);
    if (ch !== 0x0a /* \n */ && ch !== 0x0d /* \r */ && ch !== 0x20 /* space */) {
      break;
    }
    end += 1;
  }
  return end;
}