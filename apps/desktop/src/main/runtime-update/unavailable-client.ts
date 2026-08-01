import type { LyraRuntimeClient } from "../runtime-client";

export const createUnavailableRuntimeClient = (
  reason: unknown
): LyraRuntimeClient => {
  const detail = reason instanceof Error && reason.message.trim().length > 0
    ? reason.message
    : "Runtime startup verification failed.";
  let disposed = false;
  return {
    request: async () => {
      const error = new Error(
        disposed
          ? "Lyra Runtime repair client is disposed."
          : `Lyra Runtime is disabled until its signed component is repaired: ${detail}`
      );
      Object.assign(error, { code: "RUNTIME_REPAIR_REQUIRED" });
      throw error;
    },
    registerRequestHandler: () => undefined,
    unregisterRequestHandler: () => undefined,
    subscribe: () => () => undefined,
    dispose: () => {
      disposed = true;
    }
  };
};
