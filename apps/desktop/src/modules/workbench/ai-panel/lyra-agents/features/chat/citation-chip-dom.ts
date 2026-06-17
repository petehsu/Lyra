import type { AgentPageCitation, AgentTranscriptCitation } from "../../../../../../shared/agent";
import type { AgentImageAttachment } from "../../core/types";
import type { AgentFileAttachment } from "./composer-file";
import { fileAttachmentChipAriaLabel } from "./composer-file";
import {
  imageAttachmentChipKind,
  imageAttachmentPreview,
  imageChipAriaLabel
} from "./composer-image";
import type { ComposerSegment } from "./message-citation";
import { mountPageCitationTabIcon } from "./page-citation-tab-icon";

/** Lucide-aligned stroke icons for citation and attachment chips. */
export const CITATION_CHIP_ICON_SVGS = {
  assistant: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`,
  user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  page: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
  imageFile: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  imageBrowser: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
  imageWindow: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`,
  file: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`
} as const;

const IMAGE_CHIP_ICON_BY_KIND = {
  file: CITATION_CHIP_ICON_SVGS.imageFile,
  workspace: CITATION_CHIP_ICON_SVGS.imageBrowser,
  window: CITATION_CHIP_ICON_SVGS.imageWindow
} as const;

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
  icon.innerHTML = IMAGE_CHIP_ICON_BY_KIND[kind];
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
  icon.innerHTML = CITATION_CHIP_ICON_SVGS.file;
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
  icon.innerHTML = CITATION_CHIP_ICON_SVGS[citation.role];
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
    icon.innerHTML = CITATION_CHIP_ICON_SVGS[citation.role];
  }
  const preview = chip.querySelector<HTMLElement>(".lyra-agents-citation-chip-preview");
  if (preview !== null) {
    preview.textContent = citation.preview;
  }
  chip.title = citation.preview;
};