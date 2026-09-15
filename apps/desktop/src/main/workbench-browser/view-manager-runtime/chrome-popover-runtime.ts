import { WebContentsView, type BrowserWindow, type View } from "electron";

import type { WorkbenchBrowserChromePopoverRequest } from "../../../shared/desktop-bridge";
import { DEFAULT_WEB_THEME_SNAPSHOT } from "../../../shared/workbench-browser";
import {
  buildBrowserChromePopoverDocument,
  resolveBrowserFindPopoverHeight,
  resolveBrowserOmniboxPopoverHeight
} from "../chrome-popover-overlay";
import type { WorkbenchBrowserPublishEvent } from "../types";
import { resolveChromePopoverWindowBounds } from "./chrome-popover-bounds";
import { normalizeString, toBounds } from "./normalizers";
import type { BrowserPageEntry, BrowserPageFindTarget } from "./types";

export const createChromePopoverRuntime = ({
  overlayView,
  getWindow,
  entries,
  publishEvent,
  findLayout,
  requireEntry,
  getActiveOrFocusedTabId,
  clearSearchInPageOverlay
}: {
  readonly overlayView: View;
  readonly getWindow: () => BrowserWindow | null;
  readonly entries: Map<string, BrowserPageEntry>;
  readonly publishEvent: WorkbenchBrowserPublishEvent;
  readonly findLayout: (tabId: string) => BrowserPageEntry["layout"];
  readonly requireEntry: (tabId: string) => BrowserPageEntry;
  readonly getActiveOrFocusedTabId: () => string | null;
  readonly clearSearchInPageOverlay: (target: Pick<BrowserPageFindTarget, "webContents">) => Promise<void>;
}) => {
  const activeChromePopovers = new Map<string, WorkbenchBrowserChromePopoverRequest>();
  let chromePopoverView: WebContentsView | null = null;
  let chromePopoverViewAttached = false;

const readChromePopoverAnchor = (
  request: WorkbenchBrowserChromePopoverRequest
): NonNullable<WorkbenchBrowserChromePopoverRequest["anchorRect"]> | null => {
  const rect = request.anchorRect;
  if (rect === undefined) {
    return null;
  }
  const values = [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height];
  if (values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return rect;
  }
  return null;
};

const ensureChromePopoverView = (): WebContentsView => {
  if (
    chromePopoverView !== null
    && chromePopoverView.webContents.isDestroyed() === false
  ) {
    return chromePopoverView;
  }
  chromePopoverView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  chromePopoverView.setVisible(false);
  chromePopoverView.setBackgroundColor("#00000000");
  chromePopoverView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  chromePopoverView.webContents.on("will-navigate", (event, url) => {
    if (handleChromePopoverNavigation(url)) {
      event.preventDefault();
    }
  });
  chromePopoverView.webContents.on("focus", () => {
    restoreChromeFocus();
  });
  return chromePopoverView;
};

const restoreChromeFocus = (): void => {
  const window = getWindow();
  if (window === null || window.isDestroyed()) {
    return;
  }
  window.webContents.focus();
};

const attachChromePopoverView = (view: WebContentsView): void => {
  if (!chromePopoverViewAttached) {
    overlayView.addChildView(view);
    chromePopoverViewAttached = true;
    return;
  }
  // Re-adding keeps the popover above page WebContentsViews after layout updates.
  overlayView.removeChildView(view);
  overlayView.addChildView(view);
};

const chromePopoverKindForRequest = (
  request: WorkbenchBrowserChromePopoverRequest | undefined
): "find" | "omnibox" => request?.kind === "find" ? "find" : "omnibox";

const activeFindPopoverEntry = (): {
  readonly tabId: string;
  readonly request: WorkbenchBrowserChromePopoverRequest;
} | null => {
  for (const [tabId, request] of activeChromePopovers.entries()) {
    if (request.kind === "find" && request.find !== undefined) {
      return { tabId, request };
    }
  }
  return null;
};

const activeOmniboxPopoverEntry = (): {
  readonly tabId: string;
  readonly request: WorkbenchBrowserChromePopoverRequest;
} | null => {
  for (const [tabId, request] of activeChromePopovers.entries()) {
    if (request.kind === "omnibox" && request.omnibox !== undefined) {
      return { tabId, request };
    }
  }
  return null;
};

const handleChromePopoverNavigation = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "lyra-omnibox:") {
    const active = activeOmniboxPopoverEntry();
    if (active === null) {
      return true;
    }
    const action = parsed.hostname || parsed.pathname.replace(/^\//u, "");
    if (action !== "suggestion") {
      return true;
    }
    const index = Math.round(Number(parsed.searchParams.get("index") ?? -1));
    if (!Number.isFinite(index) || index < 0) {
      return true;
    }
    publishEvent({
      kind: "request-omnibox-suggestion-select",
      tabId: active.tabId,
      index
    });
    return true;
  }
  if (parsed.protocol !== "lyra-find:") {
    return false;
  }
  const active = activeFindPopoverEntry();
  const activeFind = active?.request.find;
  if (active === null || activeFind === undefined) {
    return true;
  }
  const action = parsed.hostname || parsed.pathname.replace(/^\//u, "");
  void (async () => {
    if (action === "close") {
      await setChromePopover({ ...active.request, tabId: active.tabId, visible: false });
      const entry = entries.get(active.tabId);
      if (entry !== undefined) {
        await clearSearchInPageOverlay(entry);
      }
      return;
    }
    if (action === "match") {
      const requestedIndex = Math.round(Number(
        parsed.searchParams.get("value") ?? activeFind.currentIndex
      ));
      if (Number.isFinite(requestedIndex) && requestedIndex > 0) {
        publishEvent({
          kind: "request-page-find-match-select",
          tabId: active.tabId,
          index: requestedIndex
        });
      }
      return;
    }
  })();
  return true;
};

const detachChromePopoverView = (): void => {
  const view = chromePopoverView;
  if (view === null) {
    chromePopoverViewAttached = false;
    return;
  }
  if (chromePopoverViewAttached) {
    overlayView.removeChildView(view);
    chromePopoverViewAttached = false;
  }
  if (view.webContents.isDestroyed() === false) {
    view.setVisible(false);
    void view.webContents.loadURL("about:blank").catch(() => undefined);
  }
};

const hideChromePopover = (entry: BrowserPageEntry): void => {
  const previous = activeChromePopovers.get(entry.tabId);
  const hadPopover = activeChromePopovers.delete(entry.tabId);
  if (activeChromePopovers.size === 0) {
    detachChromePopoverView();
  }
  if (hadPopover) {
    publishEvent({
      kind: "chrome-popover-state",
      tabId: entry.tabId,
      popoverKind: chromePopoverKindForRequest(previous),
      visible: false
    });
    if (previous?.kind === "find") {
      void clearSearchInPageOverlay(entry);
    }
  }
};

const hideTransientChromePopover = (entry: BrowserPageEntry): void => {
  const previous = activeChromePopovers.get(entry.tabId);
  if (previous?.kind === "find") {
    return;
  }
  hideChromePopover(entry);
};

const setChromePopover = async (
  request: WorkbenchBrowserChromePopoverRequest
): Promise<void> => {
  const tabId = normalizeString(request.tabId) ?? getActiveOrFocusedTabId();
  if (tabId === null) {
    return;
  }
  const entry = requireEntry(tabId);
  if (request.visible !== true) {
    const previous = activeChromePopovers.get(tabId);
    const hadPopover = activeChromePopovers.delete(tabId);
    if (activeChromePopovers.size === 0) {
      detachChromePopoverView();
    }
    if (hadPopover) {
      publishEvent({
        kind: "chrome-popover-state",
        tabId,
        popoverKind: chromePopoverKindForRequest(previous ?? request),
        visible: false
      });
      if ((previous ?? request).kind === "find") {
        await clearSearchInPageOverlay(entry);
      }
    }
    return;
  }
  if (
    (request.kind === "find" && request.find === undefined)
    || (request.kind === "omnibox" && request.omnibox === undefined)
  ) {
    throw new Error("chrome_popover_payload_required");
  }
  const popoverRequest = request;
  activeChromePopovers.clear();
  const layout = entry.layout ?? findLayout(tabId);
  const pageBounds =
    layout === null
      ? { x: 0, y: 0, width: 800, height: 600 }
      : toBounds(layout);
  const window = getWindow();
  const contentSize = window === null || window.isDestroyed()
    ? [pageBounds.x + pageBounds.width, pageBounds.y + pageBounds.height]
    : window.getContentSize();
  const windowSize = {
    width: Math.max(1, contentSize[0] ?? 800),
    height: Math.max(1, contentSize[1] ?? 600)
  };
  const anchor = readChromePopoverAnchor(popoverRequest);
  const popoverWidth = Math.max(1, Math.round(anchor?.width ?? 340));
  const maxPopoverHeight = 240;
  const popoverHeight =
    popoverRequest.kind === "find"
      ? resolveBrowserFindPopoverHeight({
          matchCount: popoverRequest.find?.matches.length ?? 0,
          maxHeight: maxPopoverHeight
        })
      : resolveBrowserOmniboxPopoverHeight({
          itemCount: popoverRequest.omnibox?.suggestions.length ?? 0,
          maxHeight: maxPopoverHeight
        });
  const bounds = resolveChromePopoverWindowBounds({
    kind: popoverRequest.kind,
    anchor,
    windowSize,
    popoverWidth,
    popoverHeight
  });
  const view = ensureChromePopoverView();
  view.setBounds(bounds);
  attachChromePopoverView(view);
  view.setVisible(true);
  const html = buildBrowserChromePopoverDocument({
    kind: popoverRequest.kind,
    width: bounds.width,
    height: bounds.height,
    ...(popoverRequest.find === undefined ? {} : { find: popoverRequest.find }),
    ...(popoverRequest.omnibox === undefined ? {} : { omnibox: popoverRequest.omnibox }),
    theme: popoverRequest.theme ?? DEFAULT_WEB_THEME_SNAPSHOT
  });
  await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  restoreChromeFocus();
  activeChromePopovers.set(tabId, popoverRequest);
  publishEvent({
    kind: "chrome-popover-state",
    tabId,
    popoverKind: popoverRequest.kind,
    visible: true
  });
};


  const reattachVisiblePopover = (): void => {
    if (
      chromePopoverView !== null
      && chromePopoverViewAttached
      && chromePopoverView.webContents.isDestroyed() === false
    ) {
      attachChromePopoverView(chromePopoverView);
    }
  };

  const reapplyActivePopovers = async (): Promise<void> => {
    for (const [tabId, request] of [...activeChromePopovers.entries()]) {
      if (entries.has(tabId)) {
        await setChromePopover({ ...request, tabId, visible: true }).catch(() => {
          activeChromePopovers.delete(tabId);
        });
      }
    }
  };

  const dispose = (): void => {
    activeChromePopovers.clear();
    detachChromePopoverView();
    if (
      chromePopoverView !== null
      && chromePopoverView.webContents.isDestroyed() === false
    ) {
      chromePopoverView.webContents.close({ waitForBeforeUnload: false });
    }
    chromePopoverView = null;
  };

  return {
    dispose,
    hideChromePopover,
    hideTransientChromePopover,
    reapplyActivePopovers,
    reattachVisiblePopover,
    setChromePopover
  };
};
