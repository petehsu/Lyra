import { readDefaultWorkbenchState } from "../runtime/default-state";

type WorkbenchStateKey = string;

const STORAGE_PREFIX = "lyra.promo.ui-studio.state.";

const storageKey = (key: WorkbenchStateKey): string => `${STORAGE_PREFIX}${key}`;

export const readWorkbenchStateSync = (key: WorkbenchStateKey): string | null => {
  if (typeof window === "undefined") {
    return readDefaultWorkbenchState(key);
  }
  return window.localStorage.getItem(storageKey(key)) ?? readDefaultWorkbenchState(key);
};

export const writeWorkbenchStateSync = (key: WorkbenchStateKey, json: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKey(key), json);
};

export const removeWorkbenchStateSync = (key: WorkbenchStateKey): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(storageKey(key));
};

export const resetWorkbenchStateStorageForTests = (): void => undefined;
