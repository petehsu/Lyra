import { formatMessage, t } from "../../core/i18n";
import { resolveElectronFilePath } from "./electron-file-path";
import { isAttachableImageFile } from "./image-drop";
import { TRANSCRIPT_CITATION_PREVIEW_CHARS, truncateQuotedText } from "./message-citation";

export type AgentFileAttachment = {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly preview: string;
};

const fileAttachmentId = (): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `file-${randomId}`;
};

const fileNameFromPath = (filePath: string): string => {
  const normalized = filePath.trim().replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
};

export const buildFileAttachmentFromPath = (filePath: string): AgentFileAttachment | null => {
  const path = filePath.trim();
  if (path.length === 0) {
    return null;
  }
  const name = fileNameFromPath(path);
  const { preview } = truncateQuotedText(name);
  return {
    id: fileAttachmentId(),
    path,
    name,
    preview
  };
};

export const readFileAttachmentsFromDataTransfer = (
  dataTransfer: DataTransfer
): readonly AgentFileAttachment[] => {
  const attachments: AgentFileAttachment[] = [];
  const seen = new Set<string>();

  for (const file of Array.from(dataTransfer.files)) {
    if (isAttachableImageFile(file)) {
      continue;
    }
    const path = resolveElectronFilePath(file);
    if (path === null) {
      continue;
    }
    if (seen.has(path)) {
      continue;
    }
    const attachment = buildFileAttachmentFromPath(path);
    if (attachment === null) {
      continue;
    }
    seen.add(path);
    attachments.push(attachment);
  }

  return attachments;
};

export type ComposerFileSegment = {
  readonly type: "file";
  readonly file: AgentFileAttachment;
};

export const FILE_ATTACHMENT_MARKER_PATTERN = /⟦file:([^⟧]+)⟧/g;

export const fileAttachmentMarker = (attachmentId: string): string => `⟦file:${attachmentId}⟧`;

export const textHasFileAttachmentMarkers = (text: string): boolean =>
  /⟦file:([^⟧]+)⟧/.test(text);

export const segmentsToFileAttachments = (
  segments: readonly { readonly type: string }[]
): readonly AgentFileAttachment[] =>
  segments
    .filter((segment): segment is ComposerFileSegment => segment.type === "file")
    .map((segment) => segment.file);

export const fileAttachmentChipAriaLabel = (file: AgentFileAttachment): string =>
  formatMessage("lyra-agents-composer.fileChip", { preview: file.preview });

export const normalizeFileAttachment = (raw: unknown): AgentFileAttachment | null => {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const path = typeof value.path === "string" && value.path.length > 0 ? value.path : null;
  if (path === null) return null;
  const id = typeof value.id === "string" && value.id.length > 0 ? value.id : `file-${path}`;
  const name = typeof value.name === "string" && value.name.length > 0
    ? value.name
    : fileNameFromPath(path);
  const previewRaw = typeof value.preview === "string" ? value.preview : null;
  const preview = previewRaw ?? truncateQuotedText(name).preview;
  return { id, path, name, preview };
};

export const parseFileAttachmentsFromMetadata = (
  metadata: unknown
): readonly AgentFileAttachment[] => {
  if (metadata === null || typeof metadata !== "object") return [];
  const raw = (metadata as Record<string, unknown>).fileAttachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizeFileAttachment(entry))
    .filter((entry): entry is AgentFileAttachment => entry !== null);
};