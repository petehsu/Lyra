import type { AgentImageAttachment } from "../../core/types";
import { resolveElectronFilePath } from "./electron-file-path";
import { imageAttachmentMetadataFromPath } from "./read-image-attachment";

const IMAGE_ATTACHMENT_ID_PREFIX = "dropped-image";
const IMAGE_MIME_PATTERN = /^image\/(?:png|jpe?g|webp|gif|bmp|avif|heic|heif|svg\+xml)$/i;

const attachmentId = (): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${IMAGE_ATTACHMENT_ID_PREFIX}-${randomId}`;
};

export const isAttachableImageFile = (file: File): boolean =>
  IMAGE_MIME_PATTERN.test(file.type)
  || /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|svg)$/i.test(file.name);

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const imageAttachmentFromFile = async (file: File): Promise<AgentImageAttachment | null> => {
  if (!isAttachableImageFile(file)) {
    return null;
  }
  const filePath = resolveElectronFilePath(file);
  if (filePath !== null) {
    return {
      ...imageAttachmentMetadataFromPath(filePath, { label: file.name }),
      id: attachmentId()
    };
  }
  const mediaType = file.type.length > 0 ? file.type : "image/png";
  const data = arrayBufferToBase64(await file.arrayBuffer());
  if (data.length === 0) {
    return null;
  }
  return {
    id: attachmentId(),
    mediaType,
    data,
    label: file.name,
    source: "screenshot-drop"
  };
};

const imageAttachmentFromBlob = async (
  blob: Blob,
  label = "Screenshot"
): Promise<AgentImageAttachment | null> => {
  if (!IMAGE_MIME_PATTERN.test(blob.type)) {
    return null;
  }
  const data = arrayBufferToBase64(await blob.arrayBuffer());
  if (data.length === 0) {
    return null;
  }
  return {
    id: attachmentId(),
    mediaType: blob.type,
    data,
    label,
    source: "screenshot-drop"
  };
};

const attachmentDedupeKey = (attachment: AgentImageAttachment): string =>
  attachment.source?.trim()
  || `${attachment.mediaType}:${(attachment.data ?? "").slice(0, 48)}`
  || attachment.id;

export const readImageAttachmentsFromDataTransfer = async (
  dataTransfer: DataTransfer
): Promise<readonly AgentImageAttachment[]> => {
  const attachments: AgentImageAttachment[] = [];
  const seen = new Set<string>();

  for (const file of Array.from(dataTransfer.files)) {
    const attachment = await imageAttachmentFromFile(file);
    if (attachment === null) {
      continue;
    }
    const key = attachmentDedupeKey(attachment);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    attachments.push(attachment);
  }

  if (attachments.length > 0) {
    return attachments;
  }

  for (const item of Array.from(dataTransfer.items)) {
    if (!item.type.startsWith("image/")) {
      continue;
    }
    const blob = item.getAsFile();
    if (blob === null) {
      continue;
    }
    const attachment = await imageAttachmentFromBlob(
      blob,
      blob instanceof File && blob.name.length > 0 ? blob.name : "Screenshot"
    );
    if (attachment === null) {
      continue;
    }
    const key = attachmentDedupeKey(attachment);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    attachments.push(attachment);
  }

  return attachments;
};

export const readImageAttachmentsFromClipboardData = async (
  clipboardData: DataTransfer
): Promise<readonly AgentImageAttachment[]> => readImageAttachmentsFromDataTransfer(clipboardData);

export const isLikelyScreenshotFilename = (fileName: string): boolean =>
  /^(screen(?: |-)?shot|screenshot|截屏|屏幕快照|屏幕截图)/i.test(fileName);