import type { AgentPageCitation } from "../../../../../../shared/agent";
import type { TerminalDockTab } from "../../../../terminal-dock/types";
import type { WorkspaceTab } from "../../../../workspace-tabs/types";
import { TRANSCRIPT_CITATION_QUOTED_CHARS, truncateQuotedText } from "./message-citation";
import { compactCitationTrail } from "./page-citation";

const pageCitationId = (): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `page-cite-${randomId}`;
};

const TERMINAL_CITATION_TAIL_BYTES = 2048;

export type TerminalCitationOutput = {
  readonly text?: string;
  readonly omitted: boolean;
};

export const resolveWorkspaceTabForTerminalTab = (
  terminalTab: TerminalDockTab,
  workspaceTabs: readonly WorkspaceTab[]
): WorkspaceTab | null =>
  workspaceTabs.find(
    (tab) => tab.pageKind === "terminal" && tab.terminalTabId === terminalTab.id
  ) ?? null;

export const readTerminalCitationOutput = async (
  read: ((request: {
    readonly sessionId: string;
    readonly cursor?: string;
    readonly maxBytes?: number;
    readonly waitMs?: number;
  }) => Promise<{
    readonly cursor: string;
    readonly output: string;
    readonly truncated: boolean;
  }>) | undefined,
  sessionId: string | undefined
): Promise<TerminalCitationOutput> => {
  const normalizedSessionId = sessionId?.trim() ?? "";
  if (read === undefined || normalizedSessionId.length === 0) {
    return { omitted: false };
  }
  try {
    const probe = await read({
      sessionId: normalizedSessionId,
      cursor: String(Number.MAX_SAFE_INTEGER),
      maxBytes: 1,
      waitMs: 0
    });
    const end = Number(probe.cursor);
    if (!Number.isFinite(end) || end <= 0) {
      return { omitted: false };
    }
    const start = Math.max(0, end - TERMINAL_CITATION_TAIL_BYTES);
    if (start > 0) {
      return { omitted: true };
    }
    const result = await read({
      sessionId: normalizedSessionId,
      cursor: "0",
      maxBytes: TERMINAL_CITATION_TAIL_BYTES,
      waitMs: 0
    });
    const text = result.output.trim();
    if (text.length === 0) {
      return { omitted: false };
    }
    if (Array.from(text).length > TRANSCRIPT_CITATION_QUOTED_CHARS) {
      return { omitted: true };
    }
    return { text, omitted: false };
  } catch {
    return { omitted: false };
  }
};

export const buildTerminalTabPageCitation = (
  terminalTab: TerminalDockTab,
  workspaceTabs: readonly WorkspaceTab[] = [],
  output: TerminalCitationOutput = { omitted: false }
): AgentPageCitation => {
  const linkedWorkspaceTab = resolveWorkspaceTabForTerminalTab(terminalTab, workspaceTabs);
  const title = terminalTab.title.trim() || terminalTab.id;
  const pageUrl = `lyra://terminal/${terminalTab.id}`;
  const header = compactCitationTrail([title, pageUrl]);
  const outputText = output.text?.trim() ?? "";
  const budget = TRANSCRIPT_CITATION_QUOTED_CHARS - Array.from(header).length - 1;
  const canIncludeOutput = outputText.length > 0
    && budget >= 24
    && Array.from(outputText).length <= budget;
  const source = canIncludeOutput ? compactCitationTrail([header, outputText]) : header;
  const { quotedText, truncated } = truncateQuotedText(source);
  return {
    id: pageCitationId(),
    tabId: linkedWorkspaceTab?.id ?? terminalTab.id,
    tabTitle: terminalTab.title,
    pageUrl,
    pageTitle: title,
    excerptKind: "page",
    preview: truncateQuotedText(title).preview,
    quotedText,
    truncated: truncated || output.omitted || (outputText.length > 0 && canIncludeOutput === false),
    sourceCapturedAt: new Date().toISOString(),
    sourceKind: "terminal-tab",
    tabPageKind: "terminal"
  };
};

export const terminalTabIdFromPageUrl = (pageUrl: string): string | null => {
  const prefix = "lyra://terminal/";
  if (pageUrl.startsWith(prefix) === false) {
    return null;
  }
  const terminalTabId = pageUrl.slice(prefix.length).trim();
  return terminalTabId.length > 0 ? terminalTabId : null;
};
