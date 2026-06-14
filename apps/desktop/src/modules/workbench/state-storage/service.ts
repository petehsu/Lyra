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
  return bridge.readCached(key);
};

export const writeWorkbenchStateSync = (key: WorkbenchStateKey, json: string): void => {
  const bridge = resolveWorkbenchStateBridge();
  if (bridge === null) {
    testMemoryState.set(key, json);
    return;
  }
  void bridge.write(key, json).catch((error: unknown) => {
    console.error(`workbench state write failed for ${key}: ${String(error)}`);
  });
};

export const removeWorkbenchStateSync = (key: WorkbenchStateKey): void => {
  const bridge = resolveWorkbenchStateBridge();
  if (bridge === null) {
    testMemoryState.delete(key);
    return;
  }
  void bridge.remove(key).catch((error: unknown) => {
    console.error(`workbench state remove failed for ${key}: ${String(error)}`);
  });
};

export const resetWorkbenchStateStorageForTests = (): void => {
  if (isTestRuntime()) {
    testMemoryState.clear();
  }
};
