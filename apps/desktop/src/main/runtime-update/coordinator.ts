export type RuntimeActivityKind =
  | "agent-turn"
  | "terminal-session"
  | "download-task"
  | "lsp-document";

export type RuntimeUpdatePhase =
  | "idle"
  | "staging"
  | "waiting-for-safe-point"
  | "activating"
  | "restarting"
  | "health-check"
  | "replaying"
  | "rolling-back"
  | "failed";

export type RuntimeActivity = {
  readonly kind: RuntimeActivityKind;
  readonly id: string;
  readonly restartable: boolean;
  readonly metadata?: unknown;
};

export type RuntimeUpdateStatus = {
  readonly phase: RuntimeUpdatePhase;
  readonly admissionOpen: boolean;
  readonly blockers: readonly RuntimeActivity[];
  readonly restartable: readonly RuntimeActivity[];
  readonly lastError?: string;
};

export type RuntimeUpdateOperation<TStaged, TActivated> = {
  readonly stage: () => Promise<TStaged>;
  readonly activate: (staged: TStaged) => Promise<TActivated>;
  readonly restart: () => Promise<void>;
  readonly healthCheck: () => Promise<void>;
  readonly replayRestartable?: (
    activities: readonly RuntimeActivity[]
  ) => Promise<void>;
  /**
   * Records the durable commit point only after activation, restart, health
   * validation, and restartable-state replay have all succeeded.
   */
  readonly commit?: (activated: TActivated) => Promise<void>;
  /**
   * Discards work completed by `stage` when activation never began (for
   * example because a safe point timed out or Core is shutting down).
   */
  readonly cancelStage?: (staged: TStaged, cause: unknown) => Promise<void>;
  readonly rollback: (staged: TStaged, cause: unknown) => Promise<void>;
  readonly safePointTimeoutMs?: number;
};

export class RuntimeUpdatePendingError extends Error {
  readonly code = "RUNTIME_UPDATE_PENDING";

  constructor(kind: RuntimeActivityKind) {
    super(`Cannot start ${kind} while a runtime update is waiting to activate.`);
    this.name = "RuntimeUpdatePendingError";
  }
}

export class RuntimeUpdateAlreadyRunningError extends Error {
  readonly code = "RUNTIME_UPDATE_ALREADY_RUNNING";

  constructor() {
    super("A runtime update is already in progress.");
    this.name = "RuntimeUpdateAlreadyRunningError";
  }
}

export class RuntimeSafePointTimeoutError extends Error {
  readonly code = "RUNTIME_SAFE_POINT_TIMEOUT";

  constructor(timeoutMs: number, blockers: readonly RuntimeActivity[]) {
    super(
      `Runtime update did not reach a safe point within ${timeoutMs}ms: ${blockers
        .map(({ kind, id }) => `${kind}:${id}`)
        .join(", ")}`
    );
    this.name = "RuntimeSafePointTimeoutError";
  }
}

export class RuntimeUpdateRecoveryError extends Error {
  readonly code = "RUNTIME_UPDATE_RECOVERY_FAILED";
  readonly updateError: unknown;
  readonly recoveryError: unknown;

  constructor(updateError: unknown, recoveryError: unknown) {
    super("Runtime update failed and the previous runtime could not be restored.", {
      cause: recoveryError
    });
    this.name = "RuntimeUpdateRecoveryError";
    this.updateError = updateError;
    this.recoveryError = recoveryError;
  }
}

export type RuntimeUpdateCoordinator = {
  readonly assertAdmission: (kind: RuntimeActivityKind) => void;
  readonly markActive: (activity: RuntimeActivity) => void;
  readonly markIdle: (kind: RuntimeActivityKind, id: string) => void;
  readonly clearKind: (kind: RuntimeActivityKind) => void;
  readonly readStatus: () => RuntimeUpdateStatus;
  readonly subscribe: (listener: (status: RuntimeUpdateStatus) => void) => () => void;
  readonly applyUpdate: <TStaged, TActivated>(
    operation: RuntimeUpdateOperation<TStaged, TActivated>
  ) => Promise<TActivated>;
  readonly dispose: () => void;
};

const activityKey = (kind: RuntimeActivityKind, id: string): string =>
  `${kind}\u0000${id}`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const validateActivity = (activity: RuntimeActivity): void => {
  if (activity.id.trim().length === 0) {
    throw new Error("Runtime activity id is required.");
  }
};

