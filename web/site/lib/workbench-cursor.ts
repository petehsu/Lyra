export const CURSOR_IDLE_DELAY = 3000;

/** The live website layer is separate from the demo's native app pages. */
export const isWebCursorSurfaceActive = (siteActive: string | undefined, modalOpen?: string) =>
  siteActive === "true" && modalOpen !== "true";

export function createCursorIdleState(
  change: (idle: boolean) => void,
  timers: {
    now: () => number;
    schedule: (callback: () => void, ms: number) => number;
    cancel: (id: number) => void;
  }
) {
  let timer: number | null = null;
  let deadline = 0;
  let idle = false;
  const setIdle = (next: boolean) => {
    if (idle === next) return;
    idle = next;
    change(next);
  };
  const check = () => {
    timer = null;
    const remaining = deadline - timers.now();
    if (remaining > 0) timer = timers.schedule(check, remaining);
    else setIdle(true);
  };
  return {
    stop() {
      if (timer !== null) timers.cancel(timer);
      timer = null;
      setIdle(false);
    },
    move() {
      setIdle(false);
      deadline = timers.now() + CURSOR_IDLE_DELAY;
      // One outstanding timer per movement burst, not clear/set on every event.
      if (timer === null) timer = timers.schedule(check, CURSOR_IDLE_DELAY);
    }
  };
}
