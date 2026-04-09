import {
  BrowserWindow,
  View,
  WebContentsView,
  shell,
  type Rectangle,
  type WebContents
} from "electron";

import type {
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
import type { WorkbenchBrowserPublishEvent, WorkbenchBrowserViewManager } from "./types";

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

export const createWorkbenchBrowserViewManager = ({
  getWindow,
  publishEvent
}: {
  readonly getWindow: () => BrowserWindow | null;
  readonly publishEvent: WorkbenchBrowserPublishEvent;
}): WorkbenchBrowserViewManager => {
  const entries = new Map<string, BrowserPageEntry>();
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
      syncAddress(url);
    });

    webContents.on("did-navigate-in-page", (_event, url) => {
      syncAddress(url);
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

  return {
    dispose: () => {
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