export const createRuntimeUpdateCoordinator = (): RuntimeUpdateCoordinator => {
  const activities = new Map<string, RuntimeActivity>();
  const listeners = new Set<(status: RuntimeUpdateStatus) => void>();
  const safePointWaiters = new Set<() => void>();
  let phase: RuntimeUpdatePhase = "idle";
  let admissionOpen = true;
  let lastError: string | undefined;
  let updateRunning = false;
  let disposed = false;

  const snapshotActivities = (restartable: boolean): readonly RuntimeActivity[] =>
    [...activities.values()]
      .filter((activity) => activity.restartable === restartable)
      .sort((left, right) =>
        left.kind === right.kind
          ? left.id.localeCompare(right.id)
          : left.kind.localeCompare(right.kind)
      );

  const readStatus = (): RuntimeUpdateStatus => ({
    phase,
    admissionOpen,
    blockers: snapshotActivities(false),
    restartable: snapshotActivities(true),
    ...(lastError === undefined ? {} : { lastError })
  });

  const publish = (): void => {
    const status = readStatus();
    for (const listener of listeners) {
      listener(status);
    }
  };

  const setPhase = (next: RuntimeUpdatePhase): void => {
    phase = next;
    publish();
  };

  const assertNotDisposed = (): void => {
    if (disposed) {
      throw new Error("Runtime update coordinator is disposed.");
    }
  };

  const notifySafePoint = (): void => {
    if (snapshotActivities(false).length !== 0) {
      return;
    }
    for (const resolve of safePointWaiters) {
      resolve();
    }
    safePointWaiters.clear();
  };

  const waitForSafePoint = async (timeoutMs: number | undefined): Promise<void> => {
    if (snapshotActivities(false).length === 0) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolveWaiter: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        resolveWaiter = resolve;
        safePointWaiters.add(resolve);
        if (timeoutMs !== undefined && timeoutMs > 0) {
          timeout = setTimeout(() => {
            safePointWaiters.delete(resolve);
            reject(new RuntimeSafePointTimeoutError(timeoutMs, snapshotActivities(false)));
          }, timeoutMs);
        }
      });
    } finally {
      if (resolveWaiter !== undefined) {
        safePointWaiters.delete(resolveWaiter);
      }
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  };

  const recoverPreviousRuntime = async <TStaged>(
    operation: RuntimeUpdateOperation<TStaged, unknown>,
    staged: TStaged,
    cause: unknown,
    restartable: readonly RuntimeActivity[]
  ): Promise<void> => {
    setPhase("rolling-back");
    await operation.rollback(staged, cause);
    await operation.restart();
    await operation.healthCheck();
    if (restartable.length > 0 && operation.replayRestartable !== undefined) {
      await operation.replayRestartable(restartable);
    }
  };

  const executeUpdate = async <TStaged, TActivated>(
    operation: RuntimeUpdateOperation<TStaged, TActivated>
  ): Promise<TActivated> => {
    let staged: TStaged | undefined;
    let stageCompleted = false;
    let activationAttempted = false;
    let restartable: readonly RuntimeActivity[] = [];
    try {
      lastError = undefined;
      setPhase("staging");
      staged = await operation.stage();
      stageCompleted = true;
      assertNotDisposed();

      admissionOpen = false;
      setPhase("waiting-for-safe-point");
      await waitForSafePoint(operation.safePointTimeoutMs);
      assertNotDisposed();
      restartable = snapshotActivities(true);

      setPhase("activating");
      activationAttempted = true;
      const activated = await operation.activate(staged);

      setPhase("restarting");
      await operation.restart();
      setPhase("health-check");
      await operation.healthCheck();
      if (restartable.length > 0 && operation.replayRestartable !== undefined) {
        setPhase("replaying");
        await operation.replayRestartable(restartable);
      }
      await operation.commit?.(activated);

      phase = "idle";
      return activated;
    } catch (error) {
      if (activationAttempted && stageCompleted) {
        try {
          await recoverPreviousRuntime(
            operation as RuntimeUpdateOperation<TStaged, unknown>,
            staged as TStaged,
            error,
            restartable
          );
        } catch (recoveryError) {
          const combined = new RuntimeUpdateRecoveryError(error, recoveryError);
          lastError = combined.message;
          phase = "failed";
          throw combined;
        }
      } else if (stageCompleted && operation.cancelStage !== undefined) {
        try {
          setPhase("rolling-back");
          await operation.cancelStage(staged as TStaged, error);
        } catch (recoveryError) {
          const combined = new RuntimeUpdateRecoveryError(error, recoveryError);
          lastError = combined.message;
          phase = "failed";
          throw combined;
        }
      }
      lastError = errorMessage(error);
      phase = "failed";
      throw error;
    } finally {
      admissionOpen = !disposed;
      updateRunning = false;
      publish();
    }
  };

  return {
    assertAdmission: (kind) => {
      if (!admissionOpen && !(kind === "lsp-document" && phase === "waiting-for-safe-point")) {
        throw new RuntimeUpdatePendingError(kind);
      }
    },
    markActive: (activity) => {
      if (disposed) {
        return;
      }
      validateActivity(activity);
      const id = activity.id.trim();
      activities.set(activityKey(activity.kind, id), {
        ...activity,
        id
      });
      publish();
      notifySafePoint();
    },
    markIdle: (kind, id) => {
      if (activities.delete(activityKey(kind, id.trim()))) {
        publish();
        notifySafePoint();
      }
    },
    clearKind: (kind) => {
      let changed = false;
      for (const [key, activity] of activities) {
        if (activity.kind === kind) {
          activities.delete(key);
          changed = true;
        }
      }
      if (changed) {
        publish();
        notifySafePoint();
      }
    },
    readStatus,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyUpdate: <TStaged, TActivated>(
      operation: RuntimeUpdateOperation<TStaged, TActivated>
    ) => {
      if (disposed) {
        return Promise.reject(new Error("Runtime update coordinator is disposed."));
      }
      if (updateRunning) {
        return Promise.reject(new RuntimeUpdateAlreadyRunningError());
      }
      updateRunning = true;
      return executeUpdate(operation);
    },
    dispose: () => {
      disposed = true;
      admissionOpen = false;
      activities.clear();
      listeners.clear();
      for (const resolve of safePointWaiters) {
        resolve();
      }
      safePointWaiters.clear();
    }
  };
};
