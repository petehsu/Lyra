import type { TerminalSessionSnapshot } from "../../../shared/desktop-bridge";

const restoredSessionIds = new Set<string>();
let restoreSettled = true;
const restoreWaiters: Array<() => void> = [];

const settleRestoreWaiters = (): void => {
  restoreSettled = true;
  while (restoreWaiters.length > 0) {
    restoreWaiters.pop()?.();
  }
};

export const registerBulkTerminalRestore = (
  work: Promise<readonly TerminalSessionSnapshot[]>
): void => {
  restoreSettled = false;
  void work
    .then((snapshots) => {
      for (const snapshot of snapshots) {
        restoredSessionIds.add(snapshot.sessionId);
      }
    })
    .finally(() => {
      settleRestoreWaiters();
    });
};

export const waitForBulkTerminalRestore = (): Promise<void> => {
  if (restoreSettled) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    restoreWaiters.push(resolve);
  });
};

export const wasBulkTerminalRestored = (sessionId: string): boolean =>
  restoredSessionIds.has(sessionId);

export const clearBulkTerminalRestoreStateForTests = (): void => {
  restoredSessionIds.clear();
  restoreSettled = true;
  restoreWaiters.length = 0;
};