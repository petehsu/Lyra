import type { AgentPageCitation } from "../../../../../../shared/agent";
import { isImageViewerSupportedPath } from "../../../../image-viewer";
import type { WorkspaceTab } from "../../../../workspace-tabs/types";
import type { AgentImageAttachment } from "../../core/types";
import { truncateQuotedText } from "./message-citation";
import { compactCitationTrail } from "./page-citation";
import { pageCitationIconFieldsFromWorkspaceTab } from "./page-citation-tab-icon";
import { imageAttachmentMetadataFromPath } from "./read-image-attachment";

const pageCitationId = (): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `page-cite-${randomId}`;
};

const workspaceTabPageUrl = (tab: WorkspaceTab): string => {
  if (tab.pageKind === "page") {
    return tab.displayAddress.trim();
  }
  if (tab.pageKind === "app" && typeof tab.filePath === "string" && tab.filePath.trim().length > 0) {
    return tab.filePath.trim();
  }
  return `lyra://workspace-tab/${tab.pageKind}/${tab.id}`;
};

export const citedImageViewerAttachment = (
  tab: WorkspaceTab
): AgentImageAttachment | null => {
  if (tab.pageKind !== "app" || tab.appId !== "image-viewer") {
    return null;
  }
  const filePath = tab.filePath?.trim() ?? "";
  if (!isImageViewerSupportedPath(filePath)) {
    return null;
  }
  const title = tab.title.trim();
  return {
    ...imageAttachmentMetadataFromPath(filePath, title.length > 0 ? { label: title } : {}),
    workspaceTabId: tab.id,
    workspaceTabTitle: title.length > 0 ? title : null,
    workspaceTabPageKind: "image-viewer",
    workspaceTabAddress: filePath
  };
};

export const buildWorkspaceTabPageCitation = (tab: WorkspaceTab): AgentPageCitation => {
  const pageUrl = workspaceTabPageUrl(tab);
  const title = tab.title.trim() || pageUrl;
  const source = compactCitationTrail([title, pageUrl, tab.id]);
  const { quotedText, truncated } = truncateQuotedText(source);
  const preview = truncateQuotedText(title).preview;
  return {
    id: pageCitationId(),
    tabId: tab.id,
    tabTitle: tab.title,
    pageUrl,
    pageTitle: tab.title.trim().length > 0 ? tab.title : pageUrl,
    excerptKind: "page",
    preview,
    quotedText,
    truncated,
    sourceCapturedAt: new Date().toISOString(),
    ...pageCitationIconFieldsFromWorkspaceTab(tab)
  };
};