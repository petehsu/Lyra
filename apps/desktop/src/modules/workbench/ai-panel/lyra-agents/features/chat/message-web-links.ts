import type { AgentMessageWebLink } from "../../../../../../shared/agent";
import { segmentsToPlainText, type ComposerSegment } from "./message-citation";
import { parseComposerHttpUrl } from "./web-link-display";

export const composerWebLinks = (
  segments: readonly ComposerSegment[],
  submittedText: string
): AgentMessageWebLink[] => {
  const raw = segmentsToPlainText(segments);
  if (raw.trim() !== submittedText) return [];
  let offset = raw.trimStart().length - raw.length;
  return segments.flatMap((segment) => {
    const start = offset;
    offset += segmentsToPlainText([segment]).length;
    return segment.type === "link" ? [{ start, end: offset, url: segment.url }] : [];
  });
};

export const messageWebLinksFromMetadata = (metadata: unknown): AgentMessageWebLink[] => {
  if (metadata === null || typeof metadata !== "object") return [];
  const links = (metadata as Record<string, unknown>).webLinks;
  if (!Array.isArray(links)) return [];
  return links.filter((link): link is AgentMessageWebLink =>
    link !== null && typeof link === "object"
    && Number.isInteger(link.start) && link.start >= 0
    && Number.isInteger(link.end) && link.end > link.start
    && typeof link.url === "string" && parseComposerHttpUrl(link.url) === link.url
  );
};

type WebTextPart = { type: "text"; value: string } | { type: "link"; url: string };

// Legacy messages have no token boundaries. Use conservative prose autolinking;
// explicitly pasted links retain exact boundaries, including Unicode URLs.
const autoLinks = (text: string): AgentMessageWebLink[] => {
  const matches = text.matchAll(/https?:\/\/[^\s<>"`⟦⟧\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？；：、（）【】「」『』]+/giu);
  return [...matches].flatMap((match) => {
    let url = match[0].replace(/[.,!?;:]+$/u, "");
    for (const [open, close] of [["(", ")"], ["[", "]"]] as const) {
      while (url.endsWith(close) && url.split(close).length > url.split(open).length) {
        url = url.slice(0, -1);
      }
    }
    return parseComposerHttpUrl(url) === null
      ? []
      : [{ start: match.index, end: match.index + url.length, url }];
  });
};

export const splitMessageWebLinks = (
  text: string,
  knownLinks: readonly AgentMessageWebLink[] = []
): WebTextPart[] => {
  const parts: WebTextPart[] = [];
  const pushAutoText = (value: string) => {
    let cursor = 0;
    for (const link of autoLinks(value)) {
      if (link.start > cursor) parts.push({ type: "text", value: value.slice(cursor, link.start) });
      parts.push({ type: "link", url: link.url });
      cursor = link.end;
    }
    if (cursor < value.length) parts.push({ type: "text", value: value.slice(cursor) });
  };
  let cursor = 0;
  for (const link of [...knownLinks].sort((a, b) => a.start - b.start)) {
    if (link.start < cursor || text.slice(link.start, link.end) !== link.url
      || parseComposerHttpUrl(link.url) !== link.url) continue;
    pushAutoText(text.slice(cursor, link.start));
    parts.push({ type: "link", url: link.url });
    cursor = link.end;
  }
  pushAutoText(text.slice(cursor));
  return parts;
};
