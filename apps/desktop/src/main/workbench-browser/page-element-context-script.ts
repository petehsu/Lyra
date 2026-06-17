export type PageElementContext = {
  readonly elementTag?: string;
  readonly elementSelector?: string;
  readonly elementId?: string;
  readonly elementRole?: string;
  readonly elementAriaLabel?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const optionalTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export const normalizePageElementContext = (raw: unknown): PageElementContext | null => {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (!isRecord(raw)) {
    return null;
  }
  const elementTag = optionalTrimmedString(raw.elementTag);
  const elementSelector = optionalTrimmedString(raw.elementSelector);
  const elementId = optionalTrimmedString(raw.elementId);
  const elementRole = optionalTrimmedString(raw.elementRole);
  const elementAriaLabel = optionalTrimmedString(raw.elementAriaLabel);
  if (
    elementTag === undefined
    && elementSelector === undefined
    && elementId === undefined
    && elementRole === undefined
    && elementAriaLabel === undefined
  ) {
    return null;
  }
  return {
    ...(elementTag === undefined ? {} : { elementTag }),
    ...(elementSelector === undefined ? {} : { elementSelector }),
    ...(elementId === undefined ? {} : { elementId }),
    ...(elementRole === undefined ? {} : { elementRole }),
    ...(elementAriaLabel === undefined ? {} : { elementAriaLabel })
  };
};

export const PAGE_ELEMENT_CONTEXT_HELPERS = `
  const trim = (value) => {
    if (typeof value !== "string") return "";
    return value.trim();
  };

  const cssEscape = (value) => {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  };

  const buildElementSelector = (element) => {
    if (!(element instanceof Element)) return "";
    if (element.id) {
      return "#" + cssEscape(element.id);
    }
    const parts = [];
    let current = element;
    while (current instanceof Element && parts.length < 5) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent === null) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
      if (parent.id) {
        parts.unshift("#" + cssEscape(parent.id));
        break;
      }
      current = parent;
    }
    return parts.join(" > ");
  };

  const readElementContext = (element) => {
    if (!(element instanceof Element)) {
      return null;
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
`;

export const buildPageElementContextAtPointScript = (x: number, y: number): string => {
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  return `(function () {
    ${PAGE_ELEMENT_CONTEXT_HELPERS}
    const element = document.elementFromPoint(${roundedX}, ${roundedY});
    return readElementContext(element);
  })();`;
};

export const buildPageElementContextFromTargetScript = (): string => `(function () {
  ${PAGE_ELEMENT_CONTEXT_HELPERS}
  return function readFromTarget(target) {
    const element = target instanceof Element ? target : null;
    return readElementContext(element);
  };
})();`;