import { Fragment, type ReactNode } from "react";

import { isPublicHttpsUrl } from "./https";

// ponytail: complete-app bundle cannot carry Streamdown (Shiki/Mermaid + a second
// react-dom, ~1MB). Ceiling is CommonMark blocks and inline marks; tables/math/
// diagrams stay out until a host-provided renderer exists.

export type MdInline =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "code"; readonly value: string }
  | { readonly type: "strong" | "em"; readonly children: readonly MdInline[] }
  | { readonly type: "link"; readonly href: string; readonly children: readonly MdInline[] }
  | { readonly type: "image"; readonly href: string; readonly alt: string };

export type MdBlock =
  | { readonly type: "p" | "h1" | "h2" | "h3" | "blockquote"; readonly children: readonly MdInline[] }
  | { readonly type: "ul" | "ol"; readonly items: readonly (readonly MdInline[])[] }
  | { readonly type: "pre"; readonly value: string }
  | { readonly type: "hr" };

const BULLET = /^\s*[-*+]\s+(.*)$/u;
const ORDERED = /^\s*\d+\.\s+(.*)$/u;
const HEADING = /^(#{1,3})\s+(.*)$/u;
const QUOTE = /^>\s?(.*)$/u;
const HR = /^-{3,}\s*$/u;
const FENCE = /^```/;

const takeBalanced = (source: string, start: number, open: string, close: string): number => {
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
};

export const parseInline = (source: string): readonly MdInline[] => {
  const nodes: MdInline[] = [];
  let cursor = 0;
  const pushText = (value: string): void => {
    if (value.length === 0) {
      return;
    }
    const last = nodes[nodes.length - 1];
    if (last?.type === "text") {
      nodes[nodes.length - 1] = { type: "text", value: last.value + value };
      return;
    }
    nodes.push({ type: "text", value });
  };

  while (cursor < source.length) {
    const rest = source.slice(cursor);
    if (rest.startsWith("`")) {
      const close = source.indexOf("`", cursor + 1);
      if (close > cursor) {
        nodes.push({ type: "code", value: source.slice(cursor + 1, close) });
        cursor = close + 1;
        continue;
      }
    }
    if (rest.startsWith("![")) {
      const altClose = source.indexOf("](", cursor + 2);
      const urlClose = altClose === -1 ? -1 : takeBalanced(source, altClose + 2, "(", ")");
      if (altClose > cursor && urlClose > altClose) {
        nodes.push({
          type: "image",
          alt: source.slice(cursor + 2, altClose),
          href: source.slice(altClose + 2, urlClose).trim()
        });
        cursor = urlClose + 1;
        continue;
      }
    }
    if (rest.startsWith("[")) {
      const labelClose = source.indexOf("](", cursor + 1);
      const urlClose = labelClose === -1 ? -1 : takeBalanced(source, labelClose + 2, "(", ")");
      if (labelClose > cursor && urlClose > labelClose) {
        nodes.push({
          type: "link",
          href: source.slice(labelClose + 2, urlClose).trim(),
          children: parseInline(source.slice(cursor + 1, labelClose))
        });
        cursor = urlClose + 1;
        continue;
      }
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      const mark = rest.slice(0, 2);
      const close = source.indexOf(mark, cursor + 2);
      if (close > cursor + 1) {
        nodes.push({
          type: "strong",
          children: parseInline(source.slice(cursor + 2, close))
        });
        cursor = close + 2;
        continue;
      }
    }
    if (rest.startsWith("*") || rest.startsWith("_")) {
      const mark = rest[0] ?? "";
      const close = source.indexOf(mark, cursor + 1);
      if (close > cursor) {
        nodes.push({
          type: "em",
          children: parseInline(source.slice(cursor + 1, close))
        });
        cursor = close + 1;
        continue;
      }
    }
    pushText(source[cursor] ?? "");
    cursor += 1;
  }
  return nodes;
};

