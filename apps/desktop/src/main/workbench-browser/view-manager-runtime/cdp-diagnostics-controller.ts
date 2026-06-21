import {
  buildBrowserDiagnosticsSummary,
  filterBrowserDiagnostics,
  recommendBrowserDiagnosticAction
} from "@lyra/browser-automation";

import type {
  WorkbenchBrowserPageDiagnosticEntry,
  WorkbenchBrowserPageDiagnosticsResult
} from "../../../shared/desktop-bridge";
import {
  createCdpAuditSession,
  type CdpAuditSession,
  type CdpAuditSessionReadRequest
} from "../cdp-audit-session";
import { createWorkbenchBrowserSharedDebuggerSession } from "../debugger";
import type {
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserDebuggerSession
} from "../types";
import {
  agentTargetAddress,
  agentTargetTitle,
  debuggerSessionKey,
  liveAgentTarget
} from "./agent-target-runtime";
import { MAX_BROWSER_PAGE_DIAGNOSTICS, normalizeAddress } from "./normalizers";
import type { BrowserAgentPageTarget, BrowserPageEntry } from "./types";

type FileChooserHook = (
  tabId: string,
  targetMode: WorkbenchBrowserAgentTargetMode
) => void;

type CdpDiagnosticsControllerHost = {
  readonly resolveBrowserAgentTarget: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest | WorkbenchBrowserAgentTargetMode | undefined,
    timeoutMs: number | undefined
  ) => Promise<BrowserAgentPageTarget>;
  readonly onFileChooserOpened?: FileChooserHook;
  readonly onFileChooserClosed?: FileChooserHook;
};

