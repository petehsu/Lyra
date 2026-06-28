import type { AgentPageCitation, AgentTranscriptCitation } from "../../../../../../shared/agent";
import type { AgentImageAttachment } from "../../core/types";
import type { AgentFileAttachment } from "./composer-file";
import { fileAttachmentChipAriaLabel } from "./composer-file";
import {
  composerChipIconKindForImage,
  mountComposerChipIcon
} from "./composer-chip-icon";
import {
  imageAttachmentChipKind,
  imageAttachmentPreview,
  imageChipAriaLabel
} from "./composer-image";
import type { ComposerSegment } from "./message-citation";
import { mountPageCitationTabIcon } from "./page-citation-tab-icon";

const applyCitationDataset = (chip: HTMLSpanElement, citation: AgentTranscriptCitation): void => {
  chip.dataset.citationId = citation.id;
  chip.dataset.citationRole = citation.role;
  chip.dataset.messageId = citation.messageId;
  chip.dataset.quotedText = citation.quotedText;
  chip.dataset.truncated = citation.truncated ? "true" : "false";
  if (citation.blockId !== undefined && citation.blockId !== null) {
    chip.dataset.blockId = citation.blockId;
  }
  if (citation.startOffset !== undefined && citation.startOffset !== null) {
    chip.dataset.startOffset = String(citation.startOffset);
  }
  if (citation.endOffset !== undefined && citation.endOffset !== null) {
    chip.dataset.endOffset = String(citation.endOffset);
  }
  if (citation.sourceCreatedAt !== undefined && citation.sourceCreatedAt !== null) {
    chip.dataset.sourceCreatedAt = citation.sourceCreatedAt;
  }
};

const applyPageCitationDataset = (chip: HTMLSpanElement, citation: AgentPageCitation): void => {
  chip.dataset.citationId = citation.id;
  chip.dataset.citationKind = "page";
  chip.dataset.tabId = citation.tabId;
  chip.dataset.pageUrl = citation.pageUrl;
  chip.dataset.quotedText = citation.quotedText;
  chip.dataset.truncated = citation.truncated ? "true" : "false";
  if (citation.sourceKind !== undefined && citation.sourceKind !== null) {
    chip.dataset.sourceKind = citation.sourceKind;
  }
  if (citation.tabPageKind !== undefined && citation.tabPageKind !== null) {
    chip.dataset.tabPageKind = citation.tabPageKind;
  }
  if (citation.faviconUrl !== undefined && citation.faviconUrl !== null) {
    chip.dataset.faviconUrl = citation.faviconUrl;
  }
  if (citation.appId !== undefined && citation.appId !== null) {
    chip.dataset.appId = citation.appId;
  }
  if (citation.appIconKey !== undefined && citation.appIconKey !== null) {
    chip.dataset.appIconKey = citation.appIconKey;
  }
};

export const createPageCitationChipElement = (citation: AgentPageCitation): HTMLSpanElement => {
  const chip = document.createElement("span");
  chip.className = "lyra-agents-citation-chip lyra-agents-citation-chip-page";
  chip.contentEditable = "false";
  chip.title = citation.preview;
  chip.setAttribute("role", "button");
  chip.setAttribute("tabindex", "-1");
  applyPageCitationDataset(chip, citation);

  const icon = document.createElement("span");
  icon.className = "lyra-agents-citation-chip-icon-host";
  mountPageCitationTabIcon(icon, citation);
  chip.appendChild(icon);

  const previewWrap = document.createElement("span");
  previewWrap.className = "lyra-agents-citation-chip-preview-wrap";
  const preview = document.createElement("span");
  preview.className = "lyra-agents-citation-chip-preview";
  preview.textContent = citation.preview;
  previewWrap.appendChild(preview);
  chip.appendChild(previewWrap);
  return chip;
};

