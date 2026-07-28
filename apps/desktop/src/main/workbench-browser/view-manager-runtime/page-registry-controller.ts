import {
  WebContentsView,
  shell,
  type BrowserWindow,
  type WebContents
} from "electron";

import type {
  BrowserSessionTabSnapshot,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageDiagnosticEntry,
  WorkbenchBrowserPageLayout,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserPageSpec,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserRecoveryFailure,
  WorkbenchBrowserTopologySnapshot
} from "../../../shared/desktop-bridge";
import { WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION } from "../../../shared/workbench-browser";
import type {
  WorkbenchBrowserDebuggerSession,
  WorkbenchBrowserElementPickerController,
  WorkbenchBrowserPublishEvent
} from "../types";
import { liveAgentTarget } from "./agent-target-runtime";
import {
  areNavigationAddressesEquivalent,
  isSupportedWebUrl,
  normalizeAddress,
  normalizeString,
  resolveBrowserCoreKey,
  toInitialRuntimeState,
  tryFrameworkRouterNavigation
} from "./normalizers";
import { createPageFrameSessionController } from "./page-frame-session-controller";
import type {
  WorkbenchBrowserPageContextMediaType,
  WorkbenchBrowserPageContextMenuPayload
} from "../../../shared/workbench-browser";
import { executePageContextAction } from "./page-context-actions";
import type { BrowserContextMenuLabels } from "../../../shared/browser-context-menu-labels";
import { showNativePageContextMenu } from "./page-context-menu-native";
import { isSafeExternalUrl } from "../../security";

import { resolvePageElementContextAtPoint } from "../page-element-context-resolver";
import type { BrowserPageEntry, BrowserPageTombstone } from "./types";

type TopologySyncResult = {
  readonly previousActiveTabId: string | null;
  readonly topology: WorkbenchBrowserTopologySnapshot;
};

type ListenerBudgetWebContents = WebContents & {
  readonly getMaxListeners?: () => number;
  readonly setMaxListeners?: (count: number) => void;
};

const MIN_BROWSER_PAGE_LISTENER_BUDGET = 256;

const normalizePageContextMediaType = (
  value: string | undefined
): WorkbenchBrowserPageContextMediaType => {
  switch (value) {
    case "image":
    case "video":
    case "audio":
    case "canvas":
    case "file":
    case "plugin":
    case "link":
      return value;
    default:
      return "none";
  }
};

const ensureBrowserPageListenerBudget = (webContents: WebContents): void => {
  const candidate = webContents as ListenerBudgetWebContents;
  if (
    typeof candidate.getMaxListeners !== "function"
    || typeof candidate.setMaxListeners !== "function"
  ) {
    return;
  }
  const current = candidate.getMaxListeners();
  if (current !== 0 && current < MIN_BROWSER_PAGE_LISTENER_BUDGET) {
    candidate.setMaxListeners(MIN_BROWSER_PAGE_LISTENER_BUDGET);
  }
};

