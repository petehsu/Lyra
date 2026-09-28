import { SURFACE_DOM_ACCESS } from "./surface-dom-access";
import { CHOICE_CONTROL_RUNTIME } from "./choice-control-runtime";
import { INSTALL_POINTER_GUARD, FINISH_POINTER_GUARD } from "./bound-pointer";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";
import type { WorkbenchBrowserAgentElement, WorkbenchBrowserDebuggerSession } from "../types";
import { readAxValueText } from "./agent-observation-runtime";

export type StampedSurfacePoint = {
  readonly trusted: boolean;
  readonly reason?: string;
  readonly clickX: number;
  readonly clickY: number;
};

export const isBlankSurfaceLabel = (label: string): boolean => {
  const text = label.replace(/[\s\u3164\u2800\u200b\u200c\u200d\ufeff]/g, "");
  return text.length === 0 || text === "(nolabel)";
};

export const axNameOverlappingBounds = (
  names: readonly { readonly name: string; readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }[],
  bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
): string | null => {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  let best: string | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const item of names) {
    const name = item.name.trim();
    const box = item.bounds;
    const inside = centerX >= box.x
      && centerY >= box.y
      && centerX <= box.x + box.width
      && centerY <= box.y + box.height;
    if (!inside || name.length === 0) continue;
    if (box.width > bounds.width * 2 + 8 || box.height > bounds.height * 2 + 8) continue;
    const area = box.width * box.height;
    if (area < bestArea) {
      best = name;
      bestArea = area;
    }
  }
  return best;
};

export const readStampedSurfaceScript = (targetRef: string): string => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  const node = findSurfaceTarget(${JSON.stringify(targetRef)});
  if (!node) return null;
  const rect = surfaceGlobalRect(node);
  return rect.width > 0 && rect.height > 0 ? rect : null;
})()`;

/** Prepare exactly one trusted input dispatch. Never click from the probe. */
export const activateStampedSurfaceScript = (targetRef: string, timeoutMs = 1_000, allowDisabled = false, position?: { x: number; y: number }, exactPosition = false): string => `(async () => {
  ${SURFACE_TARGET_LOOKUP}
  ${SURFACE_DOM_ACCESS}
  const choices = ${CHOICE_CONTROL_RUNTIME};
  const deadline = Date.now() + ${Math.max(0, Math.min(timeoutMs, 2_000))};
  let previous = "";
  let last = null;
  do {
    const node = findSurfaceTarget(${JSON.stringify(targetRef)});
    if (!node || !node.isConnected) return null;
    const view = node.ownerDocument.defaultView;
    const local = node.getBoundingClientRect();
    const box = surfaceGlobalRect(node);
    const style = view.getComputedStyle(node);
    const choice = choices.inputOf(node);
    const disabled = node.matches(":disabled") || node.closest('[aria-disabled="true"], [inert]') !== null
      || !!choice && (choice.matches(":disabled") || choice.closest('[aria-disabled="true"], [inert]') !== null);
    let point = null;
    if ((!disabled || ${allowDisabled}) && local.width > 0 && local.height > 0 && style.visibility !== "hidden" && style.display !== "none") {
      for (const ratio of ${JSON.stringify(position ? [exactPosition ? [position.x, position.y] : [Math.min(.99, Math.max(.01, position.x)), Math.min(.99, Math.max(.01, position.y))]] : [[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]])}) {
        const x = local.left + Math.min(local.width - 1, local.width * ratio[0]), y = local.top + Math.min(local.height - 1, local.height * ratio[1]);
        const hit = surfaceHitForNode(node,x,y);
        if (hit === node || (hit && node.contains(hit))) {
          let owner = view, px = x, py = y, coveredFrame = false;
          while (owner.frameElement) {
            const frame = owner.frameElement, r = frame.getBoundingClientRect();
            px += r.left + frame.clientLeft; py += r.top + frame.clientTop;
            const root = frame.getRootNode();
            if (root.elementFromPoint?.(px, py) !== frame) { coveredFrame = true; break; }
            owner = frame.ownerDocument.defaultView;
          }
          if (coveredFrame) continue;
          point = { clickX: Math.round(box.x + x - local.left), clickY: Math.round(box.y + y - local.top) };
          break;
        }
      }
    }
    const signature = JSON.stringify(box);
    last = { ...box, trusted: false, reason: disabled ? "disabled" : !local.width || !local.height || style.visibility === "hidden" || style.display === "none" ? "hidden" : point ? "moving" : "covered" };
    if (point && signature === previous) return { ...box, ...point, trusted: true };
    previous = point ? signature : "";
    if (Date.now() >= deadline) return last;
    await new Promise(resolve => setTimeout(resolve, 16));
  } while (true);
})()`;

export const armStampedPointerScript = (targetRef: string, token: string): string => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  const node = findSurfaceTarget(${JSON.stringify(targetRef)});
  return node ? (${INSTALL_POINTER_GUARD}).call(node, ${JSON.stringify(token)}) : false;
})()`;
export const finishStampedPointerScript = (token: string): string => `(${FINISH_POINTER_GUARD})(${JSON.stringify(token)})`;

