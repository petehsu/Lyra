import { ipcMain, type BrowserWindow } from "electron";

import {
  LYRA_CHANNELS,
  type BrowserSessionSnapshot,
  type BrowserStorageStateRef,
  type WorkbenchBrowserChromePopoverRequest,
  type WorkbenchBrowserClearSiteDataRequest,
  type WorkbenchBrowserClearSiteDataResult,
  type WorkbenchBrowserEvent,
  type WorkbenchBrowserLayoutSnapshot,
  type WorkbenchBrowserNavigateRequest,
  type WorkbenchBrowserNavigateResult,
  type WorkbenchBrowserPageRuntimeState,
  type WorkbenchBrowserReadPageStateRequest,
  type WorkbenchBrowserSearchInPageRequest,
  type WorkbenchBrowserSearchInPageResult,
  type WorkbenchBrowserSetElementPickerModeRequest,
  type WorkbenchBrowserStorageStateRequest,
  type WorkbenchBrowserTopologySnapshot,
  type WorkbenchBrowserWebThemeSnapshot
} from "../../shared/desktop-bridge";
import type {
  WorkbenchTabExtractTextResult,
  WorkbenchVisualCaptureResult
} from "../../shared/workbench-observation";
import type {
  BrowserDomSummaryReadOptions,
  BrowserTextExtractOptions
} from "../workbench-observation/browser/types";
import type { DownloadManagerIpcBridge } from "../download-manager";
import type { LoginManagerIpcBridge } from "../login-manager";
import type { LyraPerformanceResourceScheduler } from "../performance";
import type { WorkbenchStateIpcBridge } from "../workbench-state";
import type { WorkbenchObservationBrowserDomSummary } from "../workbench-observation/types";
import { createWorkbenchBrowserViewManager } from "./view-manager";
import type {
  WorkbenchBrowserAgentActionResult,
  WorkbenchBrowserAgentFindResult,
  WorkbenchBrowserAgentFocusDirection,
  WorkbenchBrowserAgentFocusResult,
  WorkbenchBrowserAgentInteraction,
  WorkbenchBrowserAgentLocateResult,
  WorkbenchBrowserAgentObservation,
  WorkbenchBrowserAgentObserveStrategy,
  WorkbenchBrowserAgentPoint,
  WorkbenchBrowserAgentScrollBlock,
  WorkbenchBrowserAgentScrollDirection,
  WorkbenchBrowserAgentScrollResult,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAgentVerification,
  WorkbenchBrowserDebuggerSession,
  WorkbenchBrowserFrameDescriptor,
  WorkbenchBrowserFrameDomProbeResult,
  WorkbenchBrowserFrameGlobalBounds,
  WorkbenchBrowserNativeInputEvent,
  WorkbenchBrowserSessionFetchRequest,
  WorkbenchBrowserSessionFetchResult,
  WorkbenchBrowserViewManager
} from "./types";

const publishEvent = (
  getWindow: () => BrowserWindow | null,
  event: WorkbenchBrowserEvent
): void => {
  const window = getWindow();
  if (window === null || window.isDestroyed()) {
    return;
  }
  window.webContents.send(LYRA_CHANNELS.workbenchBrowserEvent, event);
};

