import type {
  AgentPageCitation,
  AgentTranscriptCitation,
  AgentTranscriptCitationExcerptKind
} from "../../../../../../shared/agent";
import { formatMessage, t } from "../../core/i18n";
import type { ChatMessage } from "../../core/types";
import type { ComposerImageSegment } from "./composer-image";
import { imageAttachmentMarker, orphanInlineImageAttachment } from "./composer-image";
import type { AgentFileAttachment, ComposerFileSegment } from "./composer-file";
import { fileAttachmentMarker } from "./composer-file";
import { pageCitationMarker, type ComposerPageCitationSegment } from "./page-citation";
import type { AgentImageAttachment } from "../../core/types";

export type { ComposerImageSegment } from "./composer-image";

export type ComposerInsertableCitation =
  | { readonly kind: "transcript"; readonly citation: AgentTranscriptCitation }
  | { readonly kind: "page"; readonly citation: AgentPageCitation };

export const TRANSCRIPT_CITATION_PREVIEW_CHARS = 32;
export const TRANSCRIPT_CITATION_QUOTED_CHARS = 480;
export const TRANSCRIPT_CITE_MARKER_PATTERN = /⟦cite:([^⟧]+)⟧/g;

export type TruncatedQuote = {
  readonly quotedText: string;
  readonly truncated: boolean;
  readonly preview: string;
};

const citationId = (): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `cite-${randomId}`;
};

export const truncateQuotedText = (text: string): TruncatedQuote => {
  const trimmed = text.trim();
  const chars = Array.from(trimmed);
  const truncated = chars.length > TRANSCRIPT_CITATION_QUOTED_CHARS;
  const quotedText = chars.slice(0, TRANSCRIPT_CITATION_QUOTED_CHARS).join("");
  const previewChars = chars.slice(0, TRANSCRIPT_CITATION_PREVIEW_CHARS).join("");
  const preview = chars.length > TRANSCRIPT_CITATION_PREVIEW_CHARS
    ? `${previewChars}…`
    : previewChars;
  return { quotedText, truncated, preview };
};

const textBlocksForMessage = (
  message: ChatMessage
): readonly { readonly id: string; readonly body: string }[] =>
  message.blocks
    .filter((block): block is { type: "text"; id: string; body: string } => block.type === "text")
    .map((block) => ({ id: block.id, body: block.body }));

export const messagePlainText = (message: ChatMessage): string =>
  textBlocksForMessage(message)
    .map((block) => block.body)
    .join("\n\n")
    .trim();

const imageCitationPreview = (message: ChatMessage): string => {
  const imageBlock = message.blocks.find((block) => block.type === "image");
  if (imageBlock?.type !== "image") {
    return t("lyra-agents-message.imageAttachment");
  }
  const label = imageBlock.image.label?.trim();
  return label !== undefined && label.length > 0
    ? label
    : t("lyra-agents-message.imageAttachment");
};

export const citationQuoteForMessage = (message: ChatMessage): TruncatedQuote => {
  const text = messagePlainText(message);
  if (text.length > 0) {
    return truncateQuotedText(text);
  }
  if (message.blocks.some((block) => block.type === "image")) {
    const preview = imageCitationPreview(message);
    return { quotedText: preview, truncated: false, preview };
  }
  const toolLabel = message.blocks.find((block) => block.type === "tools")?.group.label?.trim();
  const fallback = toolLabel !== undefined && toolLabel.length > 0 ? toolLabel : "…";
  return { quotedText: fallback, truncated: false, preview: fallback };
};

export const buildFullMessageCitation = (message: ChatMessage): AgentTranscriptCitation => {
  const text = messagePlainText(message);
  const { quotedText, truncated, preview } = citationQuoteForMessage(message);
  const firstBlock = textBlocksForMessage(message)[0];
  return {
    id: citationId(),
    messageId: message.id,
    role: message.author === "user" ? "user" : "assistant",
    blockId: firstBlock?.id ?? null,
    startOffset: 0,
    endOffset: Array.from(text).length,
    excerptKind: "full_message",
    preview,
    quotedText,
    truncated,
    sourceCreatedAt: message.time ?? null
  };
};

const blockElementForNode = (
  node: Node | null,
  root: HTMLElement
): { blockId: string; blockText: string } | null => {
  let current: Node | null = node;
  while (current !== null && current !== root) {
    if (current instanceof HTMLElement && current.dataset.messageBlockId !== undefined) {
      const blockId = current.dataset.messageBlockId;
      const blockText = current.textContent ?? "";
      if (blockId.length > 0) {
        return { blockId, blockText };
      }
    }
    current = current.parentNode;
  }
  return null;
};

