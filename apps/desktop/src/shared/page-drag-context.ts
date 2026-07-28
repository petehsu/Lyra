import type { WorkbenchBrowserPageContextMediaType } from "./workbench-browser";

export type PageDragContextFields = {
  readonly selectionText?: string;
  readonly linkUrl?: string;
  readonly linkText?: string;
  readonly srcUrl?: string;
  readonly frameUrl?: string;
  readonly mediaType?: WorkbenchBrowserPageContextMediaType;
  readonly elementTag?: string;
  readonly elementSelector?: string;
  readonly elementId?: string;
  readonly elementRole?: string;
  readonly elementAriaLabel?: string;
};

const trim = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const cssEscape = (value: string): string => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
};

const buildElementSelector = (element: Element): string => {
  if (element.id.length > 0) {
    return `#${cssEscape(element.id)}`;
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (current !== null && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const parentElement: Element | null = current.parentElement;
    if (parentElement === null) {
      parts.unshift(tag);
      break;
    }
    const currentTagName = current.tagName;
    const siblings = Array.from(parentElement.children).filter(
      (child): child is Element => child instanceof Element && child.tagName === currentTagName
    );
    const index = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    if (parentElement.id.length > 0) {
      parts.unshift(`#${cssEscape(parentElement.id)}`);
      break;
    }
    current = parentElement;
  }
  return parts.join(" > ");
};

const readElementContext = (element: Element | null): PageDragContextFields => {
  if (element === null) {
    return {};
  }
  const elementTag = element.tagName.toLowerCase();
  const elementId = trim(element.id);
  const elementRole = trim(element.getAttribute("role") ?? "");
  const elementAriaLabel = trim(element.getAttribute("aria-label") ?? "");
  const elementSelector = buildElementSelector(element);
  return {
    ...(elementTag.length > 0 ? { elementTag } : {}),
    ...(elementSelector.length > 0 ? { elementSelector } : {}),
    ...(elementId.length > 0 ? { elementId } : {}),
    ...(elementRole.length > 0 ? { elementRole } : {}),
    ...(elementAriaLabel.length > 0 ? { elementAriaLabel } : {})
  };
};

const resolveMediaType = (target: EventTarget | null): WorkbenchBrowserPageContextMediaType => {
  if (!(target instanceof Element)) {
    return "none";
  }
  if (target.closest("img,picture,svg")) {
    return "image";
  }
  if (target.closest("video")) {
    return "video";
  }
  if (target.closest("audio")) {
    return "audio";
  }
  if (target.closest("canvas")) {
    return "canvas";
  }
  if (target.closest("input[type='file']")) {
    return "file";
  }
  if (target.closest("object,embed")) {
    return "plugin";
  }
  if (target.closest("a[href]")) {
    return "link";
  }
  return "none";
};

export const readPageDragContextFromTarget = (target: EventTarget | null): PageDragContextFields => {
  const element = target instanceof Element ? target : null;
  const anchor = element?.closest("a[href]") ?? null;
  const image =
    element?.closest("img[src]")
    ?? (element instanceof HTMLImageElement ? element : null);
  const selection = trim(window.getSelection?.()?.toString() ?? "");
  const linkUrl = anchor instanceof HTMLAnchorElement ? trim(anchor.href) : "";
  const linkText = anchor instanceof HTMLAnchorElement ? trim(anchor.textContent ?? "") : "";
  const srcUrl = image instanceof HTMLImageElement ? trim(image.currentSrc || image.src) : "";
  const frameUrl = window.top === window ? "" : trim(window.location.href);
  const mediaType = resolveMediaType(target);
  return {
    ...(selection.length > 0 ? { selectionText: selection } : {}),
    ...(linkUrl.length > 0 ? { linkUrl, linkText: linkText.length > 0 ? linkText : linkUrl } : {}),
    ...(srcUrl.length > 0 ? { srcUrl } : {}),
    ...(frameUrl.length > 0 ? { frameUrl } : {}),
    ...(mediaType !== "none" ? { mediaType } : {}),
    ...readElementContext(element)
  };
};
