import {
  BrowserWindow,
  View,
  WebContentsView,
  shell,
  type Rectangle,
  type WebContents,
  type WebFrameMain
} from "electron";

import type {
  WorkbenchBrowserAgentTargetInfo,
  WorkbenchBrowserEvent,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageLayout,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserPageSpec,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserTopologySnapshot
} from "../../shared/desktop-bridge";
import type {
  WorkbenchTabExtractTextResult,
  WorkbenchVisualCaptureResult
} from "../../shared/workbench-observation";
import type {
  BrowserDomSummaryReadOptions,
  BrowserTextExtractOptions
} from "../workbench-observation/browser/types";
import type { WorkbenchObservationBrowserDomSummary } from "../workbench-observation/types";
import {
  buildFrameDomProbeScript,
  normalizeFrameDomProbeResult
} from "./frame-probe";
import { createWorkbenchBrowserSharedDebuggerSession } from "./debugger";
import { createWorkbenchBrowserElementPickerController } from "./element-picker/controller";
import { extractTextFromPage } from "./page-text-extractor";
import type {
  WorkbenchBrowserDebuggerSession,
  WorkbenchBrowserElementPickerController,
  WorkbenchBrowserFrameGlobalBounds,
  WorkbenchBrowserNativeInputEvent,
  WorkbenchBrowserPublishEvent,
  WorkbenchBrowserViewManager
} from "./types";

type BrowserPageEntry = {
  readonly tabId: string;
  readonly view: WebContentsView;
  readonly webContents: WebContents;
  requestedAddress: string;
  titleHint: string | null;
  attached: boolean;
  isDestroyed: boolean;
  layout: WorkbenchBrowserPageLayout | null;
  runtime: WorkbenchBrowserPageRuntimeState;
  readonly disposeListeners: () => void;
};

const DEFAULT_PAGE_TITLE = "New Tab";

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeNumber = (value: unknown, fallback = 0): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return fallback;
  }
  return Math.round(value);
};

const normalizeAddress = (value: unknown): string | null => {
  const next = normalizeString(value);
  if (next === null) {
    return null;
  }
  try {
    const parsed = new URL(next);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
};

const normalizePageSpec = (value: unknown): WorkbenchBrowserPageSpec | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const tabId = normalizeString(record.tabId);
  const address = normalizeAddress(record.address);
  if (tabId === null || address === null) {
    return null;
  }
  return {
    tabId,
    address,
    ...(normalizeString(record.titleHint) === null
      ? {}
      : { titleHint: normalizeString(record.titleHint)! }),
    isActive: record.isActive === true
  };
};

const normalizeTopology = (value: unknown): WorkbenchBrowserTopologySnapshot => {
  if (value === null || typeof value !== "object") {
    return {
      activeTabId: null,
      pages: []
    };
  }
  const record = value as Record<string, unknown>;
  const pages = Array.isArray(record.pages)
    ? record.pages
        .map(normalizePageSpec)
        .filter((entry): entry is WorkbenchBrowserPageSpec => entry !== null)
    : [];
  const explicitActiveTabId = normalizeString(record.activeTabId);
  const activeTabId =
    explicitActiveTabId !== null && pages.some((page) => page.tabId === explicitActiveTabId)
      ? explicitActiveTabId
      : pages.find((page) => page.isActive)?.tabId ?? null;
  return {
    activeTabId,
    pages
  };
};

const normalizePageLayout = (value: unknown): WorkbenchBrowserPageLayout | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const tabId = normalizeString(record.tabId);
  if (tabId === null) {
    return null;
  }
  const width = Math.max(0, normalizeNumber(record.width));
  const height = Math.max(0, normalizeNumber(record.height));
  return {
    tabId,
    x: normalizeNumber(record.x),
    y: normalizeNumber(record.y),
    width,
    height,
    visible: record.visible === true && width > 0 && height > 0,
    zIndex: normalizeNumber(record.zIndex),
    isFocusedPane: record.isFocusedPane === true
  };
};

const normalizeLayout = (value: unknown): WorkbenchBrowserLayoutSnapshot => {
  if (value === null || typeof value !== "object") {
    return {
      windowWidth: 0,
      windowHeight: 0,
      layouts: []
    };
  }
  const record = value as Record<string, unknown>;
  const layouts = Array.isArray(record.layouts)
    ? record.layouts
        .map(normalizePageLayout)
        .filter((entry): entry is WorkbenchBrowserPageLayout => entry !== null)
    : [];
  return {
    windowWidth: Math.max(0, normalizeNumber(record.windowWidth)),
    windowHeight: Math.max(0, normalizeNumber(record.windowHeight)),
    layouts
  };
};

const toInitialRuntimeState = (spec: WorkbenchBrowserPageSpec): WorkbenchBrowserPageRuntimeState => ({
  tabId: spec.tabId,
  address: spec.address,
  title: spec.titleHint ?? DEFAULT_PAGE_TITLE,
  isActive: spec.isActive,
  isVisible: false,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  isHtmlFullscreen: false,
  updatedAt: Date.now()
});

