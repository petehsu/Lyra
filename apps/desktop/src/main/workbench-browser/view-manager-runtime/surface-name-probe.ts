import type { WorkbenchBrowserAgentElement } from "../types";
import { isBlankSurfaceLabel } from "./surface-control-names";
import { beginSurfaceNameProbeScript, finishSurfaceNameProbeScript } from "./surface-name-runtime";

/** Bounded discovery inside one map, with no model round trips or clicks.
 * Action-result maps never sweep: they must preserve the just-opened menu.
 * The runtime remembers both successful and unsuccessful probes on the node.
 */
export const probeUnnamedSurfaceControls = async (
  elements: readonly WorkbenchBrowserAgentElement[],
  deps: {
    readonly execute: (element: WorkbenchBrowserAgentElement, script: string) => Promise<unknown>;
    readonly movePointer: (x: number, y: number) => void;
    readonly assertCanContinue: () => void;
  }
): Promise<boolean> => {
  const deadline = Date.now() + 2400;
  let moved = false;
  let restore: { x: number; y: number } | undefined;
  let count = 0;
  try {
    for (const element of elements) {
      if (Date.now() >= deadline || count >= 6) break;
      if (!isBlankSurfaceLabel(element.label) || element.disabled || element.editable
        || element.stateHint === "hover" || element.visibility?.offscreen || element.visibility?.covered
        || element.bounds.width > 160 || element.bounds.height > 96) continue;
      deps.assertCanContinue();
      const result = await deps.execute(element, beginSurfaceNameProbeScript(element.targetRef)).catch(() => null);
      if (!result || typeof result !== "object") continue;
      const point = result as { x?: number; y?: number; restore?: { x: number; y: number } | null };
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const offsetX = element.frameBounds?.x ?? 0, offsetY = element.frameBounds?.y ?? 0;
      restore ??= point.restore ? { x: point.restore.x + offsetX, y: point.restore.y + offsetY } : { x: -1, y: -1 };
      deps.assertCanContinue();
      deps.movePointer(point.x! + offsetX, point.y! + offsetY);
      moved = true;
      count += 1;
      // Let the trusted mouse event reach the renderer before checking :hover.
      await new Promise(resolve => setTimeout(resolve, 40));
      await deps.execute(element, finishSurfaceNameProbeScript(element.targetRef, Math.min(650, Math.max(0, deadline - Date.now())))).catch(() => undefined);
    }
  } finally {
    if (moved && restore) {
      // A human takeover cancels restoration too: never fight their pointer.
      deps.assertCanContinue();
      deps.movePointer(restore.x, restore.y);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  return moved;
};
