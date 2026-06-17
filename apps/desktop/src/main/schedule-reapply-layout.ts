import type { BrowserWindow } from "electron";

/**
 * Build a coalesced window-resize handler. Native window-edge resize fires on
 * every OS tick; reapplyLayout walks every visible WebContentsView calling
 * setBounds, so running it per tick during a drag is the main native-side
 * resize-jank source. This collapses a burst into a single-flight macrotask —
 * the final bounds are identical (applyLayout already dedupes), only redundant
 * intra-burst passes are dropped.
 */
export const createReapplyLayoutScheduler = (
  window: BrowserWindow,
  reapplyLayout: () => void
): (() => void) => {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      if (!window.isDestroyed()) reapplyLayout();
    });
  };
};
