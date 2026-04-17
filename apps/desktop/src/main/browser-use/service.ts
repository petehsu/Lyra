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
  BrowserUsePageStateRequest,
  BrowserUsePrepareSessionRequest,
  BrowserUsePreparedSessionResult,
  BrowserUseWaitRequest,
  BrowserUseWaitResult,
} from "../../shared/browser-use";
import { createBrowserUseCdpBridgeService } from "./cdp-bridge/service";
import { createBrowserUseRuntimeManager } from "./runtime/manager";
import {
  extractCurrentTabPage,
  prepareCurrentTabSession,
  readCurrentTabState,
  runCurrentTabAction,
  runCurrentTabAgentTask,
  runCurrentTabNavigateAction,
  waitOnCurrentTab,
} from "./sessions/current-tab";
import {
  extractDaemonPage,
  readDaemonPageState,
  runDaemonAgentTask,
  runDaemonNavigateAction,
  runDaemonPageAction,
  waitOnDaemonPage,
} from "./sessions/daemon-commands";
import { prepareManagedSession } from "./sessions/managed";
import type {
  BrowserUseCurrentTabSessionRecord,
  BrowserUseManagedSessionRecord,
  BrowserUseService,
  BrowserUseServiceDeps,
} from "./types";
import { createBrowserUseError } from "./types";

const isCurrentTabRecord = (
  value: BrowserUseCurrentTabSessionRecord | BrowserUseManagedSessionRecord,
): value is BrowserUseCurrentTabSessionRecord => value.session.mode === "current_tab";

const invalidSession = (sessionId: string) =>
  createBrowserUseError("session_not_found", `Unknown browser_use session: ${sessionId}`, { sessionId });

const shouldInvalidateBrowserUseSession = (error: unknown): boolean => {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? error.code : undefined;
  return (
    code === "session_invalidated"
    || code === "browser_use_command_timeout"
    || code === "browser_use_daemon_unavailable"
  );
};

