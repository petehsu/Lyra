import type { WorkbenchWebSelectorAddress } from "../../shared/workbench-web-automation";

type SelectorPathSegment =
  | { readonly kind: "root" }
  | { readonly kind: "shadow" }
  | { readonly kind: "dom-child"; readonly index: number };

const DOM_CHILD_PREFIX = "d:";

export const parseSelectorPath = (path: string): readonly SelectorPathSegment[] => {
  if (typeof path !== "string" || path.trim().length === 0) {
    return [];
  }
  const parts = path.split("/").map((part) => part.trim()).filter((part) => part.length > 0);
  const segments: SelectorPathSegment[] = [];
  for (const part of parts) {
    if (part === "r") {
      segments.push({ kind: "root" });
      continue;
    }
    if (part === "s") {
      segments.push({ kind: "shadow" });
      continue;
    }
    if (part.startsWith(DOM_CHILD_PREFIX)) {
      const index = Number(part.slice(DOM_CHILD_PREFIX.length));
      if (Number.isFinite(index) && index >= 0) {
        segments.push({ kind: "dom-child", index: Math.round(index) });
      }
    }
  }
  return segments;
};

export const normalizeSelectorAddress = (
  value: WorkbenchWebSelectorAddress | undefined
): WorkbenchWebSelectorAddress | null => {
  if (value === undefined) {
    return null;
  }
  if (
    typeof value !== "object"
    || value === null
    || typeof value.frameTreeNodeId !== "number"
    || Number.isFinite(value.frameTreeNodeId) === false
    || typeof value.path !== "string"
  ) {
    return null;
  }
  const path = value.path.trim();
  if (path.length === 0 || parseSelectorPath(path).length === 0) {
    return null;
  }
  return {
    frameTreeNodeId: Math.round(value.frameTreeNodeId),
    path
  };
};

export const selectorAddressResolverSource = String.raw`
  const __lyraResolveSelectorAddress = (path) => {
    if (typeof path !== "string" || path.trim().length === 0) {
      return null;
    }
    const segments = path
      .split("/")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (segments.length === 0) {
      return null;
    }

    let container = document;
    let current = null;

    for (const segment of segments) {
      if (segment === "r") {
        current = document.documentElement;
        container = current;
        continue;
      }

      if (segment === "s") {
        if (!(current instanceof Element) || current.shadowRoot == null) {
          return null;
        }
        container = current.shadowRoot;
        continue;
      }

      if (segment.startsWith("d:")) {
        const rawIndex = Number(segment.slice(2));
        if (!Number.isFinite(rawIndex) || rawIndex < 0) {
          return null;
        }
        const index = Math.round(rawIndex);
        const children = Array.from(container.children ?? []);
        if (index >= children.length) {
          return null;
        }
        current = children[index] ?? null;
        if (!(current instanceof Element)) {
          return null;
        }
        container = current;
        continue;
      }

      return null;
    }

    return current instanceof Element ? current : null;
  };
`;
