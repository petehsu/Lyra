import { WORKBENCH_BROWSER_ISOLATED_PROFILE_PARTITION, WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION } from "../../../shared/workbench-browser";
import type { WorkbenchBrowserAgentModeInfo, WorkbenchBrowserAgentModeReason, WorkbenchBrowserAgentModeRequest, WorkbenchBrowserAgentTargetMode } from "../types";
import type { BrowserAgentLoginBorrowResult, BrowserAgentPageTarget, BrowserPageEntry } from "./types";

const agentTargetAddress = (target: BrowserAgentPageTarget): string =>
  target.liveEntry?.runtime.address ?? target.address;

const agentTargetTitle = (target: BrowserAgentPageTarget): string =>
  target.liveEntry?.runtime.title ?? target.title;

const agentTargetIsLoading = (target: BrowserAgentPageTarget): boolean =>
  target.liveEntry?.runtime.isLoading ?? target.isLoading;

const defaultBrowserMode = (
  targetMode: WorkbenchBrowserAgentTargetMode,
  reason: WorkbenchBrowserAgentModeReason = targetMode === "live"
    ? "default_current_visible_browser"
    : "explicit_isolated",
  visibleFollow = false,
  liveLoginState?: BrowserAgentLoginBorrowResult
): WorkbenchBrowserAgentModeInfo => ({
  targetMode,
  visibleFollow: targetMode === "live" && visibleFollow,
  authState:
    targetMode === "live"
      ? "liveProfile"
      : liveLoginState === undefined
        ? "isolatedProfile"
        : liveLoginState.borrowed
          ? "borrowedLiveLogin"
          : "borrowLiveLoginUnavailable",
  reason:
    targetMode === "live" && visibleFollow
      ? "follow_toggle_enabled"
      : liveLoginState === undefined
        ? reason
        : liveLoginState.borrowed
          ? "user_authorized_live_login_state"
          : "isolated_login_state_unavailable",
  profilePartition:
    targetMode === "live"
      ? WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION
      : WORKBENCH_BROWSER_ISOLATED_PROFILE_PARTITION,
  ...(liveLoginState === undefined ? {} : { liveLoginState })
});

const liveAgentTarget = (
  entry: BrowserPageEntry,
  browserMode: WorkbenchBrowserAgentModeInfo = defaultBrowserMode("live")
): BrowserAgentPageTarget => ({
  tabId: entry.tabId,
  webContents: entry.webContents,
  targetMode: "live",
  liveEntry: entry,
  browserMode,
  address: entry.runtime.address,
  title: entry.runtime.title,
  isLoading: entry.runtime.isLoading
});

const debuggerSessionKey = (
  tabId: string,
  targetMode: WorkbenchBrowserAgentTargetMode
): string => targetMode === "live" ? tabId : `${targetMode}:${tabId}`;


const normalizeBrowserAgentModeRequest = (
  request: WorkbenchBrowserAgentModeRequest | WorkbenchBrowserAgentTargetMode | undefined
): WorkbenchBrowserAgentModeRequest => {
  if (request === "live" || request === "isolated") {
    return { targetMode: request };
  }
  return request ?? {};
};

const wantsLiveLoginState = (request: WorkbenchBrowserAgentModeRequest): boolean =>
  request.useLiveLoginState === true || request.authState === "borrowLiveLogin";


export {
  agentTargetAddress,
  agentTargetIsLoading,
  agentTargetTitle,
  debuggerSessionKey,
  defaultBrowserMode,
  liveAgentTarget,
  normalizeBrowserAgentModeRequest,
  wantsLiveLoginState
};