type PageRegistryHost = {
  readonly getWindow: () => BrowserWindow | null;
  readonly publishEvent: WorkbenchBrowserPublishEvent;
  readonly onWebContentsCreated: ((tabId: string, webContents: WebContents) => () => void) | undefined;
  readonly syncTopologySnapshot: (snapshot: WorkbenchBrowserTopologySnapshot) => TopologySyncResult;
  readonly syncLayoutSnapshot: (snapshot: WorkbenchBrowserLayoutSnapshot) => void;
  readonly applyLayout: () => void;
  readonly findLayout: (tabId: string) => WorkbenchBrowserPageLayout | null;
  readonly canMaterializePage: (spec: WorkbenchBrowserPageSpec) => boolean;
  readonly getActiveOrFocusedTabId: () => string | null;
  readonly detachEntryView: (entry: BrowserPageEntry) => void;
  readonly readTombstone: (tabId: string) => BrowserPageTombstone | undefined;
  readonly listTombstoneTabIds: () => readonly string[];
  readonly consumeTombstone: (tabId: string) => BrowserPageTombstone | undefined;
  readonly updateDormantTombstone: (
    spec: WorkbenchBrowserPageSpec
  ) => WorkbenchBrowserPageRuntimeState | null;
  readonly deleteTombstone: (tabId: string) => boolean;
  readonly hasTombstone: (tabId: string) => boolean;
  readonly readTombstoneRuntime: (tabId: string) => WorkbenchBrowserPageRuntimeState | null;
  readonly persistedTabSnapshot: (tabId: string) => BrowserSessionTabSnapshot | null;
  readonly scheduleBrowserSessionSnapshotWrite: (delayMs?: number) => void;
  readonly updateRuntimeState: (
    entry: BrowserPageEntry,
    patch: Partial<WorkbenchBrowserPageRuntimeState>
  ) => void;
  readonly publishRuntimeState: (runtime: WorkbenchBrowserPageRuntimeState) => void;
  readonly syncPerformanceRuntimeState: (
    runtime: WorkbenchBrowserPageRuntimeState,
    entry?: BrowserPageEntry
  ) => void;
  readonly cancelPendingAgentPageLoad: (webContents: WebContents) => void;
  readonly captureBrowserRestoreState: (
    entry: BrowserPageEntry
  ) => Promise<WorkbenchBrowserPageRuntimeState["restoreState"] | undefined>;
  readonly restoreNavigationHistory: (
    entry: BrowserPageEntry,
    restoreState: WorkbenchBrowserPageRuntimeState["restoreState"] | undefined
  ) => Promise<boolean>;
  readonly handlePageLoadStopped: (entry: BrowserPageEntry) => void;
  readonly markPendingRestoreValidation: (
    tabId: string,
    restoreState: NonNullable<WorkbenchBrowserPageRuntimeState["restoreState"]> | undefined
  ) => void;
  readonly clearTabSnapshot: (tabId: string) => void;
  readonly destroyBrowserAgentShadow: (tabId: string) => void;
  readonly disposeCdpAuditSession: (
    tabId: string,
    targetMode: "live" | "isolated"
  ) => void;
  readonly disposeDebuggerSession: (
    tabId: string,
    targetMode: "live" | "isolated"
  ) => void;
  readonly invalidateBrowserAgentTargets: (
    tabId: string,
    targetMode: "live" | "isolated",
    reason?: "navigation" | "frameReload"
  ) => void;
  readonly hideChromePopover: (entry: BrowserPageEntry) => void;
  readonly hideTransientChromePopover: (entry: BrowserPageEntry) => void;
  readonly handleElementPickerPageClosed: (tabId: string) => void;
  readonly handleElementPickerPageNavigated: (tabId: string) => void;
  readonly handleElementPickerConsoleMessage: (tabId: string, message: string) => void;
  readonly handleElementPickerActiveTabChanged: (tabId: string | null) => void;
  readonly setElementPickerMode: WorkbenchBrowserElementPickerController["setMode"];
  readonly recordPageDiagnostic: (
    tabId: string,
    entry: Omit<WorkbenchBrowserPageDiagnosticEntry, "id" | "at">
  ) => void;
  readonly handleSharedControlInput: (
    tabId: string,
    inputType: "keyboard" | "mouse_down" | "mouse_move" | "wheel",
    event: { readonly preventDefault?: () => void }
  ) => void;
  readonly clearUserInputDirty: (tabId: string) => void;
  readonly markUserInputDirty: (tabId: string) => void;
  readonly openDebuggerSessionForTarget: (
    entry: ReturnType<typeof liveAgentTarget>
  ) => Promise<WorkbenchBrowserDebuggerSession>;
  readonly unregisterBrowserPageResource: (tabId: string) => void;
  readonly readBrowserContextMenuLabels: () => BrowserContextMenuLabels;
  readonly onBrowserHealthPopup?: (tabId: string, url: string) => void;
  readonly onBrowserHealthCrash?: (tabId: string) => void;
  readonly onBrowserHealthNavigationFailed?: (tabId: string, message: string) => void;
  readonly onBrowserHealthDownload?: (tabId: string, url: string) => void;
  readonly onBrowserHealthTabClosed?: (tabId: string) => void;
};