export const stampedTargetIsHitScript = (targetRef: string): string => `(() => {
  ${SURFACE_TARGET_LOOKUP}
  const node = findSurfaceTarget(${JSON.stringify(targetRef)});
  if (!node) return false;
  const rect = node.getBoundingClientRect();
  const hit = node.ownerDocument.elementFromPoint?.(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return hit === node || (hit != null && node.contains(hit));
})()`;

export const cursorApproachPoints = (
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  steps = 4
): { x: number; y: number }[] => {
  const points = [{ x: Math.round(from.x), y: Math.round(from.y) }];
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    points.push({
      x: Math.round(from.x + (to.x - from.x) * t),
      y: Math.round(from.y + (to.y - from.y) * t)
    });
  }
  return points;
};

export const refreshStampedElement = async <T extends { readonly targetRef: string; readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }>(
  element: T,
  execute: (script: string) => Promise<unknown>
): Promise<T> => {
  const bounds = boundsFromStamp(await execute(readStampedSurfaceScript(element.targetRef)).catch(() => null));
  return bounds === null ? element : { ...element, bounds };
};

export const clickPointFromStamp = (
  value: unknown
): { readonly x: number; readonly y: number } | null => {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const x = Number(record.clickX);
  const y = Number(record.clickY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
};

export const boundsFromStamp = (
  value: unknown
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null => {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
};

const NAMED_ROLES = new Set(["button", "link", "menuitem", "tab", "switch", "checkbox"]);

const axNameAtPoint = async (
  session: Pick<WorkbenchBrowserDebuggerSession, "sendCommand">,
  x: number,
  y: number
): Promise<string | null> => {
  const located = await session.sendCommand("DOM.getNodeForLocation", { x, y }).catch(() => ({}));
  const backendNodeId = Number((located as { backendNodeId?: unknown }).backendNodeId);
  if (!Number.isFinite(backendNodeId)) return null;
  const tree = await session.sendCommand("Accessibility.getPartialAXTree", {
    backendNodeId: Math.round(backendNodeId),
    fetchRelatives: true
  }).catch(() => ({}));
  const nodes = Array.isArray((tree as { nodes?: unknown }).nodes)
    ? (tree as { nodes: unknown[] }).nodes
    : [];
  const records = nodes.filter((node): node is Record<string, unknown> => node !== null && typeof node === "object");
  let current = records.find(node => node.backendDOMNodeId === backendNodeId);
  const visited = new Set<unknown>();
  while (current && !visited.has(current.nodeId)) {
    visited.add(current.nodeId);
    const role = readAxValueText(current.role).toLowerCase();
    // Stop at the nearest action owner, even when unnamed. A sibling or
    // enclosing row's name must never be copied onto this button.
    if (NAMED_ROLES.has(role)) {
      const name = readAxValueText(current.name).trim();
      return name.length > 0 && name.length <= 160 ? name : null;
    }
    const parentId = current.parentId;
    current = records.find(node => node.nodeId === parentId && parentId !== undefined);
  }
  return null;
};

export const fillBlankSurfaceLabels = async (
  elements: readonly WorkbenchBrowserAgentElement[],
  deps: {
    readonly openDebugger: () => Promise<Pick<WorkbenchBrowserDebuggerSession, "sendCommand" | "close">>;
  }
): Promise<readonly WorkbenchBrowserAgentElement[]> => {
  const blanks = elements.filter((element) => isBlankSurfaceLabel(element.label));
  if (blanks.length === 0) return elements;
  const named = new Map<number, string>();
  const actionSized = (element: WorkbenchBrowserAgentElement): boolean =>
    element.bounds.height > 0
    && element.bounds.height <= 96
    && element.bounds.width > 0
    && element.bounds.width <= 640;
  const needsAx = blanks
    // Row-edge controls can have real AX names too. axNameAtPoint already
    // stops at the nearest action owner, including an unnamed one.
    .sort((left, right) => {
      const leftAction = actionSized(left) ? 0 : 1;
      const rightAction = actionSized(right) ? 0 : 1;
      if (leftAction !== rightAction) return leftAction - rightAction;
      return (right.bounds.width * right.bounds.height) - (left.bounds.width * left.bounds.height);
    })
    .slice(0, 12);
  if (needsAx.length > 0) {
    const session = await deps.openDebugger().catch(() => null);
    if (session !== null) {
      try {
        await session.sendCommand("Accessibility.enable").catch(() => ({}));
        await Promise.all(needsAx.map(async (element) => {
          const name = await axNameAtPoint(
            session,
            Math.round(element.bounds.x + element.bounds.width / 2),
            Math.round(element.bounds.y + element.bounds.height / 2)
          );
          if (name !== null) named.set(element.id, name);
        }));
      } finally {
        await session.close?.().catch(() => undefined);
      }
    }
  }
  if (named.size === 0) return elements;
  return elements.map((element) => {
    const label = named.get(element.id);
    return label === undefined ? element : { ...element, label };
  });
};