const runtimeStateEquals = (
  left: WorkbenchBrowserPageRuntimeState,
  right: WorkbenchBrowserPageRuntimeState
): boolean =>
  left.tabId === right.tabId
  && left.address === right.address
  && left.title === right.title
  && left.faviconUrl === right.faviconUrl
  && left.isActive === right.isActive
  && left.isVisible === right.isVisible
  && left.isLoading === right.isLoading
  && left.canGoBack === right.canGoBack
  && left.canGoForward === right.canGoForward
  && left.isHtmlFullscreen === right.isHtmlFullscreen;

const isSupportedWebUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
};

const toBounds = (layout: WorkbenchBrowserPageLayout): Rectangle => ({
  x: layout.x,
  y: layout.y,
  width: Math.max(1, layout.width),
  height: Math.max(1, layout.height)
});

const delay = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const normalizeExecuteScriptTimeoutMs = (value: unknown, fallback = 8_000): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return fallback;
  }
  return Math.max(250, Math.min(30_000, Math.round(value)));
};

const runFrameScriptWithTimeout = async <T>(
  execute: () => Promise<T>,
  timeoutMs: number
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error(`frame script timed out after ${timeoutMs}ms`) as Error & {
        readonly code?: string;
      };
      (error as { code: string }).code = "script_execution_timeout";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([execute(), timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
};

const toNativeInputEvent = (event: WorkbenchBrowserNativeInputEvent):
  | Electron.MouseInputEvent
  | Electron.MouseWheelInputEvent
  | Electron.KeyboardInputEvent => {
  switch (event.type) {
    case "mouseMove":
    case "mouseDown":
    case "mouseUp":
      return {
        type: event.type,
        x: Math.round(event.x),
        y: Math.round(event.y),
        button: event.button ?? "left",
        clickCount: Math.max(1, Math.round(event.clickCount ?? 1))
      };
    case "keyDown":
    case "keyUp":
    case "char":
      return {
        type: event.type,
        keyCode: event.keyCode,
        modifiers: event.modifiers === undefined ? [] : [...event.modifiers]
      };
  }
};

export const createWorkbenchBrowserViewManager = ({
  getWindow,
  publishEvent
}: {
  readonly getWindow: () => BrowserWindow | null;
  readonly publishEvent: WorkbenchBrowserPublishEvent;
}): WorkbenchBrowserViewManager => {
  const entries = new Map<string, BrowserPageEntry>();
  const debuggerSessions = new Map<
    string,
    ReturnType<typeof createWorkbenchBrowserSharedDebuggerSession>
  >();
  const overlayView = new View();
  let overlayAttached = false;
  let topology: WorkbenchBrowserTopologySnapshot = {
    activeTabId: null,
    pages: []
  };
  let layoutSnapshot: WorkbenchBrowserLayoutSnapshot = {
    windowWidth: 0,
    windowHeight: 0,
    layouts: []
  };

  const updateRuntimeState = (
    entry: BrowserPageEntry,
    patch: Partial<WorkbenchBrowserPageRuntimeState>
  ): void => {
    if (entry.isDestroyed) {
      return;
    }
    const nextRuntime: WorkbenchBrowserPageRuntimeState = {
      ...entry.runtime,
      ...patch,
      updatedAt: Date.now()
    };
    if (runtimeStateEquals(entry.runtime, nextRuntime)) {
      return;
    }
    entry.runtime = nextRuntime;
    publishEvent({
      kind: "page-runtime-state",
      page: nextRuntime
    });
  };

  const findLayout = (tabId: string): WorkbenchBrowserPageLayout | null =>
    layoutSnapshot.layouts.find((layout) => layout.tabId === tabId) ?? null;

  const targetTabIdForRead = (request?: WorkbenchBrowserReadPageStateRequest): string | null => {
    const requested = normalizeString(request?.tabId);
    if (requested !== null && entries.has(requested)) {
      return requested;
    }
    if (topology.activeTabId !== null && entries.has(topology.activeTabId)) {
      return topology.activeTabId;
    }
    return topology.pages[0]?.tabId ?? null;
  };

  const getActiveOrFocusedTabId = (): string | null => {
    const focusedLayout = layoutSnapshot.layouts.find(
      (layout) => layout.visible && layout.isFocusedPane
    );
    if (focusedLayout !== undefined && entries.has(focusedLayout.tabId)) {
      return focusedLayout.tabId;
    }
    if (topology.activeTabId !== null && entries.has(topology.activeTabId)) {
      return topology.activeTabId;
    }
    return topology.pages[0]?.tabId ?? null;
  };

  const syncNavigationFlags = (entry: BrowserPageEntry): void => {
    try {
      updateRuntimeState(entry, {
        canGoBack: entry.webContents.navigationHistory.canGoBack(),
        canGoForward: entry.webContents.navigationHistory.canGoForward()
      });
    } catch (_error) {
      updateRuntimeState(entry, {
        canGoBack: false,
        canGoForward: false
      });
    }
  };

  const applyLayout = (): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }

    const rootView = window.contentView;
    const contentBounds = window.getContentBounds();
    const nextOverlayBounds = {
      x: 0,
      y: 0,
      width: Math.max(contentBounds.width, layoutSnapshot.windowWidth, 1),
      height: Math.max(contentBounds.height, layoutSnapshot.windowHeight, 1)
    };
    const currentOverlayBounds = overlayView.getBounds();
    if (
      currentOverlayBounds.x !== nextOverlayBounds.x
      || currentOverlayBounds.y !== nextOverlayBounds.y
      || currentOverlayBounds.width !== nextOverlayBounds.width
      || currentOverlayBounds.height !== nextOverlayBounds.height
    ) {
      overlayView.setBounds(nextOverlayBounds);
    }
    const visibleEntries = layoutSnapshot.layouts
      .filter((layout) => layout.visible)
      .map((layout) => {
        const entry = entries.get(layout.tabId);
        if (entry === undefined || entry.isDestroyed) {
          return null;
        }
        return { entry, layout };
      })
      .filter((value): value is { entry: BrowserPageEntry; layout: WorkbenchBrowserPageLayout } => value !== null)
      .sort((left, right) => {
        const leftOrder = left.layout.zIndex + (left.entry.runtime.isHtmlFullscreen ? 10000 : 0);
        const rightOrder = right.layout.zIndex + (right.entry.runtime.isHtmlFullscreen ? 10000 : 0);
        if (leftOrder === rightOrder) {
          return left.entry.tabId.localeCompare(right.entry.tabId);
        }
        return leftOrder - rightOrder;
      });
    const visibleIds = new Set(visibleEntries.map(({ entry }) => entry.tabId));
    if (visibleEntries.length > 0) {
      if (!overlayAttached) {
        rootView.addChildView(overlayView);
        overlayAttached = true;
      }
      overlayView.setVisible(true);
    } else {
      overlayView.setVisible(false);
    }

    for (const entry of entries.values()) {
      const layout = findLayout(entry.tabId);
      const isVisible = layout?.visible === true;
      entry.layout = layout;
      updateRuntimeState(entry, {
        isActive: topology.activeTabId === entry.tabId,
        isVisible
      });

      if (!isVisible) {
        if (entry.attached) {
          overlayView.removeChildView(entry.view);
          entry.attached = false;
        }
        entry.view.setVisible(false);
      }
    }

    for (const { entry, layout } of visibleEntries) {
      const nextBounds = toBounds(layout);
      const currentBounds = entry.view.getBounds();
      if (
        currentBounds.x !== nextBounds.x
        || currentBounds.y !== nextBounds.y
        || currentBounds.width !== nextBounds.width
        || currentBounds.height !== nextBounds.height
      ) {
        entry.view.setBounds(nextBounds);
      }
      entry.view.setVisible(true);
      if (!entry.attached) {
        overlayView.addChildView(entry.view);
        entry.attached = true;
      }
    }

    const focusTargetId = getActiveOrFocusedTabId();
    if (focusTargetId !== null && visibleIds.has(focusTargetId) && window.isFocused()) {
      const focusTarget = entries.get(focusTargetId);
      if (focusTarget !== undefined && focusTarget.isDestroyed === false) {
        focusTarget.webContents.focus();
      }
    }
  };

  const destroyEntry = (entry: BrowserPageEntry, emitClosedEvent: boolean): void => {
    if (entry.isDestroyed) {
      return;
    }
    entry.isDestroyed = true;
    void debuggerSessions.get(entry.tabId)?.dispose().catch(() => undefined);
    debuggerSessions.delete(entry.tabId);
    elementPickerController.handlePageClosed(entry.tabId);
    const window = getWindow();
    if (window !== null && window.isDestroyed() === false && entry.attached) {
      overlayView.removeChildView(entry.view);
      entry.attached = false;
    }
    entry.disposeListeners();
    if (entry.webContents.isDestroyed() === false) {
      entry.webContents.close({ waitForBeforeUnload: false });
    }
    if (emitClosedEvent) {
      publishEvent({
        kind: "page-closed",
        tabId: entry.tabId
      });
    }
  };

  const loadRequestedAddress = (entry: BrowserPageEntry): void => {
    if (entry.webContents.isDestroyed()) {
      return;
    }
    const target = entry.requestedAddress;
    const currentUrl = normalizeAddress(entry.webContents.getURL());
    if (currentUrl === target) {
      updateRuntimeState(entry, {
        address: currentUrl,
        title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? target
      });
      return;
    }
    updateRuntimeState(entry, {
      address: target,
      isLoading: true,
      title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? target
    });
    void entry.webContents.loadURL(target).catch((error: unknown) => {
      console.error(`[lyra-browser] loadURL failed tab=${entry.tabId} url=${target} error=${String(error)}`);
      updateRuntimeState(entry, { isLoading: false });
    });
  };

  const createEntry = (spec: WorkbenchBrowserPageSpec): BrowserPageEntry => {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true
      }
    });
    const { webContents } = view;
    const entry: BrowserPageEntry = {
      tabId: spec.tabId,
      view,
      webContents,
      requestedAddress: spec.address,
      titleHint: spec.titleHint ?? null,
      attached: false,
      isDestroyed: false,
      layout: null,
      runtime: toInitialRuntimeState(spec),
      disposeListeners: () => {
        webContents.removeAllListeners("page-title-updated");
        webContents.removeAllListeners("page-favicon-updated");
        webContents.removeAllListeners("did-start-loading");
        webContents.removeAllListeners("did-stop-loading");
        webContents.removeAllListeners("did-fail-load");
        webContents.removeAllListeners("did-navigate");
        webContents.removeAllListeners("did-navigate-in-page");
        webContents.removeAllListeners("console-message");
        webContents.removeAllListeners("enter-html-full-screen");
        webContents.removeAllListeners("leave-html-full-screen");
        webContents.removeAllListeners("render-process-gone");
      }
    };

    webContents.setWindowOpenHandler(({ url }) => {
      if (isSupportedWebUrl(url)) {
        publishEvent({
          kind: "request-open-tab",
          address: url
        });
        return { action: "deny" };
      }
      void shell.openExternal(url).catch(() => undefined);
      return { action: "deny" };
    });

    webContents.on("page-title-updated", (_event, title) => {
      const nextTitle = normalizeString(title) ?? entry.titleHint ?? entry.requestedAddress;
      updateRuntimeState(entry, { title: nextTitle });
    });

    webContents.on("page-favicon-updated", (_event, favicons) => {
      const faviconUrl = favicons.find((item) => typeof item === "string" && item.trim().length > 0);
      if (faviconUrl !== undefined) {
        updateRuntimeState(entry, { faviconUrl });
      }
    });

    webContents.on("did-start-loading", () => {
      updateRuntimeState(entry, { isLoading: true });
      syncNavigationFlags(entry);
    });

    webContents.on("did-stop-loading", () => {
      updateRuntimeState(entry, { isLoading: false });
      syncNavigationFlags(entry);
    });

    webContents.on("did-fail-load", (_event, errorCode) => {
      if (errorCode === -3) {
        return;
      }
      updateRuntimeState(entry, { isLoading: false });
    });

    const syncAddress = (url: string): void => {
      const address = normalizeAddress(url) ?? entry.requestedAddress;
      updateRuntimeState(entry, {
        address,
        title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? address
      });
      syncNavigationFlags(entry);
    };

    webContents.on("did-navigate", (_event, url) => {
      elementPickerController.handlePageNavigated(entry.tabId);
      syncAddress(url);
    });

    webContents.on("did-navigate-in-page", (_event, url) => {
      elementPickerController.handlePageNavigated(entry.tabId);
      syncAddress(url);
    });

    webContents.on("console-message", (_event, _level, message) => {
      elementPickerController.handleConsoleMessage(entry.tabId, message);
    });

    webContents.on("enter-html-full-screen", () => {
      updateRuntimeState(entry, { isHtmlFullscreen: true });
      applyLayout();
      const window = getWindow();
      if (window !== null) {
        setImmediate(() => {
          if (window.isDestroyed() === false && window.isFullScreen()) {
            window.setFullScreen(false);
          }
        });
      }
    });

    webContents.on("leave-html-full-screen", () => {
      updateRuntimeState(entry, { isHtmlFullscreen: false });
      applyLayout();
    });

    webContents.on("render-process-gone", () => {
      destroyEntry(entry, true);
      entries.delete(entry.tabId);
    });

    loadRequestedAddress(entry);
    publishEvent({
      kind: "page-runtime-state",
      page: entry.runtime
    });
    return entry;
  };

  const ensureEntry = (spec: WorkbenchBrowserPageSpec): BrowserPageEntry => {
    const existing = entries.get(spec.tabId);
    if (existing !== undefined) {
      existing.titleHint = spec.titleHint ?? existing.titleHint;
      existing.requestedAddress = spec.address;
      updateRuntimeState(existing, {
        isActive: spec.isActive,
        title:
          existing.runtime.title.length > 0
            ? existing.runtime.title
            : spec.titleHint ?? existing.requestedAddress
      });
      return existing;
    }
    const entry = createEntry(spec);
    entries.set(spec.tabId, entry);
    return entry;
  };

  const syncTopology = (snapshot: WorkbenchBrowserTopologySnapshot): void => {
    const nextTopology = normalizeTopology(snapshot);
    topology = nextTopology;
    elementPickerController.handleActiveTabChanged(nextTopology.activeTabId);

    const nextTabIds = new Set(nextTopology.pages.map((page) => page.tabId));
    for (const [tabId, entry] of entries) {
      if (nextTabIds.has(tabId)) {
        continue;
      }
      destroyEntry(entry, true);
      entries.delete(tabId);
    }

    for (const page of nextTopology.pages) {
      const entry = ensureEntry(page);
      if (entry.requestedAddress !== page.address) {
        entry.requestedAddress = page.address;
      }
      if (entry.runtime.address !== page.address) {
        loadRequestedAddress(entry);
      } else {
        updateRuntimeState(entry, { isActive: page.isActive });
      }
    }

    applyLayout();
  };

  const syncLayout = (snapshot: WorkbenchBrowserLayoutSnapshot): void => {
    layoutSnapshot = normalizeLayout(snapshot);
    applyLayout();
  };

  const navigateInEntry = async (
    entry: BrowserPageEntry,
    request: WorkbenchBrowserNavigateRequest
  ): Promise<WorkbenchBrowserNavigateResult> => {
    const address = normalizeAddress(request.address);
    if (address === null) {
      throw new Error("address is required");
    }
    entry.requestedAddress = address;
    if (normalizeString(request.title) !== null) {
      entry.titleHint = normalizeString(request.title);
    }
    loadRequestedAddress(entry);
    return {
      address,
      tabId: entry.tabId,
      title: entry.titleHint ?? entry.runtime.title ?? null
    };
  };

  const requireEntry = (tabId: string): BrowserPageEntry => {
    const entry = entries.get(tabId);
    if (entry === undefined || entry.isDestroyed) {
      throw new Error(`Unknown browser tab: ${tabId}`);
    }
    return entry;
  };

  const findFrame = (
    entry: BrowserPageEntry,
    frameTreeNodeId: number
  ): WebFrameMain | null =>
    entry.webContents.mainFrame.framesInSubtree.find(
      (frame) => frame.frameTreeNodeId === frameTreeNodeId && !frame.isDestroyed()
    ) ?? null;

  const elementPickerController: WorkbenchBrowserElementPickerController =
    createWorkbenchBrowserElementPickerController({
      host: {
        publishEvent,
        listFrames: (tabId) => {
          const entry = requireEntry(tabId);
          return entry.webContents.mainFrame.framesInSubtree
            .filter((frame) => frame.isDestroyed() === false)
            .map((frame) => ({
              frameTreeNodeId: frame.frameTreeNodeId,
              url: frame.url,
              origin: frame.origin,
              name: frame.name,
              ...(frame.parent === null
                ? {}
                : { parentFrameTreeNodeId: frame.parent.frameTreeNodeId }),
              isMainFrame: frame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId
            }));
        },
        executeFrameScript: async (
          tabId,
          request: {
            readonly script: string;
            readonly frameTreeNodeId?: number;
            readonly userGesture?: boolean;
            readonly timeoutMs?: number;
          }
        ) => {
          const entry = requireEntry(tabId);
          const timeoutMs = normalizeExecuteScriptTimeoutMs(request.timeoutMs);
          if (typeof request.frameTreeNodeId === "number" && Number.isFinite(request.frameTreeNodeId)) {
            const frame = findFrame(entry, Math.round(request.frameTreeNodeId));
            if (frame === null) {
              throw new Error(`Unknown browser frame: ${request.frameTreeNodeId}`);
            }
            return await runFrameScriptWithTimeout(
              () => frame.executeJavaScript(request.script, request.userGesture === true),
              timeoutMs
            );
          }
          return await runFrameScriptWithTimeout(
            () => entry.webContents.executeJavaScript(request.script, request.userGesture === true),
            timeoutMs
          );
        }
      }
    });

  const readPageDomSummary = async (
    tabId: string,
    options?: BrowserDomSummaryReadOptions
  ): Promise<WorkbenchObservationBrowserDomSummary> => {
    const entry = requireEntry(tabId);
    const maxChars = Math.max(256, Math.min(24_000, Math.round(options?.maxChars ?? 12_000)));
    const maxLinks = Math.max(1, Math.min(100, Math.round(options?.maxLinks ?? 50)));
    const maxHeadings = Math.max(1, Math.min(80, Math.round(options?.maxHeadings ?? 40)));
    const maxForms = Math.max(1, Math.min(30, Math.round(options?.maxForms ?? 10)));

    try {
      const summary = await entry.webContents.executeJavaScript(`
        (() => {
          const normalizeText = (value) =>
            typeof value === "string"
              ? value.replace(/\\s+/g, " ").trim()
              : "";
          const bodyText = normalizeText(document.body?.innerText ?? "");
          const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
            .map((element) => normalizeText(element.textContent ?? ""))
            .filter((value) => value.length > 0);
          const links = Array.from(document.querySelectorAll("a[href]"))
            .map((element) => ({
              text: normalizeText(element.textContent ?? ""),
              href: typeof element.href === "string" ? element.href : ""
            }))
            .filter((entry) => entry.href.length > 0);
          const forms = Array.from(document.querySelectorAll("form"))
            .map((form) => ({
              action: typeof form.action === "string" && form.action.length > 0 ? form.action : undefined,
              method: typeof form.method === "string" && form.method.length > 0 ? form.method.toLowerCase() : undefined,
              fields: Array.from(form.querySelectorAll("input, textarea, select, button"))
                .map((field) =>
                  normalizeText(
                    field.getAttribute("name")
                    ?? field.getAttribute("aria-label")
                    ?? field.getAttribute("placeholder")
                    ?? field.id
                    ?? field.tagName
                  )
                )
                .filter((value) => value.length > 0)
            }));
          const selectionText = normalizeText(String(window.getSelection?.() ?? ""));
          return {
            domTitle: normalizeText(document.title ?? ""),
            documentLanguage: normalizeText(document.documentElement?.lang ?? ""),
            selectionText,
            headings,
            mainTextExcerpt: bodyText.slice(0, ${maxChars}),
            links: links.slice(0, ${maxLinks}),
            forms: forms.slice(0, ${maxForms}),
            truncated:
              bodyText.length > ${maxChars}
              || headings.length > ${maxHeadings}
              || links.length > ${maxLinks}
              || forms.length > ${maxForms}
          };
        })()
      `, true);

      const record = summary as Record<string, unknown>;
      const headings = Array.isArray(record.headings)
        ? record.headings
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .slice(0, maxHeadings)
        : [];
      const links = Array.isArray(record.links)
        ? record.links
            .map((value) => {
              if (value === null || typeof value !== "object") {
                return null;
              }
              const entry = value as Record<string, unknown>;
              if (typeof entry.href !== "string" || entry.href.trim().length === 0) {
                return null;
              }
              return {
                text: typeof entry.text === "string" ? entry.text : "",
                href: entry.href
              };
            })
            .filter((value): value is { text: string; href: string } => value !== null)
            .slice(0, maxLinks)
        : [];
      const forms = Array.isArray(record.forms)
        ? record.forms
            .map((value) => {
              if (value === null || typeof value !== "object") {
                return null;
              }
              const entry = value as Record<string, unknown>;
              const fields = Array.isArray(entry.fields)
                ? entry.fields.filter((field): field is string => typeof field === "string")
                : [];
              const form: {
                action?: string;
                method?: string;
                fields: readonly string[];
              } = { fields };
              if (typeof entry.action === "string" && entry.action.length > 0) {
                form.action = entry.action;
              }
              if (typeof entry.method === "string" && entry.method.length > 0) {
                form.method = entry.method;
              }
              return form;
            })
            .filter((value): value is { action?: string; method?: string; fields: readonly string[] } => value !== null)
            .slice(0, maxForms)
        : [];

      return {
        ...(typeof record.domTitle === "string" && record.domTitle.length > 0
          ? { domTitle: record.domTitle }
          : {}),
        ...(typeof record.documentLanguage === "string" && record.documentLanguage.length > 0
          ? { documentLanguage: record.documentLanguage }
          : {}),
        ...(typeof record.selectionText === "string" && record.selectionText.length > 0
          ? { selectionText: record.selectionText }
          : {}),
        headings,
        mainTextExcerpt:
          typeof record.mainTextExcerpt === "string" ? record.mainTextExcerpt : "",
        links,
        forms,
        truncated: record.truncated === true
      };
    } catch (_error) {
      return {
        headings: [],
        mainTextExcerpt: "",
        links: [],
        forms: [],
        truncated: false
      };
    }
  };

  const extractPageText = async (
    tabId: string,
    options?: BrowserTextExtractOptions
  ): Promise<WorkbenchTabExtractTextResult> => {
    const entry = requireEntry(tabId);
    return await extractTextFromPage({
      tabId,
      webContents: entry.webContents,
      ...(options === undefined ? {} : { options })
    });
  };

  const capturePage = async (tabId: string): Promise<WorkbenchVisualCaptureResult> => {
    const entry = requireEntry(tabId);
    if (entry.runtime.isVisible === false) {
      throw new Error("background_visual_capture_unsupported");
    }
    const image = await entry.webContents.capturePage();
    const size = image.getSize();
    return {
      tabId,
      mimeType: "image/png",
      imageBase64: image.toPNG().toString("base64"),
      width: size.width,
      height: size.height,
      visibleOnly: true
    };
  };

  return {
    dispose: () => {
      void elementPickerController.dispose();
      for (const session of debuggerSessions.values()) {
        void session.dispose().catch(() => undefined);
      }
      debuggerSessions.clear();
      for (const entry of entries.values()) {
        destroyEntry(entry, false);
      }
      entries.clear();
      const window = getWindow();
      if (window !== null && window.isDestroyed() === false && overlayAttached) {
        window.contentView.removeChildView(overlayView);
        overlayAttached = false;
      }
    },
    syncTopology,
    syncLayout,
    navigate: async (request: WorkbenchBrowserNavigateRequest) => {
      const address = normalizeAddress(request.address);
      if (address === null) {
        throw new Error("address is required");
      }
      const requestedTabId = normalizeString(request.tabId);
      const requestedEntry = requestedTabId === null ? null : entries.get(requestedTabId) ?? null;
      if (requestedEntry !== null) {
        return await navigateInEntry(requestedEntry, request);
      }

      const targetTabId = getActiveOrFocusedTabId();
      const targetEntry = targetTabId === null ? null : entries.get(targetTabId) ?? null;
      if (targetEntry !== null) {
        return await navigateInEntry(targetEntry, request);
      }

      publishEvent({
        kind: "request-open-tab",
        address,
        ...(normalizeString(request.title) === null ? {} : { title: normalizeString(request.title)! })
      });
      return {
        address,
        tabId: null,
        title: normalizeString(request.title)
      };
    },
    goBack: (tabId: string) => {
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
    },
    goForward: (tabId: string) => {
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
    },
    reload: (tabId: string, ignoreCache = false) => {
      const entry = entries.get(tabId);
      if (entry === undefined || entry.isDestroyed) {
        return;
      }
      if (ignoreCache) {
        entry.webContents.reloadIgnoringCache();
        return;
      }
      entry.webContents.reload();
    },
    stop: (tabId: string) => {
      const entry = entries.get(tabId);
      if (entry === undefined || entry.isDestroyed) {
        return;
      }
      entry.webContents.stop();
      updateRuntimeState(entry, { isLoading: false });
    },
    readPageState: (request?: WorkbenchBrowserReadPageStateRequest) => {
      const targetTabId = targetTabIdForRead(request);
      if (targetTabId === null) {
        return null;
      }
      return entries.get(targetTabId)?.runtime ?? null;
    },
    setElementPickerMode: async (request) => {
      const tabId = normalizeString(request?.tabId);
      if (tabId === null || entries.has(tabId) === false) {
        publishEvent({
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
      await elementPickerController.setMode({
        tabId,
        enabled: request.enabled === true,
        ...(request.enabled === true
          ? {
              appearance: request.appearance,
              mode: request.mode
            }
          : {})
      });
    },
    showAgentElementPickerTarget: async (target: WorkbenchBrowserAgentTargetInfo) => {
      const tabId = normalizeString(target?.tabId);
      if (tabId === null || entries.has(tabId) === false) {
        publishEvent({
          kind: "element-picker-state",
          state: {
            tabId: tabId ?? "unknown",
            enabled: false,
            cause: "script_error",
            errorCode: "tab_not_found"
          }
        });
        return false;
      }
      return await elementPickerController.showAgentTarget({
        ...target,
        tabId
      });
    },
    clearAgentElementPickerTarget: async (
      tabId: string,
      options?: { readonly preserveManualMode?: boolean }
    ) => {
      const normalizedTabId = normalizeString(tabId);
      if (normalizedTabId === null || entries.has(normalizedTabId) === false) {
        return;
      }
      await elementPickerController.clearAgentTarget(normalizedTabId, options);
    },
    readActiveTabId: () => getActiveOrFocusedTabId(),
    listFrames: (tabId: string) => {
      const entry = requireEntry(tabId);
      return entry.webContents.mainFrame.framesInSubtree
        .filter((frame) => frame.isDestroyed() === false)
        .map((frame) => ({
          frameTreeNodeId: frame.frameTreeNodeId,
          url: frame.url,
          origin: frame.origin,
          name: frame.name,
          ...(frame.parent === null
            ? {}
            : { parentFrameTreeNodeId: frame.parent.frameTreeNodeId }),
          isMainFrame: frame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId
        }));
    },
    probeFrameDom: async (
      tabId: string,
      frameTreeNodeId: number,
      options?: { readonly maxChars?: number }
    ) => {
      const entry = requireEntry(tabId);
      const frame = findFrame(entry, frameTreeNodeId);
      if (frame === null) {
        throw new Error(`Unknown browser frame: ${frameTreeNodeId}`);
      }
      try {
        const raw = await frame.executeJavaScript(
          buildFrameDomProbeScript({
            maxChars: Math.max(512, Math.min(40_000, Math.round(options?.maxChars ?? 8_000)))
          }),
          true
        );
        return normalizeFrameDomProbeResult(raw);
      } catch (_error) {
        return { embeddedDocuments: [] };
      }
    },
    executeFrameScript: async (
      tabId,
      request: {
        readonly script: string;
        readonly frameTreeNodeId?: number;
        readonly userGesture?: boolean;
        readonly timeoutMs?: number;
      }
    ) => {
      if (typeof request.script !== "string" || request.script.trim().length === 0) {
        throw new Error("script is required");
      }
      const entry = requireEntry(tabId);
      const timeoutMs = normalizeExecuteScriptTimeoutMs(request.timeoutMs);
      if (typeof request.frameTreeNodeId === "number" && Number.isFinite(request.frameTreeNodeId)) {
        const frame = findFrame(entry, Math.round(request.frameTreeNodeId));
        if (frame === null) {
          throw new Error(`Unknown browser frame: ${request.frameTreeNodeId}`);
        }
        return await runFrameScriptWithTimeout(
          () => frame.executeJavaScript(request.script, request.userGesture === true),
          timeoutMs
        );
      }
      return await runFrameScriptWithTimeout(
        () => entry.webContents.executeJavaScript(request.script, request.userGesture === true),
        timeoutMs
      );
    },
    dispatchNativeInput: async (
      tabId: string,
      events: readonly WorkbenchBrowserNativeInputEvent[]
    ) => {
      const entry = requireEntry(tabId);
      entry.webContents.focus();
      for (const event of events) {
        entry.webContents.sendInputEvent(toNativeInputEvent(event));
        await delay(Math.max(0, Math.min(2_000, Math.round(event.delayMs ?? 0))));
      }
    },
    openDebuggerSession: async (tabId: string): Promise<WorkbenchBrowserDebuggerSession> => {
      const entry = requireEntry(tabId);
      const existing = debuggerSessions.get(tabId);
      if (existing !== undefined) {
        return await existing.acquire();
      }
      const created = createWorkbenchBrowserSharedDebuggerSession({
        tabId,
        webContents: entry.webContents,
        readPageAddress: () => entries.get(tabId)?.runtime.address,
      });
      debuggerSessions.set(tabId, created);
      return await created.acquire();
    },
    fetchWithTabSession: async (tabId, request) => {
      const entry = requireEntry(tabId);
      const timeoutMs = Math.max(250, Math.min(30_000, Math.round(request.timeoutMs ?? 10_000)));
      const maxBytes = Math.max(1_024, Math.min(128 * 1024 * 1024, Math.round(request.maxBytes ?? 64 * 1024 * 1024)));
      const response = await entry.webContents.session.fetch(request.url, {
        method: "GET",
        ...(typeof request.referrer === "string" && request.referrer.trim().length > 0
          ? { headers: { referer: request.referrer.trim() } }
          : {}),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const contentLength = Number(response.headers.get("content-length") ?? NaN);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw Object.assign(new Error("document_too_large"), { code: "document_too_large" });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) {
        throw Object.assign(new Error("document_too_large"), { code: "document_too_large" });
      }
      return {
        finalUrl: response.url,
        status: response.status,
        ...(response.headers.get("content-type") === null
          ? {}
          : { mimeType: response.headers.get("content-type") ?? "" }),
        body: buffer
      };
    },
    readPageDomSummary,
    extractPageText,
    capturePage,
    resolveFrameGlobalBounds: async (
      tabId: string,
      frameTreeNodeId: number
    ): Promise<WorkbenchBrowserFrameGlobalBounds | null> => {
      const entry = entries.get(tabId);
      if (entry === undefined || entry.isDestroyed) {
        return null;
      }
      const targetFrame = findFrame(entry, frameTreeNodeId);
      if (targetFrame === null) {
        return null;
      }
      // If this is the main frame, the bounds come from the view layout directly.
      if (targetFrame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId) {
        const layout = findLayout(tabId);
        if (layout === null) {
          return null;
        }
        return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
      }
      // Walk up the frame tree, accumulating iframe element bounds.
      // Each parent frame runs a script to find the child iframe element's position.
      try {
        let currentFrame = targetFrame;
        let accumulatedX = 0;
        let accumulatedY = 0;
        let boundsWidth = 0;
        let boundsHeight = 0;
        let firstIteration = true;
        while (currentFrame.parent !== null && !currentFrame.parent.isDestroyed()) {
          const parentFrame = currentFrame.parent;
          const childFrameTreeNodeId = currentFrame.frameTreeNodeId;
          // Ask parent frame where the child iframe element is located.
          const result = await parentFrame.executeJavaScript(`
            (() => {
              const childFrameId = ${childFrameTreeNodeId};
              const iframes = Array.from(document.querySelectorAll("iframe, frame"));
              for (const iframe of iframes) {
                // Match by name or by iterating WebFrameMain.framesInSubtree
                const rect = iframe.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) {
                  continue;
                }
                // We return the first visible iframe that could match.
                // Electron's contentFrame matching is done by the parent having
                // called executeJavaScript on the correct parent WebFrameMain.
                return {
                  x: Math.round(rect.left),
                  y: Math.round(rect.top),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                  count: iframes.length
                };
              }
              return null;
            })()
          `, false) as { x: number; y: number; width: number; height: number; count: number } | null;
          if (result === null) {
            return null;
          }
          accumulatedX += result.x;
          accumulatedY += result.y;
          if (firstIteration) {
            boundsWidth = result.width;
            boundsHeight = result.height;
            firstIteration = false;
          }
          // If the parent is the main frame, we're done traversing frames.
          if (parentFrame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId) {
            break;
          }
          currentFrame = parentFrame;
        }
        // Add the WebContentsView layout offset (view position within the Electron window).
        const layout = findLayout(tabId);
        if (layout !== null) {
          accumulatedX += layout.x;
          accumulatedY += layout.y;
        }
        return {
          x: accumulatedX,
          y: accumulatedY,
          width: boundsWidth,
          height: boundsHeight
        };
      } catch {
        return null;
      }
    },
    reapplyLayout: () => {
      applyLayout();
    },
    toggleDevToolsForActivePage: () => {
      const targetTabId = getActiveOrFocusedTabId();
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
    }
  };
};
