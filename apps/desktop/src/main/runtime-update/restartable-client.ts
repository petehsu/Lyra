import type {
  LyraRuntimeClient,
  RuntimeEventListener,
  RuntimeRequestHandler
} from "../runtime-client";

export type RuntimeClientFactory = () => LyraRuntimeClient;

export type RestartableRuntimeClient = {
  readonly client: LyraRuntimeClient;
  readonly restart: (replacementFactory?: RuntimeClientFactory) => Promise<void>;
  readonly dispose: () => void;
};

export const createRestartableRuntimeClient = (
  initialFactory: RuntimeClientFactory
): RestartableRuntimeClient => {
  let activeFactory = initialFactory;
  let current = initialFactory();
  let currentEventSubscription: (() => void) | null = null;
  let restartPromise: Promise<void> | null = null;
  let restartGate: Promise<void> | null = null;
  let resolveRestartGate: (() => void) | null = null;
  let activeRequestCount = 0;
  let resolveRequestDrain: (() => void) | null = null;
  let disposed = false;
  const handlers = new Map<string, RuntimeRequestHandler>();
  const listeners = new Set<RuntimeEventListener>();

  const forwardEvents = (client: LyraRuntimeClient): void => {
    currentEventSubscription?.();
    currentEventSubscription = client.subscribe((event, payload) => {
      for (const listener of listeners) {
        listener(event, payload);
      }
    });
  };

  const bindHandlers = (client: LyraRuntimeClient): void => {
    for (const [method, handler] of handlers) {
      client.registerRequestHandler(method, handler);
    }
  };

  const waitForRequestsToDrain = async (): Promise<void> => {
    if (activeRequestCount === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      resolveRequestDrain = resolve;
    });
  };

  const noteRequestFinished = (): void => {
    activeRequestCount = Math.max(0, activeRequestCount - 1);
    if (activeRequestCount === 0) {
      resolveRequestDrain?.();
      resolveRequestDrain = null;
    }
  };

  const stopClient = async (runtimeClient: LyraRuntimeClient): Promise<void> => {
    const shutdown = (runtimeClient as LyraRuntimeClient & {
      readonly shutdown?: () => Promise<void>;
    }).shutdown;
    if (shutdown !== undefined) {
      await shutdown();
      return;
    }
    runtimeClient.dispose();
  };

  forwardEvents(current);

  const client: LyraRuntimeClient = {
    request: async <T>(method: string, payload: unknown): Promise<T> => {
      if (disposed) {
        throw new Error("Restartable runtime client is disposed.");
      }
      if (restartGate !== null) {
        await restartGate;
      }
      if (disposed) {
        throw new Error("Restartable runtime client is disposed.");
      }
      const requestClient = current;
      activeRequestCount += 1;
      try {
        return await requestClient.request<T>(method, payload);
      } finally {
        noteRequestFinished();
      }
    },
    registerRequestHandler: (method, handler) => {
      handlers.set(method, handler);
      if (!disposed && restartGate === null) {
        current.registerRequestHandler(method, handler);
      }
    },
    unregisterRequestHandler: (method) => {
      handlers.delete(method);
      if (!disposed && restartGate === null) {
        current.unregisterRequestHandler(method);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      resolveRestartGate?.();
      resolveRestartGate = null;
      restartGate = null;
      resolveRequestDrain?.();
      resolveRequestDrain = null;
      currentEventSubscription?.();
      currentEventSubscription = null;
      current.dispose();
      handlers.clear();
      listeners.clear();
    }
  };

  const restart = (replacementFactory = activeFactory): Promise<void> => {
    if (disposed) {
      return Promise.reject(new Error("Restartable runtime client is disposed."));
    }
    if (restartPromise !== null) {
      return restartPromise;
    }

    restartGate = new Promise<void>((resolve) => {
      resolveRestartGate = resolve;
    });
    restartPromise = (async () => {
      await waitForRequestsToDrain();
      if (disposed) {
        throw new Error("Restartable runtime client is disposed.");
      }

      currentEventSubscription?.();
      currentEventSubscription = null;
      await stopClient(current);

      const replacement = replacementFactory();
      if (disposed) {
        replacement.dispose();
        throw new Error("Restartable runtime client is disposed.");
      }
      bindHandlers(replacement);
      forwardEvents(replacement);
      current = replacement;
      activeFactory = replacementFactory;
    })().finally(() => {
      resolveRestartGate?.();
      resolveRestartGate = null;
      restartGate = null;
      restartPromise = null;
    });
    return restartPromise;
  };

  return {
    client,
    restart,
    dispose: client.dispose
  };
};
