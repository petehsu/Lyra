export type Rect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

export type AnchorPosition = {
  readonly left: number;
  readonly top: number;
};

const VIEWPORT_PADDING = 6;

const PANE_BOUNDARY_SELECTORS = [
  ".lyra-workspace-split-pane",
  ".lyra-terminal-workspace-surface",
  ".lyra-app-sidebar",
  ".lyra-workbench-shell"
].join(", ");

const clamp = (value: number, min: number, max: number): number => {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

const rectsIntersect = (left: Rect, right: Rect): boolean =>
  left.left < right.right
  && left.right > right.left
  && left.top < right.bottom
  && left.bottom > right.top;

export const readBrowserPageHostRects = (root: ParentNode = document): Rect[] =>
  [...root.querySelectorAll<HTMLElement>('[data-browser-page-host="true"]')]
    .map((host) => host.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom
    }));

export const readContextMenuPaneBoundary = (
  anchorX: number,
  anchorY: number,
  root: ParentNode = document
): Rect => {
  const viewport: Rect = {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight
  };
  if (typeof document.elementsFromPoint !== "function") {
    return viewport;
  }
  const elements = document.elementsFromPoint(anchorX, anchorY);
  for (const element of elements) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    if (element.closest(".lyra-context-menu-layer, .lyra-context-menu")) {
      continue;
    }
    const pane = element.closest<HTMLElement>(PANE_BOUNDARY_SELECTORS);
    if (pane === null) {
      continue;
    }
    const rect = pane.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }
    return {
      left: Math.max(viewport.left, rect.left),
      top: Math.max(viewport.top, rect.top),
      right: Math.min(viewport.right, rect.right),
      bottom: Math.min(viewport.bottom, rect.bottom)
    };
  }
  return viewport;
};

export const clampContextMenuPosition = ({
  anchorX,
  anchorY,
  menuWidth,
  menuHeight,
  paneBoundary,
  browserHostRects = []
}: {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly menuWidth: number;
  readonly menuHeight: number;
  readonly paneBoundary: Rect;
  readonly browserHostRects?: readonly Rect[];
}): AnchorPosition => {
  const padding = VIEWPORT_PADDING;
  const minLeft = paneBoundary.left + padding;
  const minTop = paneBoundary.top + padding;
  const maxLeft = Math.max(minLeft, paneBoundary.right - menuWidth - padding);
  const maxTop = Math.max(minTop, paneBoundary.bottom - menuHeight - padding);

  let left = clamp(anchorX, minLeft, maxLeft);
  let top = clamp(anchorY, minTop, maxTop);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const menuRect: Rect = {
      left,
      top,
      right: left + menuWidth,
      bottom: top + menuHeight
    };
    const overlap = browserHostRects.find((hostRect) => rectsIntersect(menuRect, hostRect));
    if (overlap === undefined) {
      break;
    }

    if (anchorX <= overlap.left) {
      left = Math.min(left, overlap.left - menuWidth - padding);
    } else if (anchorX >= overlap.right) {
      left = Math.max(left, overlap.right + padding);
    }

    if (anchorY <= overlap.top) {
      top = Math.min(top, overlap.top - menuHeight - padding);
    } else if (anchorY >= overlap.bottom) {
      top = Math.max(top, overlap.bottom + padding);
    }

    left = clamp(left, minLeft, maxLeft);
    top = clamp(top, minTop, maxTop);
  }

  return { left, top };
};