export const createImageChipElement = (image: AgentImageAttachment): HTMLSpanElement => {
  const kind = imageAttachmentChipKind(image);
  const preview = imageAttachmentPreview(image);
  const chip = document.createElement("span");
  chip.className = `lyra-agents-citation-chip lyra-agents-citation-chip-attachment lyra-agents-citation-chip-attachment-${kind}`;
  chip.contentEditable = "false";
  chip.title = preview;
  chip.setAttribute("aria-label", imageChipAriaLabel(image));
  chip.dataset.attachmentId = image.id;
  chip.dataset.attachmentSource = image.source ?? "local-file";
  chip.dataset.attachmentMediaType = image.mediaType;

  const icon = document.createElement("span");
  icon.className = "lyra-agents-citation-chip-icon";
  mountComposerChipIcon(icon, composerChipIconKindForImage(image));
  chip.appendChild(icon);

  const previewWrap = document.createElement("span");
  previewWrap.className = "lyra-agents-citation-chip-preview-wrap";
  const previewNode = document.createElement("span");
  previewNode.className = "lyra-agents-citation-chip-preview";
  previewNode.textContent = preview;
  previewWrap.appendChild(previewNode);
  chip.appendChild(previewWrap);
  return chip;
};

export const createFileChipElement = (file: AgentFileAttachment): HTMLSpanElement => {
  const chip = document.createElement("span");
  chip.className = "lyra-agents-citation-chip lyra-agents-citation-chip-file";
  chip.contentEditable = "false";
  chip.title = file.preview;
  chip.setAttribute("aria-label", fileAttachmentChipAriaLabel(file));
  chip.dataset.fileAttachmentId = file.id;
  chip.dataset.filePath = file.path;

  const icon = document.createElement("span");
  icon.className = "lyra-agents-citation-chip-icon";
  mountComposerChipIcon(icon, "file");
  chip.appendChild(icon);

  const previewWrap = document.createElement("span");
  previewWrap.className = "lyra-agents-citation-chip-preview-wrap";
  const previewNode = document.createElement("span");
  previewNode.className = "lyra-agents-citation-chip-preview";
  previewNode.textContent = file.preview;
  previewWrap.appendChild(previewNode);
  chip.appendChild(previewWrap);
  return chip;
};

export const createComposerChipElement = (segment: Exclude<ComposerSegment, { type: "text" }>): HTMLSpanElement => {
  if (segment.type === "image") {
    return createImageChipElement(segment.image);
  }
  if (segment.type === "file") {
    return createFileChipElement(segment.file);
  }
  if (segment.type === "pageCitation") {
    return createPageCitationChipElement(segment.citation);
  }
  return createCitationChipElement(segment.citation);
};

export const createCitationChipElement = (citation: AgentTranscriptCitation): HTMLSpanElement => {
  const chip = document.createElement("span");
  chip.className = `lyra-agents-citation-chip lyra-agents-citation-chip-${citation.role}`;
  chip.contentEditable = "false";
  chip.title = citation.preview;
  chip.setAttribute("role", "button");
  chip.setAttribute("tabindex", "-1");
  chip.dataset.citationKind = "transcript";
  applyCitationDataset(chip, citation);

  const icon = document.createElement("span");
  icon.className = "lyra-agents-citation-chip-icon";
  mountComposerChipIcon(icon, citation.role);
  chip.appendChild(icon);

  const previewWrap = document.createElement("span");
  previewWrap.className = "lyra-agents-citation-chip-preview-wrap";

  const preview = document.createElement("span");
  preview.className = "lyra-agents-citation-chip-preview";
  preview.textContent = citation.preview;
  previewWrap.appendChild(preview);
  chip.appendChild(previewWrap);

  return chip;
};

export const hydrateCitationChipElement = (
  chip: HTMLSpanElement,
  citation: AgentTranscriptCitation
): void => {
  applyCitationDataset(chip, citation);
  const icon = chip.querySelector<HTMLElement>(".lyra-agents-citation-chip-icon");
  if (icon !== null) {
    mountComposerChipIcon(icon, citation.role);
  }
  const preview = chip.querySelector<HTMLElement>(".lyra-agents-citation-chip-preview");
  if (preview !== null) {
    preview.textContent = citation.preview;
  }
  chip.title = citation.preview;
};
