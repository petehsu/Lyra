import type {
  AgentImageAttachmentMaterializeRequest,
  AgentImageInput
} from "../../../../../../shared/agent";
import { formatMessage, t } from "@workbench/i18n";
import type { AgentImageAttachment } from "../../core/types";
import { TRANSCRIPT_CITATION_PREVIEW_CHARS } from "./message-citation";
import {
  fileNameFromPath,
  isOpenableImageSource,
  readImageAttachmentFromPath
} from "./read-image-attachment";

const MESSAGE_IMAGES_DIR_SEGMENT = "/message-images/";

export type MaterializeImageAttachment = (
  request: AgentImageAttachmentMaterializeRequest
) => Promise<{ readonly path: string }>;

export const hasMaterializableImageData = (image: AgentImageAttachment): boolean => {
  const mediaType = image.mediaType.trim().toLowerCase();
  if (!mediaType.startsWith("image/")) {
    return false;
  }
  const data = (image.data ?? "").replace(/\s+/gu, "");
  if (data.length === 0 || data.length % 4 === 1) {
    return false;
  }
  return /^[A-Za-z0-9+/_-]+={0,2}$/u.test(data);
};

export const isDurableMessageImagePath = (source: string | null | undefined): boolean =>
  source?.includes(MESSAGE_IMAGES_DIR_SEGMENT) ?? false;

export const materializeComposerImageIfNeeded = async (
  image: AgentImageAttachment,
  materializeImageAttachment?: MaterializeImageAttachment
): Promise<AgentImageAttachment> => {
  if (isDurableMessageImagePath(image.source)) {
    return { ...image, data: "" };
  }
  if (!hasMaterializableImageData(image) || materializeImageAttachment === undefined) {
    return image;
  }
  const result = await materializeImageAttachment({
    id: image.id,
    mediaType: image.mediaType,
    data: image.data ?? "",
    label: image.label ?? null
  });
  return {
    ...image,
    source: result.path,
    data: ""
  };
};

export const readImageTransportData = async (
  image: AgentImageAttachment
): Promise<string | null> => {
  if (hasMaterializableImageData(image)) {
    return image.data ?? null;
  }
  if (!isOpenableImageSource(image.source)) {
    return null;
  }
  const loaded = await readImageAttachmentFromPath(image.source);
  return loaded?.data ?? null;
};

export const persistComposerImageAttachment = async (
  image: AgentImageAttachment,
  materializeImageAttachment?: MaterializeImageAttachment
): Promise<AgentImageAttachment> => {
  if (isDurableMessageImagePath(image.source)) {
    return { ...image, data: "" };
  }
  if (materializeImageAttachment === undefined) {
    return image;
  }
  let transportData: string | null = null;
  if (hasMaterializableImageData(image)) {
    transportData = image.data ?? null;
  } else if (isOpenableImageSource(image.source)) {
    transportData = await readImageTransportData(image);
  }
  if (transportData === null || transportData.length === 0) {
    return image;
  }
  try {
    return await materializeComposerImageIfNeeded(
      {
        ...image,
        data: transportData
      },
      materializeImageAttachment
    );
  } catch {
    return image;
  }
};

const imageTurnPayloadShared = (image: AgentImageAttachment) => ({
  id: image.id,
  mediaType: image.mediaType,
  label: image.label ?? null,
  width: image.width ?? null,
  height: image.height ?? null,
  workspaceTabId: image.workspaceTabId ?? null,
  workspaceTabTitle: image.workspaceTabTitle ?? null,
  workspaceTabPageKind: image.workspaceTabPageKind ?? null,
  workspaceTabAddress: image.workspaceTabAddress ?? null
});

export const buildImageTurnPayloadEntry = async (
  image: AgentImageAttachment,
  materializeImageAttachment?: MaterializeImageAttachment
): Promise<AgentImageInput> => {
  const persisted = await persistComposerImageAttachment(image, materializeImageAttachment);
  const shared = imageTurnPayloadShared(persisted);
  const inlineData = hasMaterializableImageData(persisted)
    ? persisted.data ?? null
    : hasMaterializableImageData(image)
      ? image.data ?? null
      : null;
  let transportData = inlineData;
  if ((transportData === null || transportData.length === 0) && isOpenableImageSource(persisted.source)) {
    transportData = await readImageTransportData(persisted);
  }
  if (isOpenableImageSource(persisted.source)) {
    return {
      ...shared,
      source: persisted.source,
      ...(transportData !== null && transportData.length > 0 ? { data: transportData } : {})
    };
  }
  if (transportData !== null && transportData.length > 0) {
    if (materializeImageAttachment !== undefined) {
      try {
        const materialized = await materializeComposerImageIfNeeded(
          { ...persisted, data: transportData },
          materializeImageAttachment
        );
        if (isOpenableImageSource(materialized.source)) {
          return {
            ...imageTurnPayloadShared(materialized),
            source: materialized.source,
            data: transportData
          };
        }
      } catch {
        // Fall through to inline-data transport below.
      }
    }
    return {
      ...shared,
      source: persisted.source ?? null,
      data: transportData
    };
  }
  throw new Error(`Image attachment ${persisted.id} has no readable path or pixel data.`);
};

export const orphanInlineImageAttachment = (imageId: string): AgentImageAttachment => ({
  id: imageId,
  mediaType: "image/png",
  data: "",
  label: null,
  source: null
});

export type ComposerImageSegment = {
  readonly type: "image";
  readonly image: AgentImageAttachment;
};

export type ImageAttachmentChipKind = "file" | "workspace" | "window";

