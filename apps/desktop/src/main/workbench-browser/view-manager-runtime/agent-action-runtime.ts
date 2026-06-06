import type { WorkbenchBrowserAgentElement, WorkbenchBrowserAgentScrollBlock, WorkbenchBrowserAgentScrollDirection } from "../types";
import type { BrowserAgentViewportState } from "./types";

const centerOfAgentElement = (element: WorkbenchBrowserAgentElement): { x: number; y: number } => ({
  x: element.bounds.x + Math.round(element.bounds.width / 2),
  y: element.bounds.y + Math.round(element.bounds.height / 2)
});

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

const scrollDeltaToPlacePoint = (
  point: { readonly x: number; readonly y: number },
  viewport: BrowserAgentViewportState,
  block: WorkbenchBrowserAgentScrollBlock
): { deltaX: number; deltaY: number } => {
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
  scrollDeltaToPlacePoint
};
