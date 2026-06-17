import type { AgentPageCitation } from "../../../../../../shared/agent";
import type { WorkspaceTab } from "../../../../workspace-tabs/types";
import { truncateQuotedText } from "./message-citation";
import { pageCitationIconFieldsFromWorkspaceTab } from "./page-citation-tab-icon";

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

export const buildWorkspaceTabPageCitation = (tab: WorkspaceTab): AgentPageCitation => {
  const source = tab.title.trim() || tab.displayAddress.trim() || tab.id;
  const { quotedText, truncated, preview } = truncateQuotedText(source);
  const pageUrl = workspaceTabPageUrl(tab);
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