import type {
  LyraDesktopApi,
  WorkbenchStateKey
} from "../../../shared/desktop-bridge";

const testMemoryState = new Map<WorkbenchStateKey, string>();

const isTestRuntime = (): boolean => {
  if (typeof process === "undefined") {
    return false;
  }
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
};

const resolveWorkbenchStateBridge = (): LyraDesktopApi["workbenchState"] | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const desktopApi = window.lyraDesktop;
  if (desktopApi !== undefined && desktopApi.workbenchState !== undefined) {
    return desktopApi.workbenchState;
  }

  if (isTestRuntime()) {
    return null;
  }

  throw new Error("lyraDesktop.workbenchState bridge is unavailable");
};

export const readWorkbenchStateSync = (key: WorkbenchStateKey): string | null => {
  const bridge = resolveWorkbenchStateBridge();
  if (bridge === null) {
    return testMemoryState.get(key) ?? null;
  }
  return bridge.readSync(key);
};

export const writeWorkbenchStateSync = (key: WorkbenchStateKey, json: string): void => {
  const bridge = resolveWorkbenchStateBridge();
  if (bridge === null) {
    testMemoryState.set(key, json);
    return;
  }
  bridge.writeSync(key, json);
};

export const removeWorkbenchStateSync = (key: WorkbenchStateKey): void => {
  const bridge = resolveWorkbenchStateBridge();
  if (bridge === null) {
    testMemoryState.delete(key);
    return;
  }
  bridge.removeSync(key);
};

export const resetWorkbenchStateStorageForTests = (): void => {
  if (isTestRuntime()) {
    testMemoryState.clear();
  }
};
