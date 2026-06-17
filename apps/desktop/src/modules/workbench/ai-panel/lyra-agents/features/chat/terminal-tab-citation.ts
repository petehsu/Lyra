import type { AgentPageCitation } from "../../../../../../shared/agent";
import type { TerminalDockTab } from "../../../../terminal-dock/types";
import type { WorkspaceTab } from "../../../../workspace-tabs/types";
import { truncateQuotedText } from "./message-citation";

const pageCitationId = (): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `page-cite-${randomId}`;
};

export const resolveWorkspaceTabForTerminalTab = (
  terminalTab: TerminalDockTab,
  workspaceTabs: readonly WorkspaceTab[]
): WorkspaceTab | null =>
  workspaceTabs.find(
    (tab) => tab.pageKind === "terminal" && tab.terminalTabId === terminalTab.id
  ) ?? null;

export const buildTerminalTabPageCitation = (
  terminalTab: TerminalDockTab,
  workspaceTabs: readonly WorkspaceTab[] = []
): AgentPageCitation => {
  const linkedWorkspaceTab = resolveWorkspaceTabForTerminalTab(terminalTab, workspaceTabs);
  const source = terminalTab.title.trim() || terminalTab.id;
  const { quotedText, truncated, preview } = truncateQuotedText(source);
  const pageUrl = `lyra://terminal/${terminalTab.id}`;
  return {
    id: pageCitationId(),
    tabId: linkedWorkspaceTab?.id ?? terminalTab.id,
    tabTitle: terminalTab.title,
    pageUrl,
    pageTitle: terminalTab.title.trim().length > 0 ? terminalTab.title : terminalTab.id,
    excerptKind: "page",
    preview,
    quotedText,
    truncated,
    sourceCapturedAt: new Date().toISOString(),
    sourceKind: "terminal-tab",
    tabPageKind: "terminal"
  };
};

export const terminalTabIdFromPageUrl = (pageUrl: string): string | null => {
  const prefix = "lyra://terminal/";
  if (!pageUrl.startsWith(prefix)) {
    return null;
  }
  const terminalTabId = pageUrl.slice(prefix.length).trim();
  return terminalTabId.length > 0 ? terminalTabId : null;
};