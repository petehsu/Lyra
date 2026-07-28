import type { WorkbenchBrowserPageContextMediaType } from "../../../../../../shared/workbench-browser";
import { PAGE_DRAG_CITATION_PLAIN_PREFIX } from "../../../../../../shared/workbench-browser";

export type ExternalPageDragCaptureFidelity = "url-only" | "html-parsed";

export type ExternalPageDragPayload = {
  readonly pageUrl: string;
  readonly pageTitle: string;
  readonly selectionText?: string;
  readonly linkUrl?: string;
  readonly linkText?: string;
  readonly srcUrl?: string;
  readonly mediaType?: WorkbenchBrowserPageContextMediaType;
  readonly elementTag?: string;
  readonly captureFidelity: ExternalPageDragCaptureFidelity;
};

const normalizeDragText = (value: string): string => value.replace(/\u00a0/g, " ").trim();

export const isExternalHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const readDataTransferValue = (dataTransfer: DataTransfer, type: string): string => {
  try {
    return dataTransfer.getData(type) ?? "";
  } catch {
    return "";
  }
};

const firstHttpUrlFromUriList = (raw: string): string | null => {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    if (isExternalHttpUrl(trimmed)) {
      return trimmed;
    }
  }
  return null;
};

type HtmlDragContext = {
  readonly linkUrl?: string;
  readonly linkText?: string;
  readonly srcUrl?: string;
  readonly selectionText?: string;
  readonly elementTag?: string;
  readonly mediaType?: WorkbenchBrowserPageContextMediaType;
};

const parseHtmlDragContext = (html: string): HtmlDragContext | null => {
  const trimmed = html.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  const anchor = doc.querySelector("a[href]");
  const image = doc.querySelector("img[src]");

  const linkUrl = anchor instanceof HTMLAnchorElement
    ? normalizeDragText(anchor.href)
    : undefined;
  const linkText = anchor instanceof HTMLAnchorElement
    ? normalizeDragText(anchor.textContent ?? "")
    : undefined;
  const srcUrl = image instanceof HTMLImageElement
    ? normalizeDragText(image.currentSrc || image.src)
    : undefined;

  const bodyText = normalizeDragText(doc.body?.textContent ?? "");
  const selectionText = bodyText.length > 0 && bodyText !== linkText ? bodyText : undefined;

  let elementTag: string | undefined;
  let mediaType: WorkbenchBrowserPageContextMediaType | undefined;
  if (image !== null) {
    elementTag = "img";
    mediaType = "image";
  } else if (anchor !== null) {
    elementTag = "a";
    mediaType = "link";
  }

  const resolvedLinkUrl = linkUrl !== undefined && isExternalHttpUrl(linkUrl) ? linkUrl : undefined;
  const resolvedSrcUrl = srcUrl !== undefined && isExternalHttpUrl(srcUrl) ? srcUrl : undefined;
  const resolvedSelection = selectionText !== undefined && selectionText.length > 0
    ? selectionText
    : undefined;

  if (
    resolvedLinkUrl === undefined
    && resolvedSrcUrl === undefined
    && resolvedSelection === undefined
  ) {
    return null;
  }

  return {
    ...(resolvedLinkUrl === undefined ? {} : { linkUrl: resolvedLinkUrl }),
    ...(linkText !== undefined && linkText.length > 0 ? { linkText } : {}),
    ...(resolvedSrcUrl === undefined ? {} : { srcUrl: resolvedSrcUrl }),
    ...(resolvedSelection === undefined ? {} : { selectionText: resolvedSelection }),
    ...(elementTag === undefined ? {} : { elementTag }),
    ...(mediaType === undefined ? {} : { mediaType })
  };
};

const pageTitleFromUrl = (url: string, fallback?: string): string => {
  const trimmedFallback = fallback?.trim();
  if (trimmedFallback !== undefined && trimmedFallback.length > 0) {
    return trimmedFallback;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const dataTransferHasFilePayload = (dataTransfer: DataTransfer): boolean => {
  if (Array.from(dataTransfer.types).includes("Files") === false) {
    return false;
  }
  return dataTransfer.files.length > 0;
};

const isLyraEncodedPageDragPlain = (raw: string): boolean =>
  raw.trim().startsWith(PAGE_DRAG_CITATION_PLAIN_PREFIX);

export const hasExternalPageDragPayload = (dataTransfer: DataTransfer): boolean =>
  readExternalPageDragPayload(dataTransfer) !== null;

export const readExternalPageDragPayload = (
  dataTransfer: DataTransfer
): ExternalPageDragPayload | null => {
  if (dataTransferHasFilePayload(dataTransfer)) {
    return null;
  }

  const plain = readDataTransferValue(dataTransfer, "text/plain");
  if (isLyraEncodedPageDragPlain(plain)) {
    return null;
  }

  const uriListUrl = firstHttpUrlFromUriList(readDataTransferValue(dataTransfer, "text/uri-list"));
  const html = readDataTransferValue(dataTransfer, "text/html");
  const htmlContext = html.trim().length > 0 ? parseHtmlDragContext(html) : null;
  const plainTrimmed = plain.trim();
  const plainUrl = plainTrimmed.length > 0 && isExternalHttpUrl(plainTrimmed) ? plainTrimmed : null;

  const srcUrl = htmlContext?.srcUrl;
  const resolvedLinkUrl = htmlContext?.linkUrl
    ?? (htmlContext?.elementTag === "a" ? (uriListUrl ?? plainUrl ?? undefined) : undefined);
  const pageUrl = resolvedLinkUrl ?? uriListUrl ?? plainUrl ?? srcUrl ?? null;
  if (pageUrl === null) {
    return null;
  }

  const linkText = htmlContext?.linkText;
  const pageTitle = pageTitleFromUrl(pageUrl, linkText ?? undefined);
  const selectionText = htmlContext?.selectionText
    ?? (plainUrl === null && plainTrimmed.length > 0 ? plainTrimmed : undefined);

  return {
    pageUrl,
    pageTitle,
    ...(selectionText === undefined ? {} : { selectionText }),
    ...(resolvedLinkUrl === undefined ? {} : { linkUrl: resolvedLinkUrl }),
    ...(linkText === undefined ? {} : { linkText }),
    ...(srcUrl === undefined ? {} : { srcUrl }),
    ...(htmlContext?.mediaType === undefined ? {} : { mediaType: htmlContext.mediaType }),
    ...(htmlContext?.elementTag === undefined ? {} : { elementTag: htmlContext.elementTag }),
    captureFidelity: htmlContext === null ? "url-only" : "html-parsed"
  };
};
