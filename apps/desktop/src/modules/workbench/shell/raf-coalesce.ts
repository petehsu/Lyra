// ============================================================================
// raf-coalesce — single-flight requestAnimationFrame scheduler
// ============================================================================
//
// Many resize/scroll-driven callbacks (ResizeObserver, window "resize", etc.)
// fire many times per frame during an active drag. Routing them through a single
// coalescer collapses a same-frame storm into exactly one `run()` on the next
// animation frame. Behavior is identical at rest (a single trailing frame); only
// the redundant intra-frame invocations during a drag are dropped.

export type RafCoalescer = {
  /** Request that `run` execute on the next animation frame, if not already queued. */
  schedule: () => void;
  /** Cancel a pending frame (e.g. on unmount/disconnect). */
  cancel: () => void;
};

/**
 * Create a coalescer that runs `run` at most once per animation frame.
 *
 * @param run - the work to perform on the coalesced frame.
 * @param raf - optional requestAnimationFrame (defaults to window.requestAnimationFrame).
 * @param caf - optional cancelAnimationFrame (defaults to window.cancelAnimationFrame).
 */
export function createRafCoalescer(
  run: () => void,
  raf: (callback: FrameRequestCallback) => number =
    typeof window !== "undefined" ? window.requestAnimationFrame.bind(window) : ((cb) => {
      cb(0);
      return 0;
    }),
  caf: (handle: number) => void =
    typeof window !== "undefined" ? window.cancelAnimationFrame.bind(window) : (() => undefined)
): RafCoalescer {
  let frameId = 0;
  const schedule = (): void => {
    if (frameId !== 0) return;
    frameId = raf(() => {
      frameId = 0;
      run();
    });
  };
  const cancel = (): void => {
    if (frameId === 0) return;
    caf(frameId);
    frameId = 0;
  };
  return { schedule, cancel };
}
