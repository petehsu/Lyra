export const WORKBENCH_RENDERER_CRASH_LOOP_WINDOW_MS = 15_000;
export const WORKBENCH_RENDERER_CRASH_LOOP_MAX = 3;

const LINUX_STARTUP_FAILURE_REASONS = new Set([
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure"
]);

export const isIgnoredRendererGoneReason = (reason: string): boolean =>
  reason === "clean-exit";

export const isLinuxRendererStartupFailureReason = (reason: string): boolean =>
  LINUX_STARTUP_FAILURE_REASONS.has(reason);

export const shouldLinuxStartupRelaunch = (input: {
  readonly didFinishLoad: boolean;
  readonly isDevelopmentMode: boolean;
  readonly linuxCompatEnabled: boolean;
  readonly linuxRecoveryActive: boolean;
  readonly reason: string;
}): boolean =>
  input.didFinishLoad === false
  && input.isDevelopmentMode === false
  && input.linuxCompatEnabled
  && input.linuxRecoveryActive === false
  && isLinuxRendererStartupFailureReason(input.reason);

export const createRendererReloadLimiter = (
  now: () => number = Date.now
): { readonly shouldReload: () => boolean } => {
  const crashAtMs: number[] = [];
  return {
    shouldReload: () => {
      const current = now();
      while (
        crashAtMs.length > 0
        && current - crashAtMs[0]! >= WORKBENCH_RENDERER_CRASH_LOOP_WINDOW_MS
      ) {
        crashAtMs.shift();
      }
      crashAtMs.push(current);
      return crashAtMs.length <= WORKBENCH_RENDERER_CRASH_LOOP_MAX;
    }
  };
};