export const createBrowserUseService = ({ storageRoot, browserBridge }: BrowserUseServiceDeps): BrowserUseService => {
  const runtime = createBrowserUseRuntimeManager({ storageRoot });
  const cdpBridge = createBrowserUseCdpBridgeService({ browserBridge });
  const sessions = new Map<string, BrowserUseCurrentTabSessionRecord | BrowserUseManagedSessionRecord>();

  const requireSession = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      throw invalidSession(sessionId);
    }
    return session;
  };

  const dropSession = async (
    sessionId: string,
    session?: BrowserUseCurrentTabSessionRecord | BrowserUseManagedSessionRecord,
  ) => {
    const resolved = session ?? sessions.get(sessionId);
    sessions.delete(sessionId);
    await resolved?.invalidate().catch(() => undefined);
  };

  const resolveRequestedCurrentTabId = (request?: BrowserUsePrepareSessionRequest): string | null => {
    const requestedTabId = request?.tabId?.trim();
    return requestedTabId && requestedTabId.length > 0 ? requestedTabId : browserBridge.readActiveTabId();
  };

  const pruneCurrentTabSessions = async (requestedTabId?: string | null) => {
    const removals = Array.from(sessions.entries()).filter(([, session]) => {
      if (!isCurrentTabRecord(session)) {
        return false;
      }
      const sessionTabId = session.session.tabId;
      if (typeof sessionTabId !== "string" || sessionTabId.length === 0) {
        return true;
      }
      const page = browserBridge.readPageState({ tabId: sessionTabId });
      if (page === null || page.isActive === false || page.isVisible === false) {
        return true;
      }
      if (page.address !== session.session.pageAddress) {
        return true;
      }
      if (
        typeof requestedTabId === "string"
        && requestedTabId.length > 0
        && sessionTabId === requestedTabId
      ) {
        return false;
      }
      return sessionTabId !== browserBridge.readActiveTabId();
    });

    for (const [sessionId, session] of removals) {
      await dropSession(sessionId, session);
    }
  };

  const findReusableCurrentTabSession = (tabId: string | null) => {
    if (tabId === null) {
      return undefined;
    }
    for (const session of sessions.values()) {
      if (!isCurrentTabRecord(session)) {
        continue;
      }
      const sessionTabId = session.session.tabId;
      if (sessionTabId !== tabId) {
        continue;
      }
      const page = browserBridge.readPageState({ tabId: tabId });
      if (
        page !== null
        && page.isActive !== false
        && page.isVisible !== false
        && page.address === session.session.pageAddress
      ) {
        return session;
      }
    }
    return undefined;
  };

  const runWithSession = async <T>(
    sessionId: string,
    execute: (session: BrowserUseCurrentTabSessionRecord | BrowserUseManagedSessionRecord) => Promise<T>,
  ): Promise<T> => {
    const session = requireSession(sessionId);
    try {
      return await execute(session);
    } catch (error) {
      if (shouldInvalidateBrowserUseSession(error)) {
        await dropSession(sessionId, session);
      }
      throw error;
    }
  };

  const prepareSession = async (
    request?: BrowserUsePrepareSessionRequest,
  ): Promise<BrowserUsePreparedSessionResult> => {
    const reuseSessionId = request?.reuseSessionId?.trim();
    const existing = reuseSessionId ? sessions.get(reuseSessionId) : undefined;
    const mode = request?.mode ?? "current_tab";

    if (mode === "current_tab") {
      const requestedTabId = resolveRequestedCurrentTabId(request);
      await pruneCurrentTabSessions(requestedTabId);
      const reusable = existing && isCurrentTabRecord(existing)
        ? existing
        : findReusableCurrentTabSession(requestedTabId);
      const prepared = await prepareCurrentTabSession(
        runtime,
        browserBridge,
        cdpBridge,
        {
          ...request,
          ...(reuseSessionId ? { reuseSessionId } : { reuseSessionId: randomUUID() }),
        },
        reusable,
      );
      if ("session" in prepared && "reused" in prepared) {
        return prepared;
      }
      sessions.set(prepared.session.sessionId, prepared);
      return {
        session: prepared.session,
        reused: false,
      };
    }

    const prepared = await prepareManagedSession(
      runtime,
      {
        ...request,
        mode: "managed",
        ...(reuseSessionId ? { reuseSessionId } : { reuseSessionId: randomUUID() }),
      },
      existing && !isCurrentTabRecord(existing) ? existing : undefined,
    );

    if ("session" in prepared && "reused" in prepared) {
      return prepared;
    }

    sessions.set(prepared.session.sessionId, prepared);
    return {
      session: prepared.session,
      reused: false,
    };
  };

  const readPageState = async (request: BrowserUsePageStateRequest): Promise<BrowserUsePageState> => {
    return await runWithSession(request.sessionId, async (session) =>
      isCurrentTabRecord(session)
        ? await readCurrentTabState(runtime, session, browserBridge)
        : await readDaemonPageState(runtime, session)
    );
  };

  const extractPage = async (request: BrowserUsePageExtractRequest): Promise<BrowserUsePageExtractResult> => {
    return await runWithSession(request.sessionId, async (session) =>
      isCurrentTabRecord(session)
        ? await extractCurrentTabPage(runtime, session, browserBridge, request)
        : await extractDaemonPage(runtime, session, request)
    );
  };

  const runSafeAction = async (request: BrowserUsePageActionRequest): Promise<BrowserUsePageActionResult> => {
    return await runWithSession(request.sessionId, async (session) =>
      isCurrentTabRecord(session)
        ? await runCurrentTabAction(runtime, session, browserBridge, request)
        : await runDaemonPageAction(runtime, session, request)
    );
  };

  const runMutateAction = async (request: BrowserUsePageActionRequest): Promise<BrowserUsePageActionResult> => {
    return await runWithSession(request.sessionId, async (session) =>
      isCurrentTabRecord(session)
        ? await runCurrentTabAction(runtime, session, browserBridge, request)
        : await runDaemonPageAction(runtime, session, request)
    );
  };

  const runNavigateAction = async (request: BrowserUseNavigateRequest): Promise<BrowserUseNavigateResult> => {
    return await runWithSession(request.sessionId, async (session) =>
      isCurrentTabRecord(session)
        ? await runCurrentTabNavigateAction(runtime, session, browserBridge, request)
        : await runDaemonNavigateAction(runtime, session, request)
    );
  };

  const waitForPage = async (request: BrowserUseWaitRequest): Promise<BrowserUseWaitResult> => {
    return await runWithSession(request.sessionId, async (session) =>
      isCurrentTabRecord(session)
        ? await waitOnCurrentTab(runtime, session, browserBridge, request)
        : await waitOnDaemonPage(runtime, session, request)
    );
  };

  const runAgentTask = async (request: BrowserUseAgentRunRequest): Promise<BrowserUseAgentRunResult> => {
    return await runWithSession(request.sessionId, async (session) =>
      isCurrentTabRecord(session)
        ? await runCurrentTabAgentTask(runtime, session, browserBridge, request)
        : await runDaemonAgentTask(runtime, session, request)
    );
  };

  return {
    runtime,
    dispose: async () => {
      for (const session of sessions.values()) {
        await session.invalidate().catch(() => undefined);
      }
      sessions.clear();
      await cdpBridge.dispose();
      await runtime.dispose();
    },
    prepareSession,
    readPageState,
    extractPage,
    runSafeAction,
    runMutateAction,
    runNavigateAction,
    waitForPage,
    runAgentTask,
  };
};