export const resolveSelectionCitation = (
  message: ChatMessage,
  selectionText: string,
  range: Range,
  messageRoot: HTMLElement
): AgentTranscriptCitation | null => {
  const trimmed = selectionText.trim();
  if (trimmed.length === 0) return null;
  const startBlock = blockElementForNode(range.startContainer, messageRoot);
  const endBlock = blockElementForNode(range.endContainer, messageRoot);
  if (startBlock === null || endBlock === null || startBlock.blockId !== endBlock.blockId) {
    return null;
  }
  const preRange = document.createRange();
  preRange.selectNodeContents(messageRoot.querySelector(`[data-message-block-id="${startBlock.blockId}"]`) ?? messageRoot);
  preRange.setEnd(range.startContainer, range.startOffset);
  const startOffset = preRange.toString().length;
  const endOffset = startOffset + range.toString().length;
  const { quotedText, truncated, preview } = truncateQuotedText(trimmed);
  return {
    id: citationId(),
    messageId: message.id,
    role: message.author === "user" ? "user" : "assistant",
    blockId: startBlock.blockId,
    startOffset,
    endOffset,
    excerptKind: "selection",
    preview,
    quotedText,
    truncated,
    sourceCreatedAt: message.time ?? null
  };
};

export type ComposerCitationSegment = {
  readonly type: "citation";
  readonly citation: AgentTranscriptCitation;
};

export type ComposerTextSegment = {
  readonly type: "text";
  readonly value: string;
};

export type ComposerSegment =
  | ComposerTextSegment
  | ComposerCitationSegment
  | ComposerPageCitationSegment
  | ComposerImageSegment
  | ComposerFileSegment;

export const segmentsToPlainText = (segments: readonly ComposerSegment[]): string =>
  segments
    .map((segment) => {
      if (segment.type === "text") return segment.value;
      if (segment.type === "image") return imageAttachmentMarker(segment.image.id);
      if (segment.type === "file") return fileAttachmentMarker(segment.file.id);
      if (segment.type === "pageCitation") return pageCitationMarker(segment.citation.id);
      return `⟦cite:${segment.citation.id}⟧`;
    })
    .join("");

export const segmentsToCitations = (
  segments: readonly ComposerSegment[]
): readonly AgentTranscriptCitation[] =>
  segments
    .filter((segment): segment is ComposerCitationSegment => segment.type === "citation")
    .map((segment) => segment.citation);

export const hasComposerContent = (segments: readonly ComposerSegment[]): boolean =>
  segments.some((segment) =>
    segment.type === "citation"
    || segment.type === "pageCitation"
    || segment.type === "image"
    || segment.type === "file"
      ? true
      : segment.value.trim().length > 0
  );

const INLINE_CONTENT_MARKER_PATTERN = /⟦(?:page-)?cite:([^⟧]+)⟧|⟦image:([^⟧]+)⟧|⟦file:([^⟧]+)⟧/g;

export type RenderedCitationSegment =
  | { readonly type: "transcript"; readonly citation: AgentTranscriptCitation }
  | { readonly type: "page"; readonly citation: AgentPageCitation }
  | { readonly type: "image"; readonly image: AgentImageAttachment }
  | { readonly type: "file"; readonly file: AgentFileAttachment };

export const textHasInlineContentMarkers = (text: string): boolean =>
  textHasCitationMarkers(text)
  || /⟦page-cite:/.test(text)
  || /⟦image:/.test(text)
  || /⟦file:/.test(text);