export const createPageRegistryController = (host: PageRegistryHost) => {
  const entries = new Map<string, BrowserPageEntry>();
  const pendingLoadAddressByTabId = new Map<string, string>();

  const getEntry = (tabId: string): BrowserPageEntry | undefined => entries.get(tabId);

  const hasEntry = (tabId: string): boolean => entries.has(tabId);

  const syncNavigationFlags = (entry: BrowserPageEntry): void => {
    try {
      host.updateRuntimeState(entry, {
        canGoBack: entry.webContents.navigationHistory.canGoBack(),
        canGoForward: entry.webContents.navigationHistory.canGoForward()
      });
    } catch (_error) {
      host.updateRuntimeState(entry, {
        canGoBack: false,
        canGoForward: false
      });
    }
  };

  const destroyEntry = (entry: BrowserPageEntry, emitClosedEvent: boolean): void => {
    if (entry.isDestroyed) {
      return;
    }
    host.onBrowserHealthTabClosed?.(entry.tabId);
    entry.isDestroyed = true;
    pendingLoadAddressByTabId.delete(entry.tabId);
    host.clearTabSnapshot(entry.tabId);
    host.destroyBrowserAgentShadow(entry.tabId);
    host.hideChromePopover(entry);
    host.disposeCdpAuditSession(entry.tabId, "live");
    host.disposeCdpAuditSession(entry.tabId, "isolated");
    host.disposeDebuggerSession(entry.tabId, "live");
    host.disposeDebuggerSession(entry.tabId, "isolated");
    host.invalidateBrowserAgentTargets(entry.tabId, "live", "navigation");
    host.invalidateBrowserAgentTargets(entry.tabId, "isolated", "navigation");
    host.handleElementPickerPageClosed(entry.tabId);
    host.detachEntryView(entry);
    entry.disposeListeners();
    if (entry.webContents.isDestroyed() === false) {
      entry.webContents.close({ waitForBeforeUnload: false });
    }
    if (emitClosedEvent) {
      host.deleteTombstone(entry.tabId);
      host.unregisterBrowserPageResource(entry.tabId);
      host.publishEvent({
        kind: "page-closed",
        tabId: entry.tabId
      });
    }
  };

  const deleteEntry = (tabId: string): void => {
    pendingLoadAddressByTabId.delete(tabId);
    entries.delete(tabId);
  };

  const isNavigationAbortError = (error: unknown): boolean => {
    if (error === null || typeof error !== "object") {
      return false;
    }
    const code = (error as { readonly code?: unknown }).code;
    const errno = (error as { readonly errno?: unknown }).errno;
    return code === "ERR_ABORTED" || code === -3 || errno === -3;
  };

  // Transient connection-noise net_error codes emitted by Chromium while
  // restored tabs fan out and race the real web: modern pages open dozens of
  // TLS sockets at once and servers routinely close idle/preconnect sockets
  // mid-handshake. These fire in clusters at startup/reload and are not Lyra
  // bugs. -3 (ERR_ABORTED) is already silenced above; the codes below are the
  // same class of background churn. We keep a low-severity diagnostic trail
  // (so a genuinely unreachable site is still debuggable) but do NOT surface
  // them as a recovery failure or browser-health event, which would pollute
  // the health UI with transient external-network noise.
  const isTransientConnectionNoise = (errorCode: number): boolean => {
    switch (errorCode) {
      case -3: // ERR_ABORTED (navigation superseded/cancelled)
      case -100: // ERR_CONNECTION_CLOSED
      case -101: // ERR_CONNECTION_RESET
      case -102: // ERR_CONNECTION_REFUSED
      case -103: // ERR_CONNECTION_FAILED
      case -104: // ERR_CONNECTION_ABORTED
      case -107: // ERR_SSL_PROTOCOL_ERROR (mid-handshake reset)
        return true;
      default:
        return false;
    }
  };

  const markRuntimeAddressChanged = (entry: BrowserPageEntry): void => {
    entry.runtimeAddressUpdatedAt = Math.max(Date.now(), entry.lastTopologySyncAt + 1);
  };

  const updateStableAddress = (entry: BrowserPageEntry, address: string): void => {
    markRuntimeAddressChanged(entry);
    host.updateRuntimeState(entry, {
      address,
      title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? address
    });
  };

  const loadRequestedAddress = (entry: BrowserPageEntry): void => {
    if (entry.webContents.isDestroyed()) {
      return;
    }
    const target = entry.requestedAddress;
    const currentUrl = normalizeAddress(entry.webContents.getURL());
    if (currentUrl !== null && areNavigationAddressesEquivalent(currentUrl, target)) {
      updateStableAddress(entry, currentUrl);
      return;
    }
    const pendingTarget = pendingLoadAddressByTabId.get(entry.tabId);
    if (pendingTarget !== undefined && areNavigationAddressesEquivalent(pendingTarget, target)) {
      host.updateRuntimeState(entry, {
        address: currentUrl !== null && currentUrl !== "about:blank" ? currentUrl : entry.runtime.address,
        isLoading: true,
        title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? target
      });
      return;
    }
    markRuntimeAddressChanged(entry);
    host.updateRuntimeState(entry, {
      address: target,
      isLoading: true,
      title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? target
    });
    void host.restoreNavigationHistory(entry, entry.runtime.restoreState)
      .then((restored) => {
        if (restored) {
          return;
        }
        pendingLoadAddressByTabId.set(entry.tabId, target);
        void entry.webContents.loadURL(target).catch((error: unknown) => {
          if (isNavigationAbortError(error)) {
            const nextUrl = normalizeAddress(entry.webContents.getURL());
            if (nextUrl !== null && areNavigationAddressesEquivalent(nextUrl, target)) {
              updateStableAddress(entry, nextUrl);
            }
            return;
          }
          const recoveryFailure: WorkbenchBrowserRecoveryFailure = {
            reason: "navigation_failed",
            message: error instanceof Error ? error.message : String(error),
            at: Date.now()
          };
          console.error(`[lyra-browser] loadURL failed tab=${entry.tabId} url=${target} error=${String(error)}`);
          host.updateRuntimeState(entry, {
            isLoading: false,
            recoveryFailure
          });
        }).finally(() => {
          const pending = pendingLoadAddressByTabId.get(entry.tabId);
          if (pending !== undefined && areNavigationAddressesEquivalent(pending, target)) {
            pendingLoadAddressByTabId.delete(entry.tabId);
          }
        });
      });
  };

  const createEntry = (
    spec: WorkbenchBrowserPageSpec,
    restoredRuntime?: WorkbenchBrowserPageRuntimeState
  ): BrowserPageEntry => {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION,
        sandbox: true,
        spellcheck: true
      }
    });
    const { webContents } = view;
    ensureBrowserPageListenerBudget(webContents);
    const disposeDownloadTracking = host.onWebContentsCreated?.(spec.tabId, webContents) ?? (() => undefined);
    const entry: BrowserPageEntry = {
      tabId: spec.tabId,
      view,
      webContents,
      requestedAddress: spec.address,
      titleHint: spec.titleHint ?? null,
      attached: false,
      viewVisible: false,
      isDestroyed: false,
      layout: null,
      historyRestoreAttempted: false,
      runtime: {
        ...(restoredRuntime ?? toInitialRuntimeState(spec)),
        lifecycleState: spec.isActive ? "restoring" : "hot-hidden",
        isTombstoned: false,
        ...(restoredRuntime === undefined ? {} : { restoreReason: "activated" }),
        updatedAt: Date.now()
      },
      runtimeAddressUpdatedAt: Date.now(),
      lastTopologySyncAt: 0,
      disposeListeners: () => {
        host.cancelPendingAgentPageLoad(webContents);
        disposeDownloadTracking();
        webContents.removeAllListeners("page-title-updated");
        webContents.removeAllListeners("page-favicon-updated");
        webContents.removeAllListeners("did-start-loading");
        webContents.removeAllListeners("did-stop-loading");
        webContents.removeAllListeners("did-fail-load");
        webContents.removeAllListeners("did-navigate");
        webContents.removeAllListeners("did-navigate-in-page");
        webContents.removeAllListeners("did-frame-navigate");
        webContents.removeAllListeners("frame-created");
        webContents.removeAllListeners("console-message");
        webContents.removeAllListeners("context-menu");
        webContents.removeAllListeners("before-mouse-event");
        webContents.removeAllListeners("before-input-event");
        webContents.removeAllListeners("focus");
        webContents.removeAllListeners("enter-html-full-screen");
        webContents.removeAllListeners("leave-html-full-screen");
        webContents.removeAllListeners("render-process-gone");
      }
    };
    host.markPendingRestoreValidation(spec.tabId, restoredRuntime?.restoreState);

    webContents.setWindowOpenHandler(({ url }) => {
      host.onBrowserHealthPopup?.(entry.tabId, url);
      if (isSupportedWebUrl(url)) {
        host.publishEvent({
          kind: "request-open-tab",
          address: url
        });
        return { action: "deny" };
      }
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url).catch(() => undefined);
      }
      return { action: "deny" };
    });

    webContents.on("page-title-updated", (_event, title) => {
      const nextTitle = normalizeString(title) ?? entry.titleHint ?? entry.requestedAddress;
      host.updateRuntimeState(entry, { title: nextTitle });
    });

    webContents.on("page-favicon-updated", (_event, favicons) => {
      const faviconUrl = favicons.find((item) => typeof item === "string" && item.trim().length > 0);
      if (faviconUrl !== undefined) {
        host.updateRuntimeState(entry, { faviconUrl });
      }
    });

    webContents.on("did-start-loading", () => {
      host.hideChromePopover(entry);
      host.updateRuntimeState(entry, { isLoading: true });
      syncNavigationFlags(entry);
    });

    webContents.on("did-stop-loading", () => {
      host.updateRuntimeState(entry, { isLoading: false });
      syncNavigationFlags(entry);
      host.handlePageLoadStopped(entry);
    });

    webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
      if (errorCode === -3) {
        return;
      }
      const message = `${errorDescription || "Page load failed"} (${errorCode})`;
      if (isTransientConnectionNoise(errorCode)) {
        // Keep a debug trail but don't flag health/recovery for transient
        // external connection noise (see isTransientConnectionNoise).
        host.recordPageDiagnostic(entry.tabId, {
          source: "navigation",
          severity: "warning",
          message,
          ...(typeof validatedUrl === "string" && validatedUrl.length > 0 ? { url: validatedUrl } : {})
        });
        host.updateRuntimeState(entry, { isLoading: false });
        return;
      }
      host.onBrowserHealthNavigationFailed?.(entry.tabId, message);
      host.recordPageDiagnostic(entry.tabId, {
        source: "navigation",
        severity: "error",
        message,
        ...(typeof validatedUrl === "string" && validatedUrl.length > 0 ? { url: validatedUrl } : {})
      });
      host.updateRuntimeState(entry, {
        isLoading: false,
        recoveryFailure: {
          reason: "navigation_failed",
          message,
          at: Date.now()
        }
      });
    });

    const syncAddress = (url: string): void => {
      const address = normalizeAddress(url) ?? entry.requestedAddress;
      markRuntimeAddressChanged(entry);
      host.updateRuntimeState(entry, {
        address,
        title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? address
      });
      syncNavigationFlags(entry);
    };

    webContents.on("did-navigate", (_event, url) => {
      host.hideChromePopover(entry);
      host.handleElementPickerPageNavigated(entry.tabId);
      host.invalidateBrowserAgentTargets(entry.tabId, "live", "navigation");
      host.clearUserInputDirty(entry.tabId);
      syncAddress(url);
      void host.captureBrowserRestoreState(entry);
    });

    webContents.on("did-navigate-in-page", (_event, url) => {
      host.hideChromePopover(entry);
      host.handleElementPickerPageNavigated(entry.tabId);
      host.invalidateBrowserAgentTargets(entry.tabId, "live", "navigation");
      syncAddress(url);
      void host.captureBrowserRestoreState(entry);
    });

    webContents.on("did-frame-navigate", (_event, _url, _code, _status, isMainFrame) => {
      if (isMainFrame) {
        return;
      }
      host.invalidateBrowserAgentTargets(entry.tabId, "live", "frameReload");
      void host.captureBrowserRestoreState(entry);
    });

    webContents.on("frame-created", () => {
      host.invalidateBrowserAgentTargets(entry.tabId, "live", "frameReload");
    });

    webContents.on("console-message", (_event, level, message, line, sourceId) => {
      host.handleElementPickerConsoleMessage(entry.tabId, message);
      const severity = level >= 2 ? "error" : level === 1 ? "warning" : "info";
      if (severity !== "info" || String(message).trim().length > 0) {
        host.recordPageDiagnostic(entry.tabId, {
          source: "console",
          severity,
          message:
            String(message) +
            (typeof line === "number" && line > 0 ? ` at ${line}` : ""),
          ...(typeof sourceId === "string" && sourceId.length > 0 ? { url: sourceId } : {})
        });
      }
    });

    webContents.on("context-menu", (event, params) => {
      event.preventDefault();
      void (async () => {
        const layout = entry.layout ?? host.findLayout(entry.tabId);
        const anchorX = (layout?.visible === true ? layout.x : 0) + params.x;
        const anchorY = (layout?.visible === true ? layout.y : 0) + params.y;
        const selectionText = normalizeString(params.selectionText);
        const linkUrl = normalizeString(params.linkURL);
        const linkText = normalizeString(params.linkText);
        const srcUrl = normalizeString(params.srcURL);
        const frameUrl = normalizeString(params.frameURL);
        const mediaType = normalizePageContextMediaType(params.mediaType);
        const elementContext = await resolvePageElementContextAtPoint(
          webContents,
          params.x,
          params.y,
          params.frame
        );
        const elementAriaLabel = normalizeString(params.altText)
          ?? normalizeString(params.titleText)
          ?? elementContext?.elementAriaLabel
          ?? null;
        const menu: WorkbenchBrowserPageContextMenuPayload = {
          tabId: entry.tabId,
          anchorX,
          anchorY,
          pageUrl: normalizeString(params.pageURL) ?? entry.runtime.address,
          pageTitle: entry.runtime.title,
          mediaType,
          isEditable: params.isEditable === true,
          canGoBack: entry.runtime.canGoBack,
          canGoForward: entry.runtime.canGoForward,
          ...(selectionText === null ? {} : { selectionText }),
          ...(linkUrl === null ? {} : { linkUrl }),
          ...(linkText === null ? {} : { linkText }),
          ...(srcUrl === null ? {} : { srcUrl }),
          ...(frameUrl === null ? {} : { frameUrl }),
          ...(elementContext?.elementTag === undefined ? {} : { elementTag: elementContext.elementTag }),
          ...(elementContext?.elementSelector === undefined ? {} : { elementSelector: elementContext.elementSelector }),
          ...(elementContext?.elementId === undefined ? {} : { elementId: elementContext.elementId }),
          ...(elementContext?.elementRole === undefined ? {} : { elementRole: elementContext.elementRole }),
          ...(elementAriaLabel === null ? {} : { elementAriaLabel })
        };
        const window = host.getWindow();
        if (window === null || window.isDestroyed()) {
          return;
        }
        const tabTitle =
          entry.titleHint?.trim()
          || entry.runtime.title?.trim()
          || menu.pageTitle;
        showNativePageContextMenu({
          window,
          entry,
          menu,
          tabTitle,
          labels: host.readBrowserContextMenuLabels(),
          host: {
            publishEvent: host.publishEvent,
            goBack,
            goForward,
            reload
          }
        });
      })();
    });

    webContents.on("before-mouse-event", (event, mouse) => {
      const inputType =
        mouse.type === "mouseMove"
          ? "mouse_move"
          : mouse.type === "mouseWheel"
            ? "wheel"
            : mouse.type === "mouseDown" ? "mouse_down" : null;
      if (inputType !== null) {
        host.handleSharedControlInput(entry.tabId, inputType, event);
      }
      if (mouse.type === "mouseDown" && mouse.button !== "right") {
        host.publishEvent({
          kind: "request-activate-tab",
          tabId: entry.tabId
        });
        host.markUserInputDirty(entry.tabId);
        host.syncPerformanceRuntimeState(entry.runtime, entry);
        host.hideTransientChromePopover(entry);
      }
    });

    webContents.on("before-input-event", (event, input) => {
      if (
        input.type === "keyDown"
        && input.key.toLocaleLowerCase() === "f"
        && (input.control === true || input.meta === true)
        && input.alt !== true
      ) {
        event.preventDefault();
        host.publishEvent({
          kind: "request-page-find",
          tabId: entry.tabId
        });
        return;
      }
      host.markUserInputDirty(entry.tabId);
      host.syncPerformanceRuntimeState(entry.runtime, entry);
      host.handleSharedControlInput(entry.tabId, "keyboard", event);
    });

    webContents.on("focus", () => {
      host.hideTransientChromePopover(entry);
    });

    webContents.on("enter-html-full-screen", () => {
      host.updateRuntimeState(entry, { isHtmlFullscreen: true });
      host.applyLayout();
      const window = host.getWindow();
      if (window !== null) {
        setImmediate(() => {
          if (window.isDestroyed() === false && window.isFullScreen()) {
            window.setFullScreen(false);
          }
        });
      }
    });

    webContents.on("leave-html-full-screen", () => {
      host.updateRuntimeState(entry, { isHtmlFullscreen: false });
      host.applyLayout();
    });

    webContents.on("render-process-gone", () => {
      host.onBrowserHealthCrash?.(entry.tabId);
      destroyEntry(entry, true);
      entries.delete(entry.tabId);
    });

    loadRequestedAddress(entry);

    host.syncPerformanceRuntimeState(entry.runtime, entry);
    host.publishEvent({
      kind: "page-runtime-state",
      page: entry.runtime
    });
    return entry;
  };

  const ensureEntry = (spec: WorkbenchBrowserPageSpec): BrowserPageEntry | null => {
    const existing = entries.get(spec.tabId);
    if (existing !== undefined) {
      existing.titleHint = spec.titleHint ?? existing.titleHint;
      existing.requestedAddress = spec.address;
      host.updateRuntimeState(existing, {
        isActive: spec.isActive,
        coreKey: resolveBrowserCoreKey(spec.address),
        stateKey: `web-state:${spec.tabId}`,
        isTombstoned: false,
        ...(spec.restoreState === undefined ? {} : { restoreState: spec.restoreState }),
        title:
          existing.runtime.title.length > 0
            ? existing.runtime.title
            : spec.titleHint ?? existing.requestedAddress
      });
      return existing;
    }
    const tombstone = host.readTombstone(spec.tabId);
    if (host.canMaterializePage(spec) === false) {
      if (tombstone !== undefined) {
        host.updateDormantTombstone(spec);
      }
      return null;
    }
    const persisted = host.persistedTabSnapshot(spec.tabId);
    const persistedRuntime: WorkbenchBrowserPageRuntimeState | undefined =
      persisted === null
        ? undefined
        : {
            ...toInitialRuntimeState({
              ...spec,
              address: spec.address,
              titleHint: spec.titleHint ?? persisted.title,
              restoreState: spec.restoreState ?? persisted.restoreState
            }),
            address: spec.address,
            title: spec.titleHint ?? persisted.title,
            ...(persisted.faviconUrl === undefined ? {} : { faviconUrl: persisted.faviconUrl }),
            canGoBack: persisted.canGoBack,
            canGoForward: persisted.canGoForward,
            ...(persisted.recoveryFailure === undefined
              ? {}
              : { recoveryFailure: persisted.recoveryFailure })
          };
    const restoredRuntime = tombstone?.runtime ?? persistedRuntime;
    host.consumeTombstone(spec.tabId);
    const entry = createEntry(spec, restoredRuntime);
    entries.set(spec.tabId, entry);
    return entry;
  };

  const syncTopology = (snapshot: WorkbenchBrowserTopologySnapshot): void => {
    const { previousActiveTabId, topology: nextTopology } = host.syncTopologySnapshot(snapshot);
    if (
      previousActiveTabId !== null
      && previousActiveTabId !== nextTopology.activeTabId
    ) {
      const previousEntry = entries.get(previousActiveTabId);
      if (previousEntry !== undefined) {
        host.hideChromePopover(previousEntry);
      }
    }
    host.handleElementPickerActiveTabChanged(nextTopology.activeTabId);

    const nextTabIds = new Set(nextTopology.pages.map((page) => page.tabId));
    for (const [tabId, entry] of entries) {
      if (nextTabIds.has(tabId)) {
        continue;
      }
      // A closed tab has no restore target. Capturing its full DOM snapshot
      // here made rapid tab closes run several expensive page scripts at once.
      destroyEntry(entry, true);
      entries.delete(tabId);
      host.scheduleBrowserSessionSnapshotWrite();
    }
    for (const tabId of host.listTombstoneTabIds()) {
      if (nextTabIds.has(tabId)) {
        continue;
      }
      host.deleteTombstone(tabId);
      host.unregisterBrowserPageResource(tabId);
      host.publishEvent({
        kind: "page-closed",
        tabId
      });
    }

    for (const page of nextTopology.pages) {
      const entry = ensureEntry(page);
      if (entry === null) {
        continue;
      }
      const previousTopologySyncAt = entry.lastTopologySyncAt;
      const runtimeAddressChangedSinceLastSync =
        entry.runtimeAddressUpdatedAt > previousTopologySyncAt;
      const currentUrl = normalizeAddress(entry.webContents.getURL());

      if (entry.runtime.address !== page.address) {
        if (areNavigationAddressesEquivalent(entry.runtime.address, page.address)) {
          host.updateRuntimeState(entry, {
            address:
              currentUrl !== null && areNavigationAddressesEquivalent(currentUrl, page.address)
                ? currentUrl
                : page.address,
            isActive: page.isActive
          });
        } else if (
          runtimeAddressChangedSinceLastSync
          && currentUrl !== null
          && areNavigationAddressesEquivalent(currentUrl, entry.runtime.address)
        ) {
          // In-page navigation (e.g. translation overlays) updated runtime before tab model.
          host.updateRuntimeState(entry, { isActive: page.isActive });
        } else if (
          currentUrl !== null
          && areNavigationAddressesEquivalent(currentUrl, page.address)
        ) {
          markRuntimeAddressChanged(entry);
          host.updateRuntimeState(entry, {
            address: currentUrl,
            isActive: page.isActive,
            title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? currentUrl
          });
        } else {
          entry.requestedAddress = page.address;
          loadRequestedAddress(entry);
        }
      } else {
        host.updateRuntimeState(entry, { isActive: page.isActive });
      }
      entry.lastTopologySyncAt = Math.max(Date.now(), entry.runtimeAddressUpdatedAt);
    }

    host.applyLayout();
  };

  const syncLayout = (snapshot: WorkbenchBrowserLayoutSnapshot): void => {
    host.syncLayoutSnapshot(snapshot);
  };

  const navigateInEntry = async (
    entry: BrowserPageEntry,
    request: WorkbenchBrowserNavigateRequest
  ): Promise<WorkbenchBrowserNavigateResult> => {
    const address = normalizeAddress(request.address);
    if (address === null) {
      throw new Error("address is required");
    }
    if (normalizeString(request.title) !== null) {
      entry.titleHint = normalizeString(request.title);
    }
    if (
      request.useFrameworkRouter === true
      && await tryFrameworkRouterNavigation(entry.webContents, address)
    ) {
      const routedAddress = normalizeAddress(entry.webContents.getURL()) ?? address;
      entry.requestedAddress = routedAddress;
      updateStableAddress(entry, routedAddress);
      return {
        address: routedAddress,
        tabId: entry.tabId,
        title: entry.titleHint ?? entry.runtime.title ?? null
      };
    }
    entry.requestedAddress = address;
    loadRequestedAddress(entry);
    return {
      address,
      tabId: entry.tabId,
      title: entry.titleHint ?? entry.runtime.title ?? null
    };
  };

  const navigate = async (
    request: WorkbenchBrowserNavigateRequest
  ): Promise<WorkbenchBrowserNavigateResult> => {
    const address = normalizeAddress(request.address);
    if (address === null) {
      throw new Error("address is required");
    }
    const requestedTabId = normalizeString(request.tabId);
    const requestedEntry = requestedTabId === null ? null : entries.get(requestedTabId) ?? null;
    if (requestedEntry !== null) {
      return await navigateInEntry(requestedEntry, request);
    }

    if (request.newTab !== true) {
      const targetTabId = host.getActiveOrFocusedTabId();
      const targetEntry = targetTabId === null ? null : entries.get(targetTabId) ?? null;
      if (targetEntry !== null) {
        return await navigateInEntry(targetEntry, request);
      }
    }

    host.publishEvent({
      kind: "request-open-tab",
      address,
      ...(normalizeString(request.title) === null ? {} : { title: normalizeString(request.title)! })
    });
    // ponytail: poll for new entry — request-open-tab is async via renderer,
    // the new tab registers via syncTopology. 3s ceiling; upgrade path is
    // making request-open-tab return a tabId promise directly.
    const knownTabIds = new Set(entries.keys());
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      for (const [tabId, entry] of entries) {
        if (!knownTabIds.has(tabId) && entry.requestedAddress === address) {
          return {
            address,
            tabId,
            title: entry.titleHint ?? entry.runtime.title ?? null
          };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      address,
      tabId: null,
      title: normalizeString(request.title)
    };
  };

  const requireEntry = (tabId: string): BrowserPageEntry => {
    const entry = entries.get(tabId);
    if (entry === undefined || entry.isDestroyed) {
      throw new Error(`Unknown browser tab: ${tabId}`);
    }
    return entry;
  };

  const {
    dispatchNativeInput,
    executeFrameScript,
    fetchWithTabSession,
    findFrame,
    findFrameInWebContents,
    listFrames,
    probeFrameDom,
    resolveFrameGlobalBounds
  } = createPageFrameSessionController({
    entries,
    requireEntry,
    findLayout: host.findLayout
  });


  const goBack = (tabId: string): void => {
    const entry = entries.get(tabId);
    if (
      entry === undefined
      || entry.isDestroyed
      || entry.webContents.navigationHistory.canGoBack() === false
    ) {
      return;
    }
    entry.webContents.navigationHistory.goBack();
    syncNavigationFlags(entry);
  };

  const goForward = (tabId: string): void => {
    const entry = entries.get(tabId);
    if (
      entry === undefined
      || entry.isDestroyed
      || entry.webContents.navigationHistory.canGoForward() === false
    ) {
      return;
    }
    entry.webContents.navigationHistory.goForward();
    syncNavigationFlags(entry);
  };

  const runPageContextAction = (
    request: import("../../../shared/workbench-browser").WorkbenchBrowserExecutePageContextActionRequest
  ): void => {
    const entry = entries.get(request.tabId);
    if (entry === undefined || entry.isDestroyed) {
      return;
    }
    executePageContextAction(
      {
        publishEvent: host.publishEvent,
        goBack,
        goForward,
        reload
      },
      entry,
      request
    );
  };

  const reload = (tabId: string, ignoreCache = false): void => {
    const entry = entries.get(tabId);
    if (entry === undefined || entry.isDestroyed) {
      return;
    }
    if (ignoreCache) {
      entry.webContents.reloadIgnoringCache();
      return;
    }
    entry.webContents.reload();
  };

  const stop = (tabId: string): void => {
    const entry = entries.get(tabId);
    if (entry === undefined || entry.isDestroyed) {
      return;
    }
    entry.webContents.stop();
    host.updateRuntimeState(entry, { isLoading: false });
  };

  const readPageState = (request?: WorkbenchBrowserReadPageStateRequest): WorkbenchBrowserPageRuntimeState | null => {
    const requested = normalizeString(request?.tabId);
    if (requested !== null && (entries.has(requested) || host.hasTombstone(requested))) {
      return entries.get(requested)?.runtime ?? host.readTombstoneRuntime(requested);
    }
    const activeTabId = host.getActiveOrFocusedTabId();
    if (activeTabId !== null && (entries.has(activeTabId) || host.hasTombstone(activeTabId))) {
      return entries.get(activeTabId)?.runtime ?? host.readTombstoneRuntime(activeTabId);
    }
    return null;
  };

  const setElementPickerMode = async (request: Parameters<WorkbenchBrowserElementPickerController["setMode"]>[0]): Promise<void> => {
    const tabId = normalizeString(request?.tabId);
    if (tabId === null || entries.has(tabId) === false) {
      host.publishEvent({
        kind: "element-picker-state",
        state: {
          tabId: tabId ?? "unknown",
          enabled: false,
          cause: "script_error",
          errorCode: "tab_not_found"
        }
      });
      return;
    }
    await host.setElementPickerMode({
      tabId,
      enabled: request.enabled === true,
      ...(request.enabled === true
        ? {
            appearance: request.appearance,
            mode: request.mode
          }
        : {})
    });
  };

  const openDebuggerSession = async (tabId: string): Promise<WorkbenchBrowserDebuggerSession> => {
    const entry = requireEntry(tabId);
    return await host.openDebuggerSessionForTarget(liveAgentTarget(entry));
  };

  const resolvePageDragContextFromWebContents = (
    webContents: WebContents
  ): {
    readonly tabId: string;
    readonly pageUrl: string;
    readonly pageTitle: string;
  } | null => {
    for (const entry of entries.values()) {
      if (entry.isDestroyed || entry.webContents.id !== webContents.id) {
        continue;
      }
      const pageUrl = entry.runtime.address.trim() || entry.requestedAddress.trim();
      const pageTitle = entry.runtime.title.trim() || entry.titleHint?.trim() || pageUrl;
      if (pageUrl.length === 0) {
        return null;
      }
      return {
        tabId: entry.tabId,
        pageUrl,
        pageTitle: pageTitle.length > 0 ? pageTitle : pageUrl
      };
    }
    return null;
  };

  const toggleDevToolsForActivePage = (): boolean => {
    const targetTabId = host.getActiveOrFocusedTabId();
    if (targetTabId === null) {
      return false;
    }
    const entry = entries.get(targetTabId);
    if (entry === undefined || entry.isDestroyed) {
      return false;
    }
    if (entry.webContents.isDevToolsOpened()) {
      entry.webContents.closeDevTools();
    } else {
      entry.webContents.openDevTools({ mode: "detach" });
    }
    return true;
  };

  const dispose = (): void => {
    for (const entry of entries.values()) {
      destroyEntry(entry, false);
    }
    entries.clear();
  };

  return {
    deleteEntry,
    destroyEntry,
    dispatchNativeInput,
    dispose,
    entries,
    executeFrameScript,
    fetchWithTabSession,
    findFrame,
    findFrameInWebContents,
    getEntry,
    goBack,
    goForward,
    hasEntry,
    listFrames,
    navigate,
    navigateInEntry,
    openDebuggerSession,
    probeFrameDom,
    readPageState,
    runPageContextAction,
    reload,
    requireEntry,
    resolvePageDragContextFromWebContents,
    resolveFrameGlobalBounds,
    setElementPickerMode,
    stop,
    syncLayout,
    syncNavigationFlags,
    syncTopology,
    toggleDevToolsForActivePage
  };
};
