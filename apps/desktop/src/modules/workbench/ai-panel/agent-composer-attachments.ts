import {
  hasFileManagerEntryDragPayload,
  readFileManagerEntryDragPayload
} from "../file-manager/drag-transfer";
import type {
  AgentComposerContentPart,
  AgentComposerFileAttachment,
  AgentComposerInlineAttachment,
} from "./agent-composer-types";

export type FileWithPath = File & {
  readonly path?: unknown;
};


export const attachmentKey = (attachment: AgentComposerFileAttachment): string =>
  `${attachment.kind}:${attachment.path}`;

export const submitAttachment = (
  attachment: AgentComposerInlineAttachment
): AgentComposerFileAttachment => ({
  id: attachment.id,
  name: attachment.name,
  path: attachment.path,
  kind: attachment.kind,
  source: attachment.source,
  ...(attachment.contextText === undefined ? {} : { contextText: attachment.contextText }),
});

export const trimNonEmpty = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export const fileNameFromPath = (path: string): string => {
  if (/^data:image\//iu.test(path)) {
    return "image";
  }
  const normalized = path.replace(/\\/gu, "/");
  const last = normalized.split("/").filter(Boolean).pop();
  return last === undefined || last.trim().length === 0 ? path : last;
};

export const IMAGE_FILE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif)$/iu;

export const isLocalImagePath = (path: string): boolean =>
  IMAGE_FILE_EXTENSION_PATTERN.test(path.split(/[?#]/u)[0] ?? path);

export const isRemoteImageReference = (value: string): boolean => {
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/iu.test(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && isLocalImagePath(url.pathname);
  } catch (_error) {
    return false;
  }
};

export const attachmentKindForPath = (
  path: string,
  kind: AgentComposerFileAttachment["kind"]
): AgentComposerFileAttachment["kind"] => {
  if (kind === "directory" || kind === "image" || kind === "local_image") {
    return kind;
  }
  if (kind === "workbench_tab" || kind === "ai_thread") {
    return kind;
  }
  if (isRemoteImageReference(path)) {
    return "image";
  }
  return isLocalImagePath(path) ? "local_image" : "file";
};

export const stripWrappingQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

export const fileUrlToPath = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") {
      return null;
    }
    const decoded = decodeURIComponent(url.pathname);
    return decoded.match(/^\/[a-z]:\//iu) !== null ? decoded.slice(1) : decoded;
  } catch (_error) {
    return null;
  }
};

export const isLikelyAbsolutePath = (value: string): boolean => {
  if (value.length <= 1) {
    return false;
  }
  return (
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    /^[a-z]:[\\/]/iu.test(value)
  );
};

export const createFileAttachment = ({
  name,
  path,
  kind,
  source,
  contextText
}: Omit<AgentComposerFileAttachment, "id">): AgentComposerFileAttachment => {
  const normalizedPath = path.trim();
  const normalizedName = name.trim().length > 0 ? name.trim() : fileNameFromPath(normalizedPath);
  const normalizedKind = attachmentKindForPath(normalizedPath, kind);
  const normalizedContextText = contextText?.trim();
  return {
    id: `${source}:${normalizedKind}:${normalizedPath}`,
    name: normalizedName,
    path: normalizedPath,
    kind: normalizedKind,
    source,
    ...(normalizedContextText === undefined || normalizedContextText.length === 0
      ? {}
      : { contextText: normalizedContextText })
  };
};

export const sanitizeAttachmentPlaceholderLabel = (name: string): string =>
  name.replace(/[\r\n[\]]/gu, " ").replace(/\s+/gu, " ").trim() || "file";

export const createAttachmentPlaceholder = (
  attachment: Pick<AgentComposerFileAttachment, "name" | "kind">,
  usedPlaceholders: ReadonlySet<string>
): string => {
  const base = sanitizeAttachmentPlaceholderLabel(attachment.name);
  const placeholderKind = attachment.kind === "directory" ? "directory"
    : attachment.kind === "local_image" ? "local_image"
      : attachment.kind === "image" ? "image"
        : attachment.kind === "workbench_tab" ? "workbench_tab"
          : attachment.kind === "ai_thread" ? "ai_thread"
            : "file";
  let index = 1;
  let candidate = `[[${placeholderKind}:${base}]]`;
  while (usedPlaceholders.has(candidate)) {
    index += 1;
    candidate = `[[${placeholderKind}:${base} ${String(index)}]]`;
  }
  return candidate;
};

export const normalizeInlineAttachment = (
  attachment: AgentComposerFileAttachment,
  usedPlaceholders: ReadonlySet<string>
): AgentComposerInlineAttachment => ({
  ...attachment,
  placeholder: createAttachmentPlaceholder(attachment, usedPlaceholders),
});

export const trimSubmitParts = (
  parts: readonly AgentComposerContentPart[]
): readonly AgentComposerContentPart[] => {
  const mutable = [...parts];
  while (mutable.length > 0) {
    const first = mutable[0];
    if (first?.type !== "text") {
      break;
    }
    const trimmed = first.text.replace(/^\s+/u, "");
    if (trimmed.length > 0) {
      mutable[0] = { type: "text", text: trimmed };
      break;
    }
    mutable.shift();
  }
  while (mutable.length > 0) {
    const last = mutable[mutable.length - 1];
    if (last?.type !== "text") {
      break;
    }
    const trimmed = last.text.replace(/\s+$/u, "");
    if (trimmed.length > 0) {
      mutable[mutable.length - 1] = { type: "text", text: trimmed };
      break;
    }
    mutable.pop();
  }
  return mutable;
};

export const buildContentParts = (
  value: string,
  attachments: readonly AgentComposerInlineAttachment[]
): readonly AgentComposerContentPart[] => {
  if (attachments.length === 0) {
    return value.length === 0 ? [] : [{ type: "text", text: value }];
  }
  const positions = attachments
    .map((attachment) => ({
      attachment,
      index: value.indexOf(attachment.placeholder),
    }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index);
  const parts: AgentComposerContentPart[] = [];
  let offset = 0;
  for (const { attachment, index } of positions) {
    if (index < offset) {
      continue;
    }
    const before = value.slice(offset, index);
    if (before.length > 0) {
      parts.push({ type: "text", text: before });
    }
    parts.push({ type: "attachment", attachment: submitAttachment(attachment) });
    offset = index + attachment.placeholder.length;
  }
  const tail = value.slice(offset);
  if (tail.length > 0) {
    parts.push({ type: "text", text: tail });
  }
  return parts;
};

export const stripAttachmentPlaceholders = (
  value: string,
  attachments: readonly AgentComposerInlineAttachment[]
): string => buildContentParts(value, attachments)
  .map((part) => part.type === "text" ? part.text : "")
  .join("");

export type AttachmentTextRange = {
  readonly attachment: AgentComposerInlineAttachment;
  readonly start: number;
  readonly end: number;
};

export const attachmentTextRanges = (
  value: string,
  attachments: readonly AgentComposerInlineAttachment[]
): readonly AttachmentTextRange[] =>
  attachments
    .map((attachment) => {
      const start = value.indexOf(attachment.placeholder);
      return start < 0
        ? null
        : {
            attachment,
            start,
            end: start + attachment.placeholder.length,
          };
    })
    .filter((range): range is AttachmentTextRange => range !== null)
    .sort((left, right) => left.start - right.start);

export const rangeInsideCaret = (
  ranges: readonly AttachmentTextRange[],
  position: number
): AttachmentTextRange | null =>
  ranges.find((range) => position > range.start && position < range.end) ?? null;

export const rangeForBackspace = (
  ranges: readonly AttachmentTextRange[],
  position: number
): AttachmentTextRange | null =>
  ranges.find((range) => position > range.start && position <= range.end) ?? null;

export const rangeForDelete = (
  ranges: readonly AttachmentTextRange[],
  position: number
): AttachmentTextRange | null =>
  ranges.find((range) => position >= range.start && position < range.end) ?? null;

export const snapCollapsedSelection = (
  range: AttachmentTextRange,
  position: number
): number => {
  const midpoint = range.start + Math.floor((range.end - range.start) / 2);
  return position <= midpoint ? range.start : range.end;
};

export const snapSelectionIndex = (
  ranges: readonly AttachmentTextRange[],
  position: number,
  direction: "start" | "end"
): number => {
  const range = rangeInsideCaret(ranges, position);
  if (range === null) {
    return position;
  }
  return direction === "start" ? range.start : range.end;
};


export const attachmentsFromFiles = (
  files: FileList | readonly File[],
  source: AgentComposerFileAttachment["source"]
): readonly AgentComposerFileAttachment[] =>
  Array.from(files)
    .map((file) => {
      const path = trimNonEmpty((file as FileWithPath).path);
      if (path === null) {
        return null;
      }
      return createFileAttachment({
        name: file.name,
        path,
        kind: typeof file.type === "string" && file.type.startsWith("image/")
          ? "local_image"
          : "file",
        source
      });
    })
    .filter((attachment): attachment is AgentComposerFileAttachment => attachment !== null);

export const fileToDataUrl = (file: File): Promise<string | null> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => {
      resolve(null);
    };
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
  });

