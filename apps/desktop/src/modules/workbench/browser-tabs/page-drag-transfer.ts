import {
  PAGE_DRAG_CITATION_MIME,
  PAGE_DRAG_CITATION_PLAIN_PREFIX,
  PAGE_DRAG_CITATION_PLAIN_SUFFIX,
  type PageDragCitationPayload,
  type WorkbenchBrowserPageContextMediaType
} from "../../../shared/workbench-browser";
import { setPageDragCitationSessionActive } from "./page-drag-citation-session";

export { PAGE_DRAG_CITATION_MIME };
export type { PageDragCitationPayload };

const encodePageDragCitationPlain = (payload: PageDragCitationPayload): string =>
  `${PAGE_DRAG_CITATION_PLAIN_PREFIX}${JSON.stringify(payload)}${PAGE_DRAG_CITATION_PLAIN_SUFFIX}`;

const decodePageDragCitationPlain = (raw: string): PageDragCitationPayload | null => {
  const trimmed = raw.trim();
  if (
    trimmed.startsWith(PAGE_DRAG_CITATION_PLAIN_PREFIX) === false
    || trimmed.endsWith(PAGE_DRAG_CITATION_PLAIN_SUFFIX) === false
  ) {
    return null;
  }
  const json = trimmed.slice(
    PAGE_DRAG_CITATION_PLAIN_PREFIX.length,
    trimmed.length - PAGE_DRAG_CITATION_PLAIN_SUFFIX.length
  );
  try {
    const parsed = JSON.parse(json) as unknown;
    if (isPageDragCitationPayload(parsed) === false) {
      return null;
    }
    return normalizePayload(parsed);
  } catch (_error) {
    return null;
  }
};

let activePageDragCitationPayload: PageDragCitationPayload | null = null;

type PageDragCitationMainBridge = {
  readonly readActive: () => PageDragCitationPayload | null;
  readonly consume: () => void;
};

let pageDragCitationMainBridge: PageDragCitationMainBridge | null = null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const optionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const normalizeMediaType = (
  value: unknown
): WorkbenchBrowserPageContextMediaType | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  switch (value) {
    case "none":
    case "image":
    case "video":
    case "audio":
    case "canvas":
    case "file":
    case "plugin":
      return value;
    default:
      return undefined;
  }
};

const isPageDragCitationPayload = (value: unknown): value is PageDragCitationPayload => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return isNonEmptyString(payload.tabId)
    && isNonEmptyString(payload.pageUrl);
};

const normalizePayload = (payload: PageDragCitationPayload): PageDragCitationPayload | null => {
  const tabId = payload.tabId.trim();
  const pageUrl = payload.pageUrl.trim();
  const pageTitle = payload.pageTitle.trim();
  if (tabId.length === 0 || pageUrl.length === 0) {
    return null;
  }
  const mediaType = normalizeMediaType(payload.mediaType);
  const frameUrl = optionalString(payload.frameUrl);
  const selectionText = optionalString(payload.selectionText);
  const linkUrl = optionalString(payload.linkUrl);
  const linkText = optionalString(payload.linkText);
  const srcUrl = optionalString(payload.srcUrl);
  const elementTag = optionalString(payload.elementTag);
  const elementSelector = optionalString(payload.elementSelector);
  const elementId = optionalString(payload.elementId);
  const elementRole = optionalString(payload.elementRole);
  const elementAriaLabel = optionalString(payload.elementAriaLabel);
  return {
    tabId,
    pageUrl,
    pageTitle: pageTitle.length > 0 ? pageTitle : pageUrl,
    ...(frameUrl === undefined ? {} : { frameUrl }),
    ...(selectionText === undefined ? {} : { selectionText }),
    ...(linkUrl === undefined ? {} : { linkUrl }),
    ...(linkText === undefined ? {} : { linkText }),
    ...(srcUrl === undefined ? {} : { srcUrl }),
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(elementTag === undefined ? {} : { elementTag }),
    ...(elementSelector === undefined ? {} : { elementSelector }),
    ...(elementId === undefined ? {} : { elementId }),
    ...(elementRole === undefined ? {} : { elementRole }),
    ...(elementAriaLabel === undefined ? {} : { elementAriaLabel })
  };
};

export const writePageDragCitationPayload = (
  dataTransfer: DataTransfer,
  payload: PageDragCitationPayload
): void => {
  const normalized = normalizePayload(payload);
  if (normalized === null) {
    return;
  }
  activePageDragCitationPayload = normalized;
  const encoded = JSON.stringify(normalized);
  dataTransfer.setData(PAGE_DRAG_CITATION_MIME, encoded);
  dataTransfer.setData("text/plain", encodePageDragCitationPlain(normalized));
  dataTransfer.effectAllowed = "copy";
};

const readPageDragCitationJson = (raw: string): PageDragCitationPayload | null => {
  if (raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isPageDragCitationPayload(parsed) === false) {
      return null;
    }
    return normalizePayload(parsed);
  } catch (_error) {
    return null;
  }
};

export const readPageDragCitationPayload = (
  dataTransfer: DataTransfer
): PageDragCitationPayload | null => {
  const fromMime = readPageDragCitationJson(dataTransfer.getData(PAGE_DRAG_CITATION_MIME));
  if (fromMime !== null) {
    return fromMime;
  }

  const fromPlain = decodePageDragCitationPlain(dataTransfer.getData("text/plain"));
  if (fromPlain !== null) {
    return fromPlain;
  }

  return activePageDragCitationPayload === null
    ? null
    : normalizePayload(activePageDragCitationPayload);
};

export const hasPageDragCitationPayload = (dataTransfer: DataTransfer): boolean =>
  Array.from(dataTransfer.types).includes(PAGE_DRAG_CITATION_MIME)
  || activePageDragCitationPayload !== null;

export const setActivePageDragCitationPayload = (
  payload: PageDragCitationPayload | null
): void => {
  if (payload === null) {
    activePageDragCitationPayload = null;
    setPageDragCitationSessionActive(false);
    return;
  }
  const normalized = normalizePayload(payload);
  activePageDragCitationPayload = normalized;
  setPageDragCitationSessionActive(normalized !== null);
};

export const clearPageDragCitationPayload = (): void => {
  activePageDragCitationPayload = null;
  setPageDragCitationSessionActive(false);
};

export const registerPageDragCitationMainBridge = (
  bridge: PageDragCitationMainBridge | null
): void => {
  pageDragCitationMainBridge = bridge;
};

export const hydrateActivePageDragCitationFromMain = (): boolean => {
  if (activePageDragCitationPayload !== null) {
    return true;
  }
  if (pageDragCitationMainBridge === null) {
    return false;
  }
  const payload = pageDragCitationMainBridge.readActive();
  if (payload === null) {
    return false;
  }
  setActivePageDragCitationPayload(payload);
  return true;
};

export const consumeActivePageDragCitation = (): void => {
  clearPageDragCitationPayload();
  pageDragCitationMainBridge?.consume();
};

export const normalizePageDragCitationPayload = (
  raw: unknown
): PageDragCitationPayload | null => {
  if (!isPageDragCitationPayload(raw)) {
    return null;
  }
  return normalizePayload(raw);
};
