import type { WebContents } from "electron";

import {
  PAGE_DRAG_CITATION_MIME,
  PAGE_DRAG_CITATION_PLAIN_PREFIX,
  PAGE_DRAG_CITATION_PLAIN_SUFFIX
} from "../../shared/workbench-browser";
import { PAGE_ELEMENT_CONTEXT_HELPERS } from "./page-element-context-script";

export const buildPageDragCitationInstallScript = (tabId: string): string => {
  const serializedTabId = JSON.stringify(tabId);
  const serializedMime = JSON.stringify(PAGE_DRAG_CITATION_MIME);
  const serializedPlainPrefix = JSON.stringify(PAGE_DRAG_CITATION_PLAIN_PREFIX);
  const serializedPlainSuffix = JSON.stringify(PAGE_DRAG_CITATION_PLAIN_SUFFIX);
  return `(function () {
  if (document.documentElement.dataset.lyraPageDragCitation === "1") {
    return;
  }
  document.documentElement.dataset.lyraPageDragCitation = "1";
  const TAB_ID = ${serializedTabId};
  const MIME = ${serializedMime};
  const PLAIN_PREFIX = ${serializedPlainPrefix};
  const PLAIN_SUFFIX = ${serializedPlainSuffix};

  ${PAGE_ELEMENT_CONTEXT_HELPERS}

  const resolveMediaType = (target) => {
    if (!(target instanceof Element)) return "none";
    if (target.closest("img,picture,svg")) return "image";
    if (target.closest("video")) return "video";
    if (target.closest("audio")) return "audio";
    if (target.closest("canvas")) return "canvas";
    if (target.closest("input[type='file']")) return "file";
    if (target.closest("object,embed")) return "plugin";
    if (target.closest("a[href]")) return "link";
    return "none";
  };

  const readDragContext = (target) => {
    const element = target instanceof Element ? target : null;
    const anchor = element?.closest("a[href]") ?? null;
    const image = element?.closest("img[src]") ?? (element instanceof HTMLImageElement ? element : null);
    const selection = trim(window.getSelection?.()?.toString() ?? "");
    const linkUrl = anchor instanceof HTMLAnchorElement ? trim(anchor.href) : "";
    const linkText = anchor instanceof HTMLAnchorElement ? trim(anchor.textContent ?? "") : "";
    const srcUrl = image instanceof HTMLImageElement ? trim(image.currentSrc || image.src) : "";
    const frameUrl = window.top === window ? "" : trim(window.location.href);
    const elementContext = readElementContext(element) ?? {};
    const mediaType = resolveMediaType(element ?? target);
    return {
      selectionText: selection,
      linkUrl,
      linkText,
      srcUrl,
      frameUrl,
      mediaType,
      ...elementContext
    };
  };

  document.addEventListener("dragstart", (event) => {
    const transfer = event.dataTransfer;
    if (transfer === null) return;
    const context = readDragContext(event.target);
    const payload = {
      tabId: TAB_ID,
      pageUrl: trim(window.location.href),
      pageTitle: trim(document.title) || trim(window.location.href),
      ...(context.frameUrl.length > 0 ? { frameUrl: context.frameUrl } : {}),
      ...(context.selectionText.length > 0 ? { selectionText: context.selectionText } : {}),
      ...(context.linkUrl.length > 0 ? { linkUrl: context.linkUrl, linkText: context.linkText || context.linkUrl } : {}),
      ...(context.srcUrl.length > 0 ? { srcUrl: context.srcUrl } : {}),
      ...(context.mediaType !== "none" ? { mediaType: context.mediaType } : {}),
      ...(context.elementTag.length > 0 ? { elementTag: context.elementTag } : {}),
      ...(context.elementSelector.length > 0 ? { elementSelector: context.elementSelector } : {}),
      ...(context.elementId.length > 0 ? { elementId: context.elementId } : {}),
      ...(context.elementRole.length > 0 ? { elementRole: context.elementRole } : {}),
      ...(context.elementAriaLabel.length > 0 ? { elementAriaLabel: context.elementAriaLabel } : {})
    };
    const encoded = JSON.stringify(payload);
    try {
      transfer.setData(MIME, encoded);
      transfer.setData("text/plain", PLAIN_PREFIX + encoded + PLAIN_SUFFIX);
      transfer.effectAllowed = "copy";
    } catch (_error) {
      // Ignore pages that block custom drag payloads.
    }
    const bridge = window.__lyraPageDragCitation;
    if (bridge && typeof bridge.begin === "function") {
      bridge.begin(payload);
    }
  }, true);

})();`;
};

export const installPageDragCitation = async (
  webContents: WebContents,
  tabId: string
): Promise<void> => {
  if (webContents.isDestroyed()) {
    return;
  }
  const script = buildPageDragCitationInstallScript(tabId);
  const frames = webContents.mainFrame.framesInSubtree;
  for (const frame of frames) {
    try {
      await frame.executeJavaScript(script, true);
    } catch (_error) {
      // Cross-origin frames cannot be instrumented.
    }
  }
};
