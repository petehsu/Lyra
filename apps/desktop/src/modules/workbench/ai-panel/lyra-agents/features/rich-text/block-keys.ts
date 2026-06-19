import type { InlineRenderNode, RenderBlock } from "../../../../../../shared/render";

const inlineFingerprint = (nodes: readonly InlineRenderNode[]): string =>
  nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return `t:${node.value}`;
        case "code":
          return `c:${node.value}`;
        case "strong":
        case "emphasis":
        case "strikethrough":
        case "link":
          return `${node.kind}:${inlineFingerprint(node.children)}`;
        case "image":
          return `img:${node.src}`;
        case "mathInline":
          return `mi:${node.latex}:${node.svg ?? ""}`;
        case "softBreak":
          return "sb";
        case "hardBreak":
          return "hb";
        default:
          return "x";
      }
    })
    .join("|");

const blocksFingerprint = (blocks: readonly RenderBlock[]): string =>
  blocks
    .map((block, index) => `${blockKey(block, index)}`)
    .join(";");

export const blockKey = (block: RenderBlock, index: number): string => {
  switch (block.kind) {
    case "paragraph":
      return `p:${inlineFingerprint(block.children)}`;
    case "heading":
      return `h${block.level}:${inlineFingerprint(block.children)}`;
    case "blockquote":
      return `bq:${blocksFingerprint(block.children)}`;
    case "list":
      return `list:${block.ordered ? "o" : "u"}:${block.items
        .map((item, itemIndex) => `${itemIndex}:${item.checked ?? ""}:${blocksFingerprint(item.children)}`)
        .join("|")}`;
    case "codeBlock":
      return `code:${block.language ?? ""}:${block.source}`;
    case "mermaid":
      return `mermaid:${block.source}:${block.svg ?? ""}`;
    case "mathBlock":
      return `math:${block.latex}:${block.svg ?? ""}`;
    case "table":
      return `table:${block.headers.length}:${block.rows.length}`;
    case "thematicBreak":
      return "hr";
    default:
      return `block:${index}`;
  }
};