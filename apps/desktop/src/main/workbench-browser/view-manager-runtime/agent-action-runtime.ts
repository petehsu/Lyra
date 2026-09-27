import type { WorkbenchBrowserAgentElement, WorkbenchBrowserAgentScrollBlock, WorkbenchBrowserAgentScrollDirection } from "../types";
import type { BrowserAgentViewportState } from "./types";

const centerOfAgentElement = (element: WorkbenchBrowserAgentElement): { x: number; y: number } => ({
  x: element.bounds.x + Math.round(element.bounds.width / 2),
  y: element.bounds.y + Math.round(element.bounds.height / 2)
});

/** A point inside the control, clustered toward the middle, never on the edge. */
export const humanClickPoint = (
  bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  random: () => number = Math.random
): { x: number; y: number } => {
  const inset = (span: number): number => Math.min(6, Math.max(1, Math.floor(span * 0.2)));
  const along = (start: number, span: number): number => {
    const pad = inset(span);
    if (span - pad * 2 < 2) return start + span / 2;
    const mix = (random() + random()) / 2;
    return start + pad + mix * (span - pad * 2);
  };
  return {
    x: Math.round(along(bounds.x, bounds.width)),
    y: Math.round(along(bounds.y, bounds.height))
  };
};

const normalizeAgentScrollBlock = (
  value: WorkbenchBrowserAgentScrollBlock | undefined
): WorkbenchBrowserAgentScrollBlock => (
  value === "start" || value === "end" || value === "nearest" ? value : "center"
);


const clampAgentPointToViewport = (
  point: { readonly x: number; readonly y: number },
  viewport: BrowserAgentViewportState,
  margin = 24
): { x: number; y: number } => ({
  x: Math.max(margin, Math.min(viewport.width - margin, Math.round(point.x))),
  y: Math.max(margin, Math.min(viewport.height - margin, Math.round(point.y)))
});

const agentPointInsideViewport = (
  point: { readonly x: number; readonly y: number },
  viewport: BrowserAgentViewportState,
  margin = 24
): boolean => (
  point.x >= margin
  && point.y >= margin
  && point.x <= viewport.width - margin
  && point.y <= viewport.height - margin
);

const preferredAgentPointForBlock = (
  viewport: BrowserAgentViewportState,
  block: WorkbenchBrowserAgentScrollBlock
): { x: number; y: number } => {
  const x = Math.round(viewport.width * 0.5);
  if (block === "start") {
    return { x, y: Math.round(viewport.height * 0.18) };
  }
  if (block === "end") {
    return { x, y: Math.round(viewport.height * 0.82) };
  }
  return { x, y: Math.round(viewport.height * 0.55) };
};

/** Glyph hangs down and right from the tip. A clipped tip scrolls by that overflow only. */
const AGENT_CURSOR_EXTENT = { left: 8, top: 8, right: 48, bottom: 48 };

const cursorOverflowDelta = (
  point: { readonly x: number; readonly y: number },
  viewport: BrowserAgentViewportState
): { deltaX: number; deltaY: number } => {
  const left = point.x - AGENT_CURSOR_EXTENT.left;
  const top = point.y - AGENT_CURSOR_EXTENT.top;
  const right = point.x + AGENT_CURSOR_EXTENT.right;
  const bottom = point.y + AGENT_CURSOR_EXTENT.bottom;
  return {
    deltaX: Math.round(left < 0 ? left : right > viewport.width ? right - viewport.width : 0),
    deltaY: Math.round(top < 0 ? top : bottom > viewport.height ? bottom - viewport.height : 0)
  };
};

const pointNearViewport = (
  point: { readonly x: number; readonly y: number },
  viewport: BrowserAgentViewportState
): boolean => (
  point.x >= -AGENT_CURSOR_EXTENT.right
  && point.y >= -AGENT_CURSOR_EXTENT.bottom
  && point.x <= viewport.width + AGENT_CURSOR_EXTENT.left
  && point.y <= viewport.height + AGENT_CURSOR_EXTENT.top
);

const scrollDeltaToPlacePoint = (
  point: { readonly x: number; readonly y: number },
  viewport: BrowserAgentViewportState,
  block: WorkbenchBrowserAgentScrollBlock
): { deltaX: number; deltaY: number } => {
  if (pointNearViewport(point, viewport)) {
    const nudge = cursorOverflowDelta(point, viewport);
    if (nudge.deltaX !== 0 || nudge.deltaY !== 0) {
      return nudge;
    }
  }
  if (agentPointInsideViewport(point, viewport) && block === "nearest") {
    return { deltaX: 0, deltaY: 0 };
  }
  if (block === "nearest") {
    const margin = 32;
    const deltaX =
      point.x < margin
        ? point.x - margin
        : point.x > viewport.width - margin
          ? point.x - (viewport.width - margin)
          : 0;
    const deltaY =
      point.y < margin
        ? point.y - margin
        : point.y > viewport.height - margin
          ? point.y - (viewport.height - margin)
          : 0;
    return {
      deltaX: Math.round(deltaX),
      deltaY: Math.round(deltaY)
    };
  }
  if (agentPointInsideViewport(point, viewport)) {
    return { deltaX: 0, deltaY: 0 };
  }
  const preferred = preferredAgentPointForBlock(viewport, block);
  return {
    deltaX: Math.round(point.x - preferred.x),
    deltaY: Math.round(point.y - preferred.y)
  };
};

const scrollDeltaForDirection = (
  direction: WorkbenchBrowserAgentScrollDirection,
  viewport: BrowserAgentViewportState,
  amount: number | undefined,
  pages: number | undefined
): { deltaX: number; deltaY: number } => {
  const pageAmount = Math.max(0.1, Math.min(10, pages ?? 0.82));
  const rawAmount = typeof amount === "number" && Number.isFinite(amount)
    ? Math.max(1, Math.min(5_000, Math.round(amount)))
    : Math.round((direction === "left" || direction === "right" ? viewport.width : viewport.height) * pageAmount);
  if (direction === "up") {
    return { deltaX: 0, deltaY: -rawAmount };
  }
  if (direction === "left") {
    return { deltaX: -rawAmount, deltaY: 0 };
  }
  if (direction === "right") {
    return { deltaX: rawAmount, deltaY: 0 };
  }
  return { deltaX: 0, deltaY: rawAmount };
};


export {
  agentPointInsideViewport,
  centerOfAgentElement,
  clampAgentPointToViewport,
  normalizeAgentScrollBlock,
  preferredAgentPointForBlock,
  scrollDeltaForDirection,
  scrollDeltaToPlacePoint,
  cursorOverflowDelta
};