export const createCdpDiagnosticsController = ({
  resolveBrowserAgentTarget,
  onFileChooserOpened,
  onFileChooserClosed
}: CdpDiagnosticsControllerHost) => {
  const pageDiagnostics = new Map<string, WorkbenchBrowserPageDiagnosticEntry[]>();
  const debuggerSessions = new Map<
    string,
    ReturnType<typeof createWorkbenchBrowserSharedDebuggerSession>
  >();
  const cdpAuditSessions = new Map<string, CdpAuditSession>();

  const openDebuggerSessionForTarget = async (
    target: BrowserAgentPageTarget
  ): Promise<WorkbenchBrowserDebuggerSession> => {
    const key = debuggerSessionKey(target.tabId, target.targetMode);
    const existing = debuggerSessions.get(key);
    if (existing !== undefined) {
      return await existing.acquire();
    }
    const created = createWorkbenchBrowserSharedDebuggerSession({
      tabId: target.tabId,
      webContents: target.webContents,
      readPageAddress: () =>
        normalizeAddress(target.webContents.getURL())
        ?? target.liveEntry?.runtime.address
        ?? target.address
    });
    debuggerSessions.set(key, created);
    return await created.acquire();
  };

  const diagnosticsForTab = (tabId: string): WorkbenchBrowserPageDiagnosticEntry[] => {
    const existing = pageDiagnostics.get(tabId);
    if (existing !== undefined) {
      return existing;
    }
    const created: WorkbenchBrowserPageDiagnosticEntry[] = [];
    pageDiagnostics.set(tabId, created);
    return created;
  };

  const appendPageDiagnostic = (
    tabId: string,
    entry: WorkbenchBrowserPageDiagnosticEntry
  ): void => {
    const diagnostics = diagnosticsForTab(tabId);
    const existingIndex = diagnostics.findIndex((item) => item.id === entry.id);
    if (existingIndex >= 0) {
      diagnostics[existingIndex] = entry;
    } else {
      diagnostics.push(entry);
    }
    if (diagnostics.length > MAX_BROWSER_PAGE_DIAGNOSTICS) {
      diagnostics.splice(0, diagnostics.length - MAX_BROWSER_PAGE_DIAGNOSTICS);
    }
  };

  const recordPageDiagnostic = (
    tabId: string,
    entry: Omit<WorkbenchBrowserPageDiagnosticEntry, "id" | "at">
  ): void => {
    const at = Date.now();
    appendPageDiagnostic(tabId, {
      id: `diag-${tabId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at,
      timestamp: new Date(at).toISOString(),
      ...entry
    });
  };

  const ensureCdpAuditSessionForTarget = (
    target: BrowserAgentPageTarget
  ): CdpAuditSession => {
    const key = debuggerSessionKey(target.tabId, target.targetMode);
    const existing = cdpAuditSessions.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = createCdpAuditSession({
      tabId: target.tabId,
      targetMode: target.targetMode,
      acquireDebugger: async () => await openDebuggerSessionForTarget(target),
      onDiagnostic: (diagnostic) => {
        appendPageDiagnostic(target.tabId, diagnostic);
      },
      ...(onFileChooserOpened === undefined
        ? {}
        : { onFileChooserOpened: () => onFileChooserOpened(target.tabId, target.targetMode) }),
      ...(onFileChooserClosed === undefined
        ? {}
        : { onFileChooserClosed: () => onFileChooserClosed(target.tabId, target.targetMode) }),
      maxBufferedEntries: MAX_BROWSER_PAGE_DIAGNOSTICS
    });
    cdpAuditSessions.set(key, created);
    return created;
  };

  const startCdpAuditSessionForEntry = (entry: BrowserPageEntry): void => {
    if (entry.isDestroyed || entry.webContents.isDestroyed()) {
      return;
    }
    const session = ensureCdpAuditSessionForTarget(liveAgentTarget(entry));
    void session.start().catch((error: unknown) => {
      recordPageDiagnostic(entry.tabId, {
        source: "runtime",
        severity: "warning",
        message: `CDP diagnostics unavailable: ${String(error instanceof Error ? error.message : error)}`
      });
    });
  };

  const disposeCdpAuditSession = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): void => {
    const key = debuggerSessionKey(tabId, targetMode);
    const session = cdpAuditSessions.get(key);
    if (session !== undefined) {
      cdpAuditSessions.delete(key);
      void session.dispose().catch(() => undefined);
    }
  };

  const disposeDebuggerSession = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): void => {
    const key = debuggerSessionKey(tabId, targetMode);
    void debuggerSessions.get(key)?.dispose().catch(() => undefined);
    debuggerSessions.delete(key);
  };

  const hasActiveDebuggerClients = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): boolean =>
    debuggerSessions.get(debuggerSessionKey(tabId, targetMode))?.hasActiveClients() === true;

  const readPageDiagnostics = (
    tabId: string
  ): readonly WorkbenchBrowserPageDiagnosticEntry[] =>
    pageDiagnostics.get(tabId) ?? [];

  const auditAgentPageDiagnostics = async (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & CdpAuditSessionReadRequest
  ): Promise<WorkbenchBrowserPageDiagnosticsResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, undefined);
    const maxEntries = Math.max(1, Math.min(300, Math.round(request?.maxEntries ?? 80)));
    const cdpSession = ensureCdpAuditSessionForTarget(target);
    const cdpSnapshot = await cdpSession.readDiagnostics({
      ...(request as CdpAuditSessionReadRequest | undefined),
      maxEntries
    });
    const buffered = pageDiagnostics.get(tabId) ?? [];
    const entriesForResult = filterBrowserDiagnostics(buffered, {
      ...(request as CdpAuditSessionReadRequest | undefined),
      maxEntries
    });
    const summary = buildBrowserDiagnosticsSummary(entriesForResult);
    const evidenceRefs = entriesForResult
      .filter((entry) =>
        entry.severity === "error"
        || entry.stackTruncated === true
        || entry.responseBody !== undefined
      )
      .map((entry) => entry.evidenceRef ?? entry.id)
      .slice(0, 40);
    return {
      ok: true,
      kind: "lyraLumenPageDiagnostics",
      tabId,
      targetMode: target.targetMode,
      address: agentTargetAddress(target),
      title: agentTargetTitle(target),
      available: cdpSnapshot.available,
      ...(cdpSnapshot.unavailableReason === undefined
        ? {}
        : { unavailableReason: cdpSnapshot.unavailableReason }),
      entries: entriesForResult,
      diagnostics: entriesForResult,
      summary,
      recommendedNextAction: recommendBrowserDiagnosticAction(summary, cdpSnapshot.available),
      evidenceRefs
    };
  };

  const clearDiagnosticsForTab = (tabId: string): void => {
    pageDiagnostics.delete(tabId);
  };

  const dispose = (): void => {
    for (const session of cdpAuditSessions.values()) {
      void session.dispose().catch(() => undefined);
    }
    cdpAuditSessions.clear();
    for (const session of debuggerSessions.values()) {
      void session.dispose().catch(() => undefined);
    }
    debuggerSessions.clear();
    pageDiagnostics.clear();
  };

  return {
    appendPageDiagnostic,
    auditAgentPageDiagnostics,
    clearDiagnosticsForTab,
    dispose,
    disposeCdpAuditSession,
    disposeDebuggerSession,
    ensureCdpAuditSessionForTarget,
    hasActiveDebuggerClients,
    openDebuggerSessionForTarget,
    readPageDiagnostics,
    recordPageDiagnostic,
    startCdpAuditSessionForEntry
  };
};