export const parseRenderedCitationSegments = (
  text: string,
  transcriptCitations: readonly AgentTranscriptCitation[],
  pageCitations: readonly AgentPageCitation[],
  inlineImages: readonly AgentImageAttachment[] = [],
  fileAttachments: readonly AgentFileAttachment[] = []
): readonly (ComposerTextSegment | RenderedCitationSegment)[] => {
  if (!textHasInlineContentMarkers(text)) {
    return [{ type: "text", value: text }];
  }
  const transcriptById = new Map(transcriptCitations.map((citation) => [citation.id, citation] as const));
  const pageById = new Map(pageCitations.map((citation) => [citation.id, citation] as const));
  const imageById = new Map(inlineImages.map((image) => [image.id, image] as const));
  const fileById = new Map(fileAttachments.map((file) => [file.id, file] as const));
  const segments: Array<ComposerTextSegment | RenderedCitationSegment> = [];
  const marker = new RegExp(
    INLINE_CONTENT_MARKER_PATTERN.source,
    INLINE_CONTENT_MARKER_PATTERN.flags
  );
  let lastIndex = 0;
  for (const match of text.matchAll(marker)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, index) });
    }
    const markerText = match[0] ?? "";
    const citationId = match[1] ?? "";
    const imageId = match[2] ?? "";
    const fileId = match[3] ?? "";
    if (markerText.startsWith("⟦image:")) {
      const image = imageById.get(imageId) ?? orphanInlineImageAttachment(imageId);
      segments.push({ type: "image", image });
    } else if (markerText.startsWith("⟦file:")) {
      const file = fileById.get(fileId);
      if (file !== undefined) {
        segments.push({ type: "file", file });
      } else {
        segments.push({ type: "text", value: markerText });
      }
    } else if (markerText.startsWith("⟦page-cite:")) {
      const citation = pageById.get(citationId);
      if (citation !== undefined) {
        segments.push({ type: "page", citation });
      } else {
        segments.push({ type: "text", value: markerText });
      }
    } else {
      const citation = transcriptById.get(citationId);
      if (citation !== undefined) {
        segments.push({ type: "transcript", citation });
      } else {
        segments.push({ type: "text", value: markerText });
      }
    }
    lastIndex = index + markerText.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: text }];
};

const nullableString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const nullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const excerptKindForValue = (value: unknown): AgentTranscriptCitationExcerptKind =>
  value === "full_message" ? "full_message" : "selection";

export const normalizeTranscriptCitation = (raw: unknown): AgentTranscriptCitation | null => {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const messageId = nullableString(value.messageId);
  if (messageId === null) return null;
  const id = nullableString(value.id) ?? `cite-${messageId}`;
  const role = value.role === "user" ? "user" : "assistant";
  const previewRaw = nullableString(value.preview);
  const quotedRaw = nullableString(value.quotedText) ?? "";
  const quote = quotedRaw.length > 0 ? truncateQuotedText(quotedRaw) : null;
  const preview = previewRaw ?? quote?.preview ?? "…";
  const quotedText = quote?.quotedText ?? quotedRaw;
  const truncated = typeof value.truncated === "boolean" ? value.truncated : (quote?.truncated ?? false);
  return {
    id,
    messageId,
    role,
    blockId: nullableString(value.blockId),
    startOffset: nullableNumber(value.startOffset),
    endOffset: nullableNumber(value.endOffset),
    excerptKind: excerptKindForValue(value.excerptKind),
    preview,
    quotedText,
    truncated,
    sourceCreatedAt: nullableString(value.sourceCreatedAt)
  };
};

export const parseTranscriptCitationsFromMetadata = (
  metadata: unknown
): readonly AgentTranscriptCitation[] => {
  if (metadata === null || typeof metadata !== "object") return [];
  const raw = (metadata as Record<string, unknown>).transcriptCitations;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizeTranscriptCitation(entry))
    .filter((entry): entry is AgentTranscriptCitation => entry !== null);
};

export const textHasCitationMarkers = (text: string): boolean =>
  /⟦cite:([^⟧]+)⟧/.test(text);

export const parseTextWithCitationMarkers = (
  text: string,
  citations: readonly AgentTranscriptCitation[]
): readonly ComposerSegment[] => {
  if (!textHasCitationMarkers(text)) {
    return [{ type: "text", value: text }];
  }
  const byId = new Map(citations.map((citation) => [citation.id, citation] as const));
  const segments: ComposerSegment[] = [];
  const marker = new RegExp(TRANSCRIPT_CITE_MARKER_PATTERN.source, TRANSCRIPT_CITE_MARKER_PATTERN.flags);
  let lastIndex = 0;
  for (const match of text.matchAll(marker)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, index) });
    }
    const citationId = match[1] ?? "";
    const citation = byId.get(citationId);
    if (citation !== undefined) {
      segments.push({ type: "citation", citation });
    } else {
      segments.push({ type: "text", value: match[0] });
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: text }];
};

export const citationChipAriaLabel = (citation: AgentTranscriptCitation): string =>
  formatMessage("lyra-agents-citation.chipLabel", {
    role: citation.role === "user" ? t("lyra-agents-citation.roleUser") : t("lyra-agents-citation.roleAgent"),
    preview: citation.preview
  });

export const pageCitationChipAriaLabel = (citation: AgentPageCitation): string =>
  formatMessage("lyra-agents-page-citation.chipLabel", {
    tab: citation.tabTitle,
    preview: citation.preview
  });