export const imageAttachmentsFromClipboardFiles = async (
  files: readonly File[]
): Promise<readonly AgentComposerFileAttachment[]> => {
  const attachments: AgentComposerFileAttachment[] = [];
  for (const file of files) {
    if (typeof file.type !== "string" || !file.type.startsWith("image/")) {
      continue;
    }
    const dataUrl = await fileToDataUrl(file);
    if (dataUrl === null) {
      continue;
    }
    attachments.push(createFileAttachment({
      name: file.name.trim().length > 0 ? file.name : "pasted-image",
      path: dataUrl,
      kind: "image",
      source: "clipboard",
    }));
  }
  return attachments;
};

export const attachmentsFromPaths = (
  paths: readonly string[],
  source: AgentComposerFileAttachment["source"]
): readonly AgentComposerFileAttachment[] =>
  paths
    .map((rawPath) => stripWrappingQuotes(rawPath))
    .filter((path) => isLikelyAbsolutePath(path))
    .map((path) => createFileAttachment({
      name: fileNameFromPath(path),
      path,
      kind: "file",
      source
    }));

export const attachmentsFromImageReferences = (
  values: readonly string[],
  source: AgentComposerFileAttachment["source"]
): readonly AgentComposerFileAttachment[] =>
  values
    .map(stripWrappingQuotes)
    .filter((value) => isRemoteImageReference(value))
    .map((value) => createFileAttachment({
      name: fileNameFromPath(value),
      path: value,
      kind: "image",
      source
    }));

export const attachmentsFromUriList = (
  uriList: string,
  source: AgentComposerFileAttachment["source"]
): readonly AgentComposerFileAttachment[] => {
  const entries = uriList
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => fileUrlToPath(line) ?? stripWrappingQuotes(line));
  return [
    ...attachmentsFromPaths(entries, source),
    ...attachmentsFromImageReferences(entries, source),
  ];
};

export const attachmentsFromPlainPathText = (
  text: string,
  source: AgentComposerFileAttachment["source"]
): readonly AgentComposerFileAttachment[] => {
  const paths = text
    .split(/\r?\n/u)
    .map(stripWrappingQuotes)
    .filter((line) => line.length > 0);
  if (paths.length === 0 || paths.some((path) => !isLikelyAbsolutePath(path))) {
    return attachmentsFromImageReferences(paths, source);
  }
  return attachmentsFromPaths(paths, source);
};

export const hasNativeFiles = (dataTransfer: DataTransfer): boolean =>
  dataTransfer.files.length > 0 ||
  Array.from(dataTransfer.types).includes("Files") ||
  Array.from(dataTransfer.types).includes("text/uri-list");

export const hasAttachmentDataTransfer = (dataTransfer: DataTransfer): boolean =>
  hasFileManagerEntryDragPayload(dataTransfer) || hasNativeFiles(dataTransfer);

export const attachmentsFromDrop = (
  dataTransfer: DataTransfer
): readonly AgentComposerFileAttachment[] => {
  const fileManagerPayload = readFileManagerEntryDragPayload(dataTransfer);
  const fileManagerPath = trimNonEmpty(fileManagerPayload?.path);
  if (fileManagerPayload !== null && fileManagerPath !== null) {
    return [
      createFileAttachment({
        name: fileManagerPayload.name,
        path: fileManagerPath,
        kind: fileManagerPayload.kind,
        source: "lyra-file-manager"
      })
    ];
  }
  const files = attachmentsFromFiles(dataTransfer.files, "system-drag");
  if (files.length > 0) {
    return files;
  }
  return attachmentsFromUriList(dataTransfer.getData("text/uri-list"), "system-drag");
};

export const attachmentsFromPaste = async (
  dataTransfer: DataTransfer
): Promise<readonly AgentComposerFileAttachment[]> => {
  const clipboardFiles = Array.from(dataTransfer.files);
  const uriListText = dataTransfer.getData("text/uri-list");
  const plainText = dataTransfer.getData("text/plain");
  const files = attachmentsFromFiles(clipboardFiles, "clipboard");
  if (files.length > 0) {
    return files;
  }
  const imageFiles = await imageAttachmentsFromClipboardFiles(clipboardFiles);
  if (imageFiles.length > 0) {
    return imageFiles;
  }
  const uriList = attachmentsFromUriList(uriListText, "clipboard");
  if (uriList.length > 0) {
    return uriList;
  }
  return attachmentsFromPlainPathText(plainText, "clipboard");
};
