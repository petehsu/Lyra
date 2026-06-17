import type { AgentImageAttachment } from "../../core/types";

const IMAGE_ATTACHMENT_ID_PREFIX = "local-image";

const PLACEHOLDER_IMAGE_SOURCES = new Set([
  "local-file",
  "browser-screenshot",
  "workspace-screenshot",
  "window-screenshot",
  "inline-data-url",
  "screenshot-drop"
]);

const attachmentId = (): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${IMAGE_ATTACHMENT_ID_PREFIX}-${randomId}`;
};

export const mediaTypeFromPath = (filePath: string): string => {
  const extension = filePath.trim().split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return "image/png";
  }
};

export const fileNameFromPath = (filePath: string): string => {
  const normalized = filePath.trim().replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
};

export const isOpenableImageSource = (source: string | null | undefined): source is string => {
  const trimmed = source?.trim() ?? "";
  if (trimmed.length === 0 || PLACEHOLDER_IMAGE_SOURCES.has(trimmed)) {
    return false;
  }
  return /^(?:\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/]|file:\/\/|(?:apps|crates|web|scripts|packages|vendor|docs|target|参考)\/)/u
    .test(trimmed);
};

const lyraFilePreviewUrl = (filePath: string, mediaType: string): string =>
  `lyra-file://preview?path=${encodeURIComponent(filePath)}&contentType=${encodeURIComponent(mediaType)}`;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

export const imageAttachmentMetadataFromPath = (
  filePath: string,
  overrides?: Partial<Pick<AgentImageAttachment, "id" | "label">>
): AgentImageAttachment => {
  const normalizedPath = filePath.trim();
  return {
    id: overrides?.id ?? attachmentId(),
    mediaType: mediaTypeFromPath(normalizedPath),
    data: "",
    label: overrides?.label ?? fileNameFromPath(normalizedPath),
    source: normalizedPath
  };
};

export const readImageAttachmentFromPath = async (
  filePath: string
): Promise<AgentImageAttachment | null> => {
  const normalizedPath = filePath.trim();
  if (normalizedPath.length === 0) {
    return null;
  }
  const mediaType = mediaTypeFromPath(normalizedPath);
  let response: Response;
  try {
    response = await fetch(lyraFilePreviewUrl(normalizedPath, mediaType));
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  const data = arrayBufferToBase64(await response.arrayBuffer());
  if (data.length === 0) {
    return null;
  }
  return {
    id: attachmentId(),
    mediaType,
    data,
    label: fileNameFromPath(normalizedPath),
    source: normalizedPath
  };
};