export type WorkbenchBrowserIpcBridge = {
  readonly dispose: () => void;
  readonly syncTopology: (snapshot: WorkbenchBrowserTopologySnapshot) => void;
  readonly syncLayout: (snapshot: WorkbenchBrowserLayoutSnapshot) => void;
  readonly navigate: (
    request: WorkbenchBrowserNavigateRequest
  ) => Promise<WorkbenchBrowserNavigateResult>;
  readonly goBack: (tabId: string) => void;
  readonly goForward: (tabId: string) => void;
  readonly reload: (tabId: string, ignoreCache?: boolean) => void;
  readonly stop: (tabId: string) => void;
  readonly readPageState: (
    request?: WorkbenchBrowserReadPageStateRequest
  ) => WorkbenchBrowserPageRuntimeState | null;
  readonly readSessionSnapshot: () => BrowserSessionSnapshot | null;
  readonly readStorageState: (
    request?: WorkbenchBrowserStorageStateRequest
  ) => Promise<BrowserStorageStateRef>;
  readonly clearSiteData: (
    request: WorkbenchBrowserClearSiteDataRequest
  ) => Promise<WorkbenchBrowserClearSiteDataResult>;
  readonly searchInPage: (
    request: WorkbenchBrowserSearchInPageRequest
  ) => Promise<WorkbenchBrowserSearchInPageResult>;
  readonly setChromePopover: (
    request: WorkbenchBrowserChromePopoverRequest
  ) => Promise<void>;
  readonly setElementPickerMode: (
    request: WorkbenchBrowserSetElementPickerModeRequest
  ) => Promise<void>;
  readonly applyWebTheme: (
    snapshot: WorkbenchBrowserWebThemeSnapshot
  ) => Promise<void>;
  readonly readActiveTabId: () => string | null;
  readonly listFrames: (tabId: string) => readonly WorkbenchBrowserFrameDescriptor[];
  readonly probeFrameDom: (
    tabId: string,
    frameTreeNodeId: number,
    options?: { readonly maxChars?: number }
  ) => Promise<WorkbenchBrowserFrameDomProbeResult>;
  readonly executeFrameScript: (
    tabId: string,
    request: {
      readonly script: string;
      readonly frameTreeNodeId?: number;
      readonly userGesture?: boolean;
      readonly timeoutMs?: number;
    }
  ) => Promise<unknown>;
  readonly dispatchNativeInput: (
    tabId: string,
    events: readonly WorkbenchBrowserNativeInputEvent[]
  ) => Promise<void>;
  readonly openDebuggerSession: (tabId: string) => Promise<WorkbenchBrowserDebuggerSession>;
  readonly fetchWithTabSession: (
    tabId: string,
    request: WorkbenchBrowserSessionFetchRequest
  ) => Promise<WorkbenchBrowserSessionFetchResult>;
  readonly readPageDomSummary: (
    tabId: string,
    options?: BrowserDomSummaryReadOptions
  ) => Promise<WorkbenchObservationBrowserDomSummary>;
  readonly extractPageText: (
    tabId: string,
    options?: BrowserTextExtractOptions
  ) => Promise<WorkbenchTabExtractTextResult>;
  readonly capturePage: (tabId: string) => Promise<WorkbenchVisualCaptureResult>;
  readonly readRenderedSnapshot: (payload: unknown) => Promise<unknown>;
  readonly resolveFrameGlobalBounds: (
    tabId: string,
    frameTreeNodeId: number
  ) => Promise<WorkbenchBrowserFrameGlobalBounds | null>;
  readonly reapplyLayout: () => void;
  readonly setModalOcclusionActive: (active: boolean) => void;
  readonly toggleDevToolsForActivePage: () => boolean;
  readonly observeAgentPage: (
    tabId: string,
    request?: {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
      readonly suppressActivity?: boolean;
    }
  ) => Promise<WorkbenchBrowserAgentObservation>;
  readonly findAgentPage: (
    tabId: string,
    request: WorkbenchBrowserSearchInPageRequest & {
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
      readonly authState?: "none" | "borrowLiveLogin";
      readonly useLiveLoginState?: boolean;
    }
  ) => Promise<WorkbenchBrowserAgentFindResult>;
  readonly locateAgentPage: (
    tabId: string,
    request: {
      readonly query: string;
      readonly matchMode?: "exact" | "semantic";
      readonly autoMap?: boolean;
      readonly nearbyLimit?: number;
      readonly reveal?: boolean;
      readonly caseSensitive?: boolean;
      readonly maxMatches?: number;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
      readonly authState?: "none" | "borrowLiveLogin";
      readonly useLiveLoginState?: boolean;
    }
  ) => Promise<WorkbenchBrowserAgentLocateResult>;
  readonly actOnAgentElement: (
    tabId: string,
    request: {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly actOnAgentPoint: (
    tabId: string,
    request: {
      readonly point: WorkbenchBrowserAgentPoint;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly focusAgentPage: (
    tabId: string,
    request: {
      readonly direction: WorkbenchBrowserAgentFocusDirection;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly steps?: number;
      readonly restoreFocus?: boolean;
      readonly timeoutMs?: number;
    }
  ) => Promise<WorkbenchBrowserAgentFocusResult>;
  readonly scrollAgentPage: (
    tabId: string,
    request: {
      readonly direction?: WorkbenchBrowserAgentScrollDirection;
      readonly amount?: number;
      readonly pages?: number;
      readonly block?: WorkbenchBrowserAgentScrollBlock;
      readonly behavior?: "instant" | "smooth";
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly point?: WorkbenchBrowserAgentPoint;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly autoMap?: boolean;
      readonly timeoutMs?: number;
      readonly reason?: "explicit_scroll" | "ensure_visible";
    }
  ) => Promise<WorkbenchBrowserAgentScrollResult>;
  readonly typeIntoAgentElement: (
    tabId: string,
    request: {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly text: string;
      readonly clear?: boolean;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly pressAgentKey: (
    tabId: string,
    request: {
      readonly key: string;
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly navigateAgentPage: WorkbenchBrowserViewManager["navigateAgentPage"];
  readonly readAgentPage: WorkbenchBrowserViewManager["readAgentPage"];
  readonly captureAgentPage: WorkbenchBrowserViewManager["captureAgentPage"];
  readonly showAgentActivity: WorkbenchBrowserViewManager["showAgentActivity"];
  readonly readAgentFollowAudit: WorkbenchBrowserViewManager["readAgentFollowAudit"];
  readonly finishAgentFollowSessions: WorkbenchBrowserViewManager["finishAgentFollowSessions"];
  readonly explainAgentTargetRef: WorkbenchBrowserViewManager["explainAgentTargetRef"];
  readonly auditAgentPageDiagnostics: WorkbenchBrowserViewManager["auditAgentPageDiagnostics"];
  readonly elevateAgentPage: WorkbenchBrowserViewManager["elevateAgentPage"];
  readonly completeElevationSession: WorkbenchBrowserViewManager["completeElevationSession"];
  readonly resolveSharedControlDecision: WorkbenchBrowserViewManager["resolveSharedControlDecision"];
};

export const createWorkbenchBrowserIpcBridge = ({
  getWindow,
  downloadManager,
  loginManager,
  workbenchState,
  performanceScheduler
}: {
  readonly getWindow: () => BrowserWindow | null;
  readonly downloadManager?: DownloadManagerIpcBridge;
  readonly loginManager?: Pick<LoginManagerIpcBridge, "attachWebContents">;
  readonly workbenchState?: Pick<WorkbenchStateIpcBridge, "readState" | "writeState">;
  readonly performanceScheduler?: LyraPerformanceResourceScheduler;
}): WorkbenchBrowserIpcBridge => {
  const manager: WorkbenchBrowserViewManager = createWorkbenchBrowserViewManager({
    getWindow,
    publishEvent: (event) => publishEvent(getWindow, event),
    ...(workbenchState === undefined ? {} : { workbenchState }),
    ...(performanceScheduler === undefined ? {} : { performanceScheduler }),
    ...(
      downloadManager === undefined && loginManager === undefined
        ? {}
        : {
            onWebContentsCreated: (tabId, webContents) => {
              const disposers = [
                downloadManager?.attachWebContents(tabId, webContents),
                loginManager?.attachWebContents(tabId, webContents)
              ].filter((dispose): dispose is () => void => typeof dispose === "function");
              return () => {
                for (const dispose of disposers) {
                  dispose();
                }
              };
            }
          }
    )
  });

  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserSyncTopology, (_event, snapshot: unknown) => {
    manager.syncTopology(snapshot as WorkbenchBrowserTopologySnapshot);
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserSyncLayout, (_event, snapshot: unknown) => {
    manager.syncLayout(snapshot as WorkbenchBrowserLayoutSnapshot);
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserNavigate, async (_event, request: unknown) => {
    return await manager.navigate(request as WorkbenchBrowserNavigateRequest);
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserGoBack, (_event, request: { readonly tabId?: unknown }) => {
    if (typeof request?.tabId === "string") {
      manager.goBack(request.tabId);
    }
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserGoForward, (_event, request: { readonly tabId?: unknown }) => {
    if (typeof request?.tabId === "string") {
      manager.goForward(request.tabId);
    }
  });
  ipcMain.handle(
    LYRA_CHANNELS.workbenchBrowserReload,
    (_event, request: { readonly tabId?: unknown; readonly ignoreCache?: unknown }) => {
      if (typeof request?.tabId === "string") {
        manager.reload(request.tabId, request.ignoreCache === true);
      }
    }
  );
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserStop, (_event, request: { readonly tabId?: unknown }) => {
    if (typeof request?.tabId === "string") {
      manager.stop(request.tabId);
    }
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserReadPageState, (_event, request?: unknown) => {
    return manager.readPageState(request as WorkbenchBrowserReadPageStateRequest | undefined);
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserReadSessionSnapshot, () => {
    return manager.readSessionSnapshot();
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserReadStorageState, async (_event, request?: unknown) => {
    return await manager.readStorageState(request as WorkbenchBrowserStorageStateRequest | undefined);
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserClearSiteData, async (_event, request: unknown) => {
    return await manager.clearSiteData(request as WorkbenchBrowserClearSiteDataRequest);
  });
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserSearchInPage, async (_event, request: unknown) => {
    return await manager.searchInPage(request as WorkbenchBrowserSearchInPageRequest);
  });
  ipcMain.handle(
    LYRA_CHANNELS.workbenchBrowserSetChromePopover,
    async (_event, request: unknown) => {
      await manager.setChromePopover(request as WorkbenchBrowserChromePopoverRequest);
    }
  );
  ipcMain.handle(
    LYRA_CHANNELS.workbenchBrowserSetElementPickerMode,
    async (_event, request: unknown) => {
      await manager.setElementPickerMode(request as WorkbenchBrowserSetElementPickerModeRequest);
    }
  );
  ipcMain.handle(
    LYRA_CHANNELS.workbenchBrowserSetModalOcclusion,
    (_event, request: { readonly active?: unknown }) => {
      manager.setModalOcclusionActive(request?.active === true);
    }
  );
  ipcMain.handle(
    LYRA_CHANNELS.workbenchBrowserApplyWebTheme,
    async (_event, request: unknown) => {
      await manager.applyWebTheme(request as WorkbenchBrowserWebThemeSnapshot);
    }
  );
  ipcMain.handle(
    LYRA_CHANNELS.workbenchBrowserCapturePage,
    async (_event, request: { readonly tabId?: unknown } | undefined) => {
      const tabId = typeof request?.tabId === "string" ? request.tabId : manager.readActiveTabId();
      if (tabId === null) {
        throw new Error("tab_not_found");
      }
      return await manager.capturePage(tabId);
    }
  );
  ipcMain.handle(LYRA_CHANNELS.workbenchBrowserCaptureWindow, async () => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      throw new Error("renderer_bridge_unavailable");
    }
    const image = await window.webContents.capturePage();
    const size = image.getSize();
    return {
      tabId: "lyra-window",
      mimeType: "image/png",
      imageBase64: image.toPNG().toString("base64"),
      width: size.width,
      height: size.height,
      visibleOnly: true
    } satisfies WorkbenchVisualCaptureResult;
  });

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserSyncTopology);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserSyncLayout);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserNavigate);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserGoBack);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserGoForward);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserReload);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserStop);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserReadPageState);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserReadSessionSnapshot);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserReadStorageState);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserClearSiteData);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserSearchInPage);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserSetChromePopover);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserSetElementPickerMode);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserSetModalOcclusion);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserApplyWebTheme);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserCapturePage);
      ipcMain.removeHandler(LYRA_CHANNELS.workbenchBrowserCaptureWindow);
      manager.dispose();
    },
    syncTopology: manager.syncTopology,
    syncLayout: manager.syncLayout,
    navigate: manager.navigate,
    goBack: manager.goBack,
    goForward: manager.goForward,
    reload: manager.reload,
    stop: manager.stop,
    readPageState: manager.readPageState,
    readSessionSnapshot: manager.readSessionSnapshot,
    readStorageState: manager.readStorageState,
    clearSiteData: manager.clearSiteData,
    searchInPage: manager.searchInPage,
    setChromePopover: manager.setChromePopover,
    setElementPickerMode: manager.setElementPickerMode,
    applyWebTheme: manager.applyWebTheme,
    readActiveTabId: manager.readActiveTabId,
    listFrames: manager.listFrames,
    probeFrameDom: manager.probeFrameDom,
    executeFrameScript: manager.executeFrameScript,
    dispatchNativeInput: manager.dispatchNativeInput,
    openDebuggerSession: manager.openDebuggerSession,
    fetchWithTabSession: manager.fetchWithTabSession,
    readPageDomSummary: manager.readPageDomSummary,
    extractPageText: manager.extractPageText,
    capturePage: manager.capturePage,
    readRenderedSnapshot: manager.readRenderedSnapshot,
    resolveFrameGlobalBounds: manager.resolveFrameGlobalBounds,
    reapplyLayout: manager.reapplyLayout,
    setModalOcclusionActive: manager.setModalOcclusionActive,
    toggleDevToolsForActivePage: manager.toggleDevToolsForActivePage,
    observeAgentPage: manager.observeAgentPage,
    actOnAgentElement: manager.actOnAgentElement,
    actOnAgentPoint: manager.actOnAgentPoint,
    focusAgentPage: manager.focusAgentPage,
    scrollAgentPage: manager.scrollAgentPage,
    typeIntoAgentElement: manager.typeIntoAgentElement,
    pressAgentKey: manager.pressAgentKey,
    navigateAgentPage: manager.navigateAgentPage,
    readAgentPage: manager.readAgentPage,
    findAgentPage: manager.findAgentPage,
    locateAgentPage: manager.locateAgentPage,
    captureAgentPage: manager.captureAgentPage,
    showAgentActivity: manager.showAgentActivity,
    readAgentFollowAudit: manager.readAgentFollowAudit,
    finishAgentFollowSessions: manager.finishAgentFollowSessions,
    explainAgentTargetRef: manager.explainAgentTargetRef,
    auditAgentPageDiagnostics: manager.auditAgentPageDiagnostics,
    elevateAgentPage: manager.elevateAgentPage,
    completeElevationSession: manager.completeElevationSession,
    resolveSharedControlDecision: manager.resolveSharedControlDecision
  };
};
