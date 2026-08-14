import { WebContentsView, type View } from "electron";
import { X509Certificate } from "node:crypto";

import type {
  WorkbenchBrowserCertificateInfo,
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserSecurityLabels,
  WorkbenchBrowserSecurityLevel,
} from "../../../shared/desktop-bridge";
import { DEFAULT_WEB_THEME_SNAPSHOT } from "../../../shared/workbench-browser";
import {
  buildBrowserChromePopoverDocument,
  resolveBrowserChromePopoverHeight,
  resolveBrowserFindPopoverHeight,
  resolveBrowserOmniboxPopoverHeight
} from "../chrome-popover-overlay";
import type { WorkbenchBrowserDebuggerSession, WorkbenchBrowserPublishEvent } from "../types";
import { normalizeString, toBounds } from "./normalizers";
import type { BrowserAgentPageTarget, BrowserPageEntry, BrowserPageFindTarget } from "./types";

export const createChromePopoverRuntime = ({
  overlayView,
  entries,
  publishEvent,
  findLayout,
  requireEntry,
  getActiveOrFocusedTabId,
  clearSearchInPageOverlay,
  openDebuggerSessionForTarget,
  liveAgentTarget
}: {
  readonly overlayView: View;
  readonly entries: Map<string, BrowserPageEntry>;
  readonly publishEvent: WorkbenchBrowserPublishEvent;
  readonly findLayout: (tabId: string) => BrowserPageEntry["layout"];
  readonly requireEntry: (tabId: string) => BrowserPageEntry;
  readonly getActiveOrFocusedTabId: () => string | null;
  readonly clearSearchInPageOverlay: (target: Pick<BrowserPageFindTarget, "webContents">) => Promise<void>;
  readonly openDebuggerSessionForTarget: (target: BrowserAgentPageTarget) => Promise<WorkbenchBrowserDebuggerSession>;
  readonly liveAgentTarget: (entry: BrowserPageEntry) => BrowserAgentPageTarget;
}) => {
  const activeChromePopovers = new Map<string, WorkbenchBrowserChromePopoverRequest>();
  let chromePopoverView: WebContentsView | null = null;
  let chromePopoverViewAttached = false;

const readChromePopoverAnchor = (
  request: WorkbenchBrowserChromePopoverRequest
): WorkbenchBrowserChromePopoverRequest["anchorRect"] | null => {
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
  return chromePopoverView;
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
): "security" | "find" | "omnibox" => {
  if (request?.kind === "find" || request?.kind === "omnibox") {
    return request.kind;
  }
  return "security";
};

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

const securityUnavailableCopy = (
  labels: WorkbenchBrowserSecurityLabels | undefined,
  key: "notHttps" | "noCertificate" | "certificateReadFailed"
): string => {
  switch (key) {
    case "notHttps":
      return labels?.unavailableNotHttps ?? "The current page is not an HTTPS connection.";
    case "certificateReadFailed":
      return labels?.unavailableNoCertificate ?? "Chromium certificate lookup failed.";
    case "noCertificate":
    default:
      return labels?.unavailableNoCertificate
        ?? "Chromium did not return a parsable certificate chain.";
  }
};

const extractCertificateCommonName = (value: string): string | undefined => {
  const match = value
    .split(/\r?\n|,\s*/)
    .map((part) => part.trim())
    .find((part) => part.startsWith("CN="));
  if (match === undefined) {
    return undefined;
  }
  const commonName = match.slice(3).trim();
  return commonName.length === 0 ? undefined : commonName;
};

const parseCertificateInfo = (derBase64: string): WorkbenchBrowserCertificateInfo => {
  const certificate = new X509Certificate(Buffer.from(derBase64, "base64"));
  const subjectCommonName = extractCertificateCommonName(certificate.subject);
  const issuerCommonName = extractCertificateCommonName(certificate.issuer);
  return {
    subject: certificate.subject,
    ...(subjectCommonName === undefined ? {} : { subjectCommonName }),
    issuer: certificate.issuer,
    ...(issuerCommonName === undefined ? {} : { issuerCommonName }),
    validFrom: certificate.validFrom,
    validTo: certificate.validTo,
    serialNumber: certificate.serialNumber,
    fingerprint256: certificate.fingerprint256,
    ...(certificate.subjectAltName === undefined ? {} : { subjectAltName: certificate.subjectAltName })
  };
};

const classifySecurityLevelForUrl = (url: URL): WorkbenchBrowserSecurityLevel => {
  if (url.protocol === "https:") {
    return "secure";
  }
  if (url.protocol === "http:") {
    return "insecure";
  }
  return "system";
};

const readEntrySecurityUrl = (
  entry: BrowserPageEntry,
  request: WorkbenchBrowserChromePopoverRequest
): URL | null => {
  const candidates = [
    normalizeString(entry.webContents.getURL()),
    normalizeString(entry.runtime.address),
    normalizeString(request.security?.address)
  ];
  for (const candidate of candidates) {
    if (candidate === null) {
      continue;
    }
    try {
      return new URL(candidate);
    } catch (_error) {
      // Try the next observed address.
    }
  }
  return null;
};

const enrichSecurityChromePopoverRequest = async (
  entry: BrowserPageEntry,
  request: WorkbenchBrowserChromePopoverRequest
): Promise<WorkbenchBrowserChromePopoverRequest> => {
  if (request.kind !== "security" || request.security === undefined) {
    return request;
  }

  const locale = request.security.locale;
  const {
    certificate: _certificate,
    certificateStatus: _certificateStatus,
    certificateUnavailableReason: _certificateUnavailableReason,
    ...securityInput
  } = request.security;
  const url = readEntrySecurityUrl(entry, request);
  const level = url === null ? request.security.level : classifySecurityLevelForUrl(url);
  const address = url?.toString() ?? request.security.address;
  const scheme = url?.protocol.replace(/:$/, "") ?? request.security.scheme;
  const origin = url?.origin === "null" ? undefined : url?.origin ?? request.security.origin;
  const domain =
    url?.hostname
    ?? normalizeString(request.security.domain)
    ?? normalizeString(request.security.address)
    ?? address;
  const baseSecurity = {
    ...securityInput,
    level,
    address,
    domain,
    ...(locale === undefined ? {} : { locale }),
    ...(scheme === undefined || scheme.length === 0 ? {} : { scheme }),
    ...(origin === undefined || origin.length === 0 ? {} : { origin })
  };

  if (level !== "secure" || url?.protocol !== "https:" || origin === undefined) {
    return {
      ...request,
      security: {
        ...baseSecurity,
        certificateStatus: "not-applicable",
        certificateUnavailableReason: securityUnavailableCopy(securityInput.labels, "notHttps")
      }
    };
  }

  let debuggerSession: WorkbenchBrowserDebuggerSession | null = null;
  try {
    debuggerSession = await openDebuggerSessionForTarget(liveAgentTarget(entry));
    const response = await debuggerSession.sendCommand("Network.getCertificate", { origin });
    const tableNames = response.tableNames;
    const certificateDer =
      Array.isArray(tableNames) && typeof tableNames[0] === "string"
        ? tableNames[0]
        : undefined;
    if (certificateDer === undefined || certificateDer.trim().length === 0) {
      return {
        ...request,
        security: {
          ...baseSecurity,
          certificateStatus: "unavailable",
          certificateUnavailableReason: securityUnavailableCopy(securityInput.labels, "noCertificate")
        }
      };
    }
    return {
      ...request,
      security: {
        ...baseSecurity,
        certificate: parseCertificateInfo(certificateDer),
        certificateStatus: "available"
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...request,
      security: {
        ...baseSecurity,
        certificateStatus: "unavailable",
        certificateUnavailableReason: `${securityUnavailableCopy(securityInput.labels, "certificateReadFailed")} ${message}`
      }
    };
  } finally {
    await debuggerSession?.close().catch(() => undefined);
  }
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
    (request.kind === "security" && request.security === undefined)
    || (request.kind === "find" && request.find === undefined)
    || (request.kind === "omnibox" && request.omnibox === undefined)
  ) {
    throw new Error("chrome_popover_payload_required");
  }
  const popoverRequest = await enrichSecurityChromePopoverRequest(entry, request);
  activeChromePopovers.clear();
  const layout = entry.layout ?? findLayout(tabId);
  const pageBounds =
    layout === null
      ? { x: 0, y: 0, width: 800, height: 600 }
      : toBounds(layout);
  const anchor = readChromePopoverAnchor(popoverRequest);
  const boundaryPadding = 8;
  const anchorLeft = anchor?.left ?? pageBounds.x + boundaryPadding;
  const anchorBottom = anchor?.bottom ?? pageBounds.y + boundaryPadding;
  const anchorTop = anchor?.top ?? pageBounds.y + boundaryPadding;
  const anchorWidth = Math.max(1, Math.round(anchor?.width ?? 340));
  const pageRelativeLeft = anchorLeft - pageBounds.x;
  const pageRelativeBottom = anchorBottom - pageBounds.y;
  const pageRelativeTop = anchorTop - pageBounds.y;
  const isOmniboxLikePopover = popoverRequest.kind === "find" || popoverRequest.kind === "omnibox";
  const popoverWidth =
    isOmniboxLikePopover
      ? Math.max(
          220,
          Math.min(anchorWidth, Math.max(220, pageBounds.width - boundaryPadding * 2))
        )
      : 340;
  const maxPopoverHeight =
    isOmniboxLikePopover
      ? Math.max(54, Math.min(240, pageBounds.height - boundaryPadding * 2))
      : Math.max(160, Math.min(520, pageBounds.height - boundaryPadding * 2));
  const popoverHeight =
    popoverRequest.kind === "find"
      ? resolveBrowserFindPopoverHeight({
          matchCount: popoverRequest.find?.matches.length ?? 0,
          maxHeight: maxPopoverHeight
        })
      : popoverRequest.kind === "omnibox"
      ? resolveBrowserOmniboxPopoverHeight({
          itemCount: popoverRequest.omnibox?.suggestions.length ?? 0,
          maxHeight: maxPopoverHeight
        })
      : resolveBrowserChromePopoverHeight({
          level: popoverRequest.security!.level,
          maxHeight: maxPopoverHeight
        });
  const x = Math.max(
    boundaryPadding,
    Math.min(
      Math.round(pageRelativeLeft),
      Math.max(boundaryPadding, pageBounds.width - popoverWidth - boundaryPadding)
    )
  );
  const spaceBelow = pageBounds.height - pageRelativeBottom - boundaryPadding - 6;
  const preferredY =
    popoverRequest.kind === "find"
      ? anchorTop - popoverHeight - 6
      : popoverRequest.kind === "omnibox"
        ? pageRelativeTop - popoverHeight + 1
        : spaceBelow >= popoverHeight
            ? pageRelativeBottom + 6
            : pageRelativeTop - popoverHeight - 6;
  const y = Math.max(
    boundaryPadding,
    Math.min(
      Math.round(preferredY),
      popoverRequest.kind === "find"
        ? Math.max(boundaryPadding, pageBounds.y + pageBounds.height - popoverHeight - boundaryPadding)
        : Math.max(boundaryPadding, pageBounds.height - popoverHeight - boundaryPadding)
    )
  );
  const view = ensureChromePopoverView();
  view.setBounds({
    x: pageBounds.x + x,
    y: popoverRequest.kind === "find" ? y : pageBounds.y + y,
    width: popoverWidth,
    height: popoverHeight
  });
  attachChromePopoverView(view);
  view.setVisible(true);
  const html = buildBrowserChromePopoverDocument({
    kind: popoverRequest.kind,
    width: popoverWidth,
    height: popoverHeight,
    ...(popoverRequest.security === undefined ? {} : { security: popoverRequest.security }),
    ...(popoverRequest.find === undefined ? {} : { find: popoverRequest.find }),
    ...(popoverRequest.omnibox === undefined ? {} : { omnibox: popoverRequest.omnibox }),
    theme: DEFAULT_WEB_THEME_SNAPSHOT
  });
  await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
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