export const imageAttachmentChipKind = (image: AgentImageAttachment): ImageAttachmentChipKind => {
  switch (image.source) {
    case "workspace-screenshot":
    case "browser-screenshot":
      return "workspace";
    case "window-screenshot":
      return "window";
    default:
      return "file";
  }
};

export const imageAttachmentPreview = (image: AgentImageAttachment): string => {
  const label = image.label?.trim();
  if (label !== undefined && label.length > 0) {
    const chars = Array.from(label);
    return chars.length > TRANSCRIPT_CITATION_PREVIEW_CHARS
      ? `${chars.slice(0, TRANSCRIPT_CITATION_PREVIEW_CHARS).join("")}…`
      : label;
  }
  switch (image.source) {
    case "workspace-screenshot":
    case "browser-screenshot":
      return image.workspaceTabTitle?.trim()
        || t("lyra-agents-message.workspaceScreenshot");
    case "window-screenshot":
      return t("lyra-agents-message.windowScreenshot");
    default: {
      const source = image.source?.trim();
      if (source !== undefined && source.length > 0 && isOpenableImageSource(source)) {
        return fileNameFromPath(source);
      }
      return t("lyra-agents-composer.attachImage");
    }
  }
};

export const imageChipAriaLabel = (image: AgentImageAttachment): string => {
  const preview = imageAttachmentPreview(image);
  switch (imageAttachmentChipKind(image)) {
    case "workspace":
      return formatMessage("lyra-agents-composer.imageChipWorkspace", { preview });
    case "window":
      return formatMessage("lyra-agents-composer.imageChipWindow", { preview });
    default:
      return formatMessage("lyra-agents-composer.imageChipFile", { preview });
  }
};

export const IMAGE_ATTACHMENT_MARKER_PATTERN = /⟦image:([^⟧]+)⟧/g;

export const imageAttachmentMarker = (attachmentId: string): string => `⟦image:${attachmentId}⟧`;

export const textHasImageAttachmentMarkers = (text: string): boolean =>
  /⟦image:([^⟧]+)⟧/.test(text);

export const inlineImageMarkerIds = (text: string): readonly string[] => {
  const ids: string[] = [];
  for (const match of text.matchAll(IMAGE_ATTACHMENT_MARKER_PATTERN)) {
    const id = match[1]?.trim();
    if (id !== undefined && id.length > 0) {
      ids.push(id);
    }
  }
  return ids;
};

export const validateImageTurnCommit = (
  text: string,
  images: readonly AgentImageAttachment[],
  segments: readonly { readonly type: string }[] = []
): string | null => {
  const markerIds = inlineImageMarkerIds(text);
  if (markerIds.length === 0) {
    return null;
  }
  if (segments.length > 0) {
    const segmentImageIds = new Set(
      segments
        .filter((segment): segment is ComposerImageSegment => segment.type === "image")
        .map((segment) => segment.image.id)
    );
    for (const markerId of markerIds) {
      if (!segmentImageIds.has(markerId)) {
        return `Image marker ${markerId} is present in text but the attachment chip did not sync. Remove and re-attach the image.`;
      }
    }
  }
  if (images.length === 0) {
    return "Image markers are present but attachments did not sync before send. Remove and re-attach the image.";
  }
  const imageById = new Map(images.map((image) => [image.id, image] as const));
  for (const markerId of markerIds) {
    const image = imageById.get(markerId);
    if (image === undefined) {
      return `Missing image attachment for marker ${markerId}. Remove and re-attach the image.`;
    }
    const hasPath = isOpenableImageSource(image.source);
    const hasData = (image.data ?? "").trim().length > 0;
    if (!hasPath && !hasData) {
      return `Image attachment ${markerId} has no readable path or pixel data.`;
    }
  }
  return null;
};

export const segmentsToImages = (
  segments: readonly { readonly type: string }[]
): readonly AgentImageAttachment[] =>
  segments
    .filter((segment): segment is ComposerImageSegment => segment.type === "image")
    .map((segment) => segment.image);

export const normalizeInlineImageAttachment = (raw: unknown): AgentImageAttachment | null => {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const mediaType = typeof value.mediaType === "string" && value.mediaType.length > 0
    ? value.mediaType
    : null;
  const data = typeof value.data === "string" ? value.data : "";
  const source = typeof value.source === "string" ? value.source : null;
  if (mediaType === null || (data.length === 0 && !isOpenableImageSource(source))) return null;
  const id = typeof value.id === "string" && value.id.length > 0
    ? value.id
    : `image-${mediaType}`;
  return {
    id,
    mediaType,
    data: data.length > 0 ? data : "",
    label: typeof value.label === "string" ? value.label : null,
    source,
    width: typeof value.width === "number" && Number.isFinite(value.width) ? value.width : null,
    height: typeof value.height === "number" && Number.isFinite(value.height) ? value.height : null,
    workspaceTabId: typeof value.workspaceTabId === "string" ? value.workspaceTabId : null,
    workspaceTabTitle: typeof value.workspaceTabTitle === "string" ? value.workspaceTabTitle : null,
    workspaceTabPageKind: typeof value.workspaceTabPageKind === "string" ? value.workspaceTabPageKind : null,
    workspaceTabAddress: typeof value.workspaceTabAddress === "string" ? value.workspaceTabAddress : null
  };
};

export const parseInlineImagesFromMetadata = (
  metadata: unknown
): readonly AgentImageAttachment[] => {
  if (metadata === null || typeof metadata !== "object") return [];
  const raw = (metadata as Record<string, unknown>).inlineImages;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizeInlineImageAttachment(entry))
    .filter((entry): entry is AgentImageAttachment => entry !== null);
};