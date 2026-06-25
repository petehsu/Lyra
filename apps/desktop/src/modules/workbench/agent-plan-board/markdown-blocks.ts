/**
 * Pure markdown block segmentation for the Agent Plan Board.
 *
 * The board renders each top-level block as rich HTML (via @lyra/markdown-render)
 * while keeping per-block hover edit/annotate. To support that, parsing returns
 * blocks that map back to source line ranges:
 *
 * - heading / list / paragraph: single source line, edited as plain text
 *   (the structural prefix such as `## ` or `- ` is preserved on save so the
 *   inline editor never exposes raw markdown markers).
 * - code / rich (tables, blockquotes): multi-line constructs kept whole. `rich`
 *   blocks are editable through their raw source slice.
 *
 * ponytail: reference-style link definitions are not resolved per block, since
 * each block is rendered from its own source slice. Plans rarely use them; the
 * upgrade path is a single full-document render with token.map block offsets.
 */

export type MarkdownBlock =
  | {
      readonly kind: "heading";
      readonly level: number;
      readonly text: string;
      readonly key: string;
      readonly lineIndex: number;
      readonly prefix: string;
    }
  | {
      readonly kind: "list";
      readonly text: string;
      readonly taskState: "todo" | "done" | null;
      readonly key: string;
      readonly lineIndex: number;
      readonly prefix: string;
    }
  | {
      readonly kind: "paragraph";
      readonly text: string;
      readonly key: string;
      readonly lineIndex: number;
      readonly prefix: string;
    }
  | {
      readonly kind: "rich";
      readonly text: string;
      readonly key: string;
      readonly lineIndex: number;
      readonly lineEnd: number;
    }
  | {
      readonly kind: "code";
      readonly text: string;
      readonly key: string;
    };

export type EditableMarkdownBlock = Extract<MarkdownBlock, { readonly lineIndex: number }>;

export const editableLineId = (lineIndex: number): string => `line-${lineIndex + 1}`;

export const splitMarkdownLines = (markdown: string): string[] =>
  markdown.replace(/\r\n?/gu, "\n").split("\n");

const tableDelimiter = /^\s*\|?(?:\s*:?-{1,}:?\s*\|)+\s*:?-{1,}:?\s*\|?\s*$/u;
const isTableRow = (line: string): boolean => line.includes("|");

export const parseMarkdownBlocks = (markdown: string): MarkdownBlock[] => {
  const lines = splitMarkdownLines(markdown);
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  let inCode = false;
  let codeLines: string[] = [];
  let codeStart = -1;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        blocks.push({ kind: "code", text: codeLines.join("\n"), key: `code-${codeStart}-${index}` });
        codeLines = [];
        codeStart = -1;
        inCode = false;
      } else {
        inCode = true;
        codeStart = index;
      }
      index += 1;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      index += 1;
      continue;
    }

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const start = index;
      const buffer: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        buffer.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({
        kind: "rich",
        text: buffer.join("\n"),
        key: `rich-${start}-${index}`,
        lineIndex: start,
        lineEnd: index
      });
      continue;
    }

    if (isTableRow(line) && tableDelimiter.test(lines[index + 1] ?? "")) {
      const start = index;
      const buffer: string[] = [line, lines[index + 1] ?? ""];
      index += 2;
      while (index < lines.length) {
        const next = lines[index] ?? "";
        if (next.trim().length === 0 || !isTableRow(next)) break;
        buffer.push(next);
        index += 1;
      }
      blocks.push({
        kind: "rich",
        text: buffer.join("\n"),
        key: `rich-${start}-${index}`,
        lineIndex: start,
        lineEnd: index
      });
      continue;
    }

    const heading = line.match(/^(\s*#{1,4}\s+)(.+)$/u);
    if (heading !== null) {
      const prefix = heading[1] ?? "";
      blocks.push({
        kind: "heading",
        level: prefix.trim().length,
        text: (heading[2] ?? "").trim(),
        key: `heading-${index}`,
        lineIndex: index,
        prefix
      });
      index += 1;
      continue;
    }

    const task = line.match(/^(\s*[-*]\s+\[( |x|X)\]\s+)(.+)$/u);
    if (task !== null) {
      blocks.push({
        kind: "list",
        taskState: (task[2] ?? "").toLowerCase() === "x" ? "done" : "todo",
        text: (task[3] ?? "").trim(),
        key: `task-${index}`,
        lineIndex: index,
        prefix: task[1] ?? ""
      });
      index += 1;
      continue;
    }

    const list = line.match(/^(\s*(?:[-*]|\d+\.)\s+)(.+)$/u);
    if (list !== null) {
      blocks.push({
        kind: "list",
        taskState: null,
        text: (list[2] ?? "").trim(),
        key: `list-${index}`,
        lineIndex: index,
        prefix: list[1] ?? ""
      });
      index += 1;
      continue;
    }

    const paragraph = line.match(/^(\s*)(.+)$/u);
    blocks.push({
      kind: "paragraph",
      text: (paragraph?.[2] ?? trimmed).trim(),
      key: `paragraph-${index}`,
      lineIndex: index,
      prefix: paragraph?.[1] ?? ""
    });
    index += 1;
  }

  if (inCode && codeLines.length > 0) {
    blocks.push({ kind: "code", text: codeLines.join("\n"), key: `code-${codeStart}-${lines.length}` });
  }

  return blocks;
};

export const replaceMarkdownLine = (
  markdown: string,
  block: EditableMarkdownBlock,
  text: string
): string => {
  const lines = splitMarkdownLines(markdown);
  if (block.kind === "rich") {
    const replacement = text.replace(/\r\n?/gu, "\n").split("\n");
    lines.splice(block.lineIndex, block.lineEnd - block.lineIndex, ...replacement);
    return lines.join("\n");
  }
  const nextText = text.trim();
  lines[block.lineIndex] = block.prefix.length > 0 ? `${block.prefix}${nextText}` : nextText;
  return lines.join("\n");
};
