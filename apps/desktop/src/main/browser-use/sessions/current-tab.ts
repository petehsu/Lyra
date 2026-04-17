import { randomUUID } from "node:crypto";

import type {
  BrowserUseAgentRunRequest,
  BrowserUseAgentRunResult,
  BrowserUseNavigateRequest,
  BrowserUseNavigateResult,
  BrowserUsePageActionRequest,
  BrowserUsePageActionResult,
  BrowserUsePageExtractRequest,
  BrowserUsePageExtractResult,
  BrowserUsePageState,
  BrowserUsePrepareSessionRequest,
  BrowserUsePreparedSessionResult,
  BrowserUseWaitRequest,
  BrowserUseWaitResult,
} from "../../../shared/browser-use";
import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import type {
  BrowserUseCurrentTabSessionRecord,
  BrowserUseCdpBridgeService,
  BrowserUseRuntimeManager,
} from "../types";
import { createBrowserUseError } from "../types";
import {
  extractDaemonPage,
  readDaemonPageState,
  runDaemonAgentTask,
  runDaemonNavigateAction,
  runDaemonPageAction,
  waitOnDaemonPage,
  ensureBrowserUseDaemonCommandOk,
} from "./daemon-commands";

const ensureActiveVisiblePage = (
  browserBridge: WorkbenchBrowserIpcBridge,
  tabId?: string,
  expectedAddress?: string,
) => {
  const activeTabId = browserBridge.readActiveTabId();
  const resolvedTabId = typeof tabId === "string" && tabId.length > 0 ? tabId : activeTabId;
  if (resolvedTabId === null) {
    throw createBrowserUseError(
      "active_visible_page_required",
      "browser_use current_tab sessions require an active visible page tab.",
    );
  }
  const page = browserBridge.readPageState({ tabId: resolvedTabId });
  if (page === null || page.isActive === false || page.isVisible === false) {
    throw createBrowserUseError(
      "active_visible_page_required",
      "browser_use current_tab sessions require the target tab to remain the active visible page.",
      { tabId: resolvedTabId },
    );
  }
  if (expectedAddress !== undefined && page.address !== expectedAddress) {
    throw createBrowserUseError(
      "session_invalidated",
      "The current_tab browser_use session became stale because the page navigated.",
      {
        tabId: resolvedTabId,
        expectedAddress,
        actualAddress: page.address,
      },
    );
  }
  return page;
};

const validateCurrentTabSession = (
  record: BrowserUseCurrentTabSessionRecord,
  browserBridge: WorkbenchBrowserIpcBridge,
) => {
  return ensureActiveVisiblePage(browserBridge, record.session.tabId, record.session.pageAddress);
};

export const prepareCurrentTabSession = async (
  runtime: BrowserUseRuntimeManager,
  browserBridge: WorkbenchBrowserIpcBridge,
  cdpBridge: BrowserUseCdpBridgeService,
  request?: BrowserUsePrepareSessionRequest,
  existing?: BrowserUseCurrentTabSessionRecord,
): Promise<BrowserUsePreparedSessionResult | BrowserUseCurrentTabSessionRecord> => {
  if (existing !== undefined) {
    validateCurrentTabSession(existing, browserBridge);
    return {
      session: existing.session,
      reused: true,
    };
  }

  const page = ensureActiveVisiblePage(browserBridge, request?.tabId);
  const sessionId = request?.reuseSessionId?.trim().length ? request.reuseSessionId!.trim() : randomUUID();
  const daemonSessionName = `lyra-${sessionId}`;
  const bridgeSession = await cdpBridge.openForTab(page.tabId);

  try {
    await runtime.startDaemon({
      daemonSessionName,
      headed: true,
      cdpUrl: bridgeSession.wsUrl,
    });

    const connectData = await ensureBrowserUseDaemonCommandOk(
      runtime,
      {
        session: {
          sessionId,
          mode: "current_tab",
          authMode: request?.authMode ?? "isolated",
          backend: "browser_use_cdp_bridge",
          ready: true,
          createdAt: Date.now(),
          tabId: page.tabId,
          pageAddress: page.address,
          headed: true,
          cdpUrl: bridgeSession.wsUrl,
        },
        daemonSessionName,
      },
      "connect",
      {},
    );

    return {
      session: {
        sessionId,
        mode: "current_tab",
        authMode: request?.authMode ?? "isolated",
        backend: "browser_use_cdp_bridge",
        ready: true,
        createdAt: Date.now(),
        tabId: page.tabId,
        pageAddress: page.address,
        headed: true,
        cdpUrl: typeof connectData.cdp_url === "string" ? connectData.cdp_url : bridgeSession.wsUrl,
      },
      daemonSessionName,
      bridgeSession,
      invalidate: async () => {
        await Promise.allSettled([
          runtime.stopDaemon(daemonSessionName),
          bridgeSession.close(),
        ]);
      },
    };
  } catch (error) {
    await Promise.allSettled([
      runtime.stopDaemon(daemonSessionName),
      bridgeSession.close(),
    ]);
    throw error;
  }
};

export const readCurrentTabState = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseCurrentTabSessionRecord,
  browserBridge: WorkbenchBrowserIpcBridge,
): Promise<BrowserUsePageState> => {
  validateCurrentTabSession(record, browserBridge);
  return await readDaemonPageState(runtime, record);
};

export const extractCurrentTabPage = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseCurrentTabSessionRecord,
  browserBridge: WorkbenchBrowserIpcBridge,
  request: BrowserUsePageExtractRequest,
): Promise<BrowserUsePageExtractResult> => {
  validateCurrentTabSession(record, browserBridge);
  return await extractDaemonPage(runtime, record, request);
};

export const runCurrentTabAction = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseCurrentTabSessionRecord,
  browserBridge: WorkbenchBrowserIpcBridge,
  request: BrowserUsePageActionRequest,
): Promise<BrowserUsePageActionResult> => {
  validateCurrentTabSession(record, browserBridge);
  return await runDaemonPageAction(runtime, record, request);
};

export const runCurrentTabNavigateAction = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseCurrentTabSessionRecord,
  browserBridge: WorkbenchBrowserIpcBridge,
  request: BrowserUseNavigateRequest,
): Promise<BrowserUseNavigateResult> => {
  validateCurrentTabSession(record, browserBridge);
  return await runDaemonNavigateAction(runtime, record, request);
};

export const waitOnCurrentTab = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseCurrentTabSessionRecord,
  browserBridge: WorkbenchBrowserIpcBridge,
  request: BrowserUseWaitRequest,
): Promise<BrowserUseWaitResult> => {
  validateCurrentTabSession(record, browserBridge);
  return await waitOnDaemonPage(runtime, record, request);
};

export const runCurrentTabAgentTask = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseCurrentTabSessionRecord,
  browserBridge: WorkbenchBrowserIpcBridge,
  request: BrowserUseAgentRunRequest,
): Promise<BrowserUseAgentRunResult> => {
  validateCurrentTabSession(record, browserBridge);
  return await runDaemonAgentTask(runtime, record, request);
};