export const tokenizeMarkdown = (source: string): readonly MdBlock[] => {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let index = 0;
  const flushParagraph = (buffer: string[]): void => {
    const text = buffer.join("\n").trim();
    buffer.length = 0;
    if (text.length > 0) {
      blocks.push({ type: "p", children: parseInline(text) });
    }
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && FENCE.test(lines[index] ?? "") === false) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "pre", value: body.join("\n") });
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const type = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      blocks.push({ type, children: parseInline((heading[2] ?? "").trim()) });
      index += 1;
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      const quoted: string[] = [quote[1] ?? ""];
      index += 1;
      while (index < lines.length) {
        const next = QUOTE.exec(lines[index] ?? "");
        if (next === null) {
          break;
        }
        quoted.push(next[1] ?? "");
        index += 1;
      }
      blocks.push({ type: "blockquote", children: parseInline(quoted.join("\n").trim()) });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      const items = [parseInline(bullet[1] ?? "")];
      index += 1;
      while (index < lines.length) {
        const next = BULLET.exec(lines[index] ?? "");
        if (next === null) {
          break;
        }
        items.push(parseInline(next[1] ?? ""));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const ordered = ORDERED.exec(line);
    if (ordered) {
      const items = [parseInline(ordered[1] ?? "")];
      index += 1;
      while (index < lines.length) {
        const next = ORDERED.exec(lines[index] ?? "");
        if (next === null) {
          break;
        }
        items.push(parseInline(next[1] ?? ""));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (
        next.trim().length === 0
        || FENCE.test(next)
        || HR.test(next)
        || HEADING.test(next)
        || QUOTE.test(next)
        || BULLET.test(next)
        || ORDERED.test(next)
      ) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    flushParagraph(paragraph);
  }
  return blocks;
};

const InlineNodes = ({
  nodes,
  onOpenLink
}: {
  readonly nodes: readonly MdInline[];
  readonly onOpenLink: (url: string) => void;
}): ReactNode => (
  <>
    {nodes.map((node, index) => {
      if (node.type === "text") {
        return <Fragment key={index}>{node.value}</Fragment>;
      }
      if (node.type === "code") {
        return <code key={index}>{node.value}</code>;
      }
      if (node.type === "strong") {
        return (
          <strong key={index}>
            <InlineNodes nodes={node.children} onOpenLink={onOpenLink} />
          </strong>
        );
      }
      if (node.type === "em") {
        return (
          <em key={index}>
            <InlineNodes nodes={node.children} onOpenLink={onOpenLink} />
          </em>
        );
      }
      if (node.type === "image") {
        if (isPublicHttpsUrl(node.href) === false) {
          return null;
        }
        return <img key={index} src={node.href} alt={node.alt} />;
      }
      if (node.type !== "link") {
        return null;
      }
      const safe = isPublicHttpsUrl(node.href);
      return (
        <a
          key={index}
          href={safe ? node.href : undefined}
          rel="noreferrer"
          onClick={(event) => {
            event.preventDefault();
            if (safe) {
              onOpenLink(node.href);
            }
          }}
        >
          <InlineNodes nodes={node.children} onOpenLink={onOpenLink} />
        </a>
      );
    })}
  </>
);

export const NotificationMarkdownBody = ({
  content,
  onOpenLink
}: {
  readonly content: string;
  readonly onOpenLink: (url: string) => void;
}): ReactNode => (
  <div className="lyra-agents-rich-text lyra-notification-center-markdown">
    {tokenizeMarkdown(content).map((block, index) => {
      if (block.type === "hr") {
        return <hr key={index} />;
      }
      if (block.type === "pre") {
        return <pre key={index}>{block.value}</pre>;
      }
      if (block.type === "ul" || block.type === "ol") {
        const List = block.type;
        return (
          <List key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <InlineNodes nodes={item} onOpenLink={onOpenLink} />
              </li>
            ))}
          </List>
        );
      }
      if (block.type === "p" || block.type === "h1" || block.type === "h2" || block.type === "h3" || block.type === "blockquote") {
        const Tag = block.type;
        return (
          <Tag key={index}>
            <InlineNodes nodes={block.children} onOpenLink={onOpenLink} />
          </Tag>
        );
      }
      return null;
    })}
  </div>
);
