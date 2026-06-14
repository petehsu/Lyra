import type { WorkbenchBrowserElevationSession } from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserAgentModeRequest, WorkbenchBrowserAgentObservation, WorkbenchBrowserViewManager } from "../types";
import { agentTargetAddress, agentTargetTitle } from "./agent-target-runtime";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import { hashStableString, normalizeAddress, normalizeString } from "./normalizers";
import type { BrowserElevationSessionRecord } from "./types";

const REUSABLE_ELEVATION_STATUSES = new Set<WorkbenchBrowserElevationSession["status"]>([
  "opening_live",
  "awaiting_user",
  "verifying"
]);

const ELEVATION_REOPEN_COOLDOWN_MS = 4_000;

type BrowserAgentElevationControllerDeps = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "entries"
  | "publishBrowserAgentActivity"
  | "publishEvent"
  | "resolveBrowserAgentTarget"
  | "waitForAgentPageLoad"
> & {
  readonly observeAgentPage: (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & {
      readonly strategy?: import("../types").WorkbenchBrowserAgentObserveStrategy;
      readonly timeoutMs?: number;
      readonly suppressActivity?: boolean;
    }
  ) => Promise<WorkbenchBrowserAgentObservation>;
};

export const createBrowserAgentElevationController = (deps: BrowserAgentElevationControllerDeps) => {
  const {
    entries,
    observeAgentPage,
    publishBrowserAgentActivity,
    publishEvent,
    resolveBrowserAgentTarget,
    waitForAgentPageLoad
  } = deps;
  const elevationSessions = new Map<string, BrowserElevationSessionRecord>();
  const elevationSessionByIsolatedTabId = new Map<string, string>();

  const elevateAgentPage: WorkbenchBrowserViewManager["elevateAgentPage"] = async (
    tabId,
    request
  ) => {
    if ((request?.targetMode ?? "isolated") !== "live") {
      const existingSessionId = elevationSessionByIsolatedTabId.get(tabId);
      const existingSession = existingSessionId === undefined
        ? undefined
        : elevationSessions.get(existingSessionId);
      if (
        existingSession !== undefined
        && REUSABLE_ELEVATION_STATUSES.has(existingSession.status)
      ) {
        const liveEntry = entries.get(existingSession.liveTabId);
        const liveAddress = liveEntry === undefined
          ? existingSession.isolatedTarget.address
          : normalizeAddress(liveEntry.webContents.getURL()) ?? liveEntry.runtime.address;
        const liveTitle = liveEntry === undefined
          ? existingSession.isolatedTarget.title
          : normalizeString(liveEntry.webContents.getTitle()) ?? liveEntry.runtime.title;
        const refreshedSession: WorkbenchBrowserElevationSession = {
          ...existingSession,
          updatedAt: Date.now(),
          status: existingSession.status === "verifying" ? "verifying" : "awaiting_user",
          ...(typeof request?.reason === "string" && request.reason.length > 0
            ? { reason: request.reason }
            : {})
        };
        elevationSessions.set(refreshedSession.sessionId, refreshedSession);
        if (
          liveEntry === undefined
          && Date.now() - existingSession.updatedAt > ELEVATION_REOPEN_COOLDOWN_MS
        ) {
          publishEvent({
            kind: "request-open-tab",
            address: liveAddress,
            title: liveTitle,
            tabId: existingSession.liveTabId
          });
        }
        return {
          ok: true,
          kind: "lyraLumenElevation",
          tabId,
          targetMode: "isolated",
          liveTabId: existingSession.liveTabId,
          address: liveAddress,
          title: liveTitle,
          userActionRequired: true,
          elevationSession: refreshedSession,
          message:
            "Lyra is already waiting on the visible elevated browser tab for this isolated page."
        };
      }
      if (existingSession !== undefined) {
        elevationSessionByIsolatedTabId.delete(tabId);
      }
    }
    const target = await resolveBrowserAgentTarget(
      tabId,
      { ...request, targetMode: request?.targetMode ?? "isolated" },
      undefined
    );
    if (target.targetMode === "live") {
      return {
        ok: true,
        kind: "lyraLumenElevation",
        tabId,
        targetMode: "live",
        liveTabId: tabId,
        address: agentTargetAddress(target),
        title: agentTargetTitle(target),
        userActionRequired: false,
        message: "Lyra Lumen is already operating on a visible browser tab."
      };
    }
    const address = normalizeAddress(target.webContents.getURL()) ?? agentTargetAddress(target);
    const title = normalizeString(target.webContents.getTitle()) ?? agentTargetTitle(target);
    const liveTabId = `browser-elevated-${hashStableString(`${tabId}:${Date.now()}`)}`;
    const elevationSession: WorkbenchBrowserElevationSession = {
      sessionId: `elevation-${tabId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      isolatedTarget: {
        tabId,
        address,
        title
      },
      liveTabId,
      storageRelation: "shared_default_session",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      status: "awaiting_user",
      cloneStrategy: "storage_preserving_foreground_clone",
      differences: [
        "electron_webcontents_handle_not_reattached",
        "visible_tab_uses_shared_session_storage_clone"
      ],
      ...(typeof request?.reason === "string" && request.reason.length > 0
        ? { reason: request.reason }
        : {})
    };
    elevationSessions.set(elevationSession.sessionId, elevationSession);
    elevationSessionByIsolatedTabId.set(tabId, elevationSession.sessionId);
    publishEvent({
      kind: "request-open-tab",
      address,
      title,
      tabId: liveTabId
    });
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "navigate",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: 2_000
    });
    return {
      ok: true,
      kind: "lyraLumenElevation",
      tabId,
      targetMode: target.targetMode,
      liveTabId,
      address,
      title,
      userActionRequired: true,
      elevationSession,
      message:
        "Lyra opened the isolated browser state in a visible tab so the user can complete CAPTCHA, OAuth, MFA, or another auth wall."
    };
  };

  const completeElevationSession: WorkbenchBrowserViewManager["completeElevationSession"] = async (
    tabId,
    request
  ) => {
    const sessionId =
      request?.elevationSessionId
      ?? elevationSessionByIsolatedTabId.get(tabId)
      ?? [...elevationSessions.values()].find((entry) => entry.liveTabId === request?.liveTabId)?.sessionId;
    const existing = sessionId === undefined ? undefined : elevationSessions.get(sessionId);
    if (existing === undefined) {
      return {
        ok: false,
        kind: "lyraLumenElevationCompletion",
        tabId,
        targetMode: "isolated",
        liveTabId: request?.liveTabId ?? "",
        address: "",
        title: "",
        verified: false,
        message: "No active browser elevation session was found."
      };
    }
    const liveEntry = entries.get(request?.liveTabId ?? existing.liveTabId);
    const liveAddress = liveEntry === undefined
      ? existing.isolatedTarget.address
      : normalizeAddress(liveEntry.webContents.getURL()) ?? liveEntry.runtime.address;
    const liveTitle = liveEntry === undefined
      ? existing.isolatedTarget.title
      : normalizeString(liveEntry.webContents.getTitle()) ?? liveEntry.runtime.title;
    const verifyingSession: WorkbenchBrowserElevationSession = {
      ...existing,
      updatedAt: Date.now(),
      status: "verifying"
    };
    elevationSessions.set(existing.sessionId, verifyingSession);
    const target = await resolveBrowserAgentTarget(tabId, "isolated", request?.timeoutMs);
    await waitForAgentPageLoad(target.webContents, liveAddress, request?.timeoutMs ?? 8_000);
    const observation = await observeAgentPage(tabId, {
      targetMode: "isolated",
      strategy: "hybrid",
      suppressActivity: true,
      ...(request?.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
    });
    const remainingSignals = observation.authChallengeSignals?.filter((signal) =>
      signal.confidence === "high"
    ) ?? [];
    const verified = remainingSignals.length === 0;
    const completedSession: WorkbenchBrowserElevationSession = {
      ...verifyingSession,
      updatedAt: Date.now(),
      status: verified ? "completed" : "awaiting_user"
    };
    elevationSessions.set(existing.sessionId, completedSession);
    return {
      ok: verified,
      kind: "lyraLumenElevationCompletion",
      tabId,
      targetMode: "isolated",
      liveTabId: existing.liveTabId,
      address: liveAddress,
      title: liveTitle,
      verified,
      ...(remainingSignals.length === 0 ? {} : { authChallengeSignals: remainingSignals }),
      elevationSession: completedSession,
      message: verified
        ? "Lyra verified the auth challenge is no longer present and refreshed the isolated browser state."
        : "The visible tab still appears to require user action before Lyra can continue."
    };
  };

  const dispose = (): void => {
    elevationSessions.clear();
    elevationSessionByIsolatedTabId.clear();
  };

  return {
    completeElevationSession,
    dispose,
    elevateAgentPage
  };
};
