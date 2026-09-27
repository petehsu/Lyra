import { readDefaultWorkbenchState } from "../runtime/default-state";

type WorkbenchStateKey = string;

const STORAGE_PREFIX = "lyra.promo.ui-studio.state.";
// A film is a disposable playback session, never another editor of the live demo.
const film = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("film") === "1";
const filmState = new Map<string, string>();
if (film) {
  const params = new URLSearchParams(window.location.search);
  const locale = params.get("locale") === "zh-CN" ? "zh-CN" : "en-US";
  filmState.set("preferences", JSON.stringify({ theme: params.get("theme") === "dark" ? "lyra-dark" : "lyra-light", locale, localePreference: { mode: "explicit", locale } }));
}

const storageKey = (key: WorkbenchStateKey): string => `${STORAGE_PREFIX}${key}`;

export const readWorkbenchStateSync = (key: WorkbenchStateKey): string | null => {
  if (film) return filmState.get(key) ?? readDefaultWorkbenchState(key);
  if (typeof window === "undefined") {
    return readDefaultWorkbenchState(key);
  }
  return window.localStorage.getItem(storageKey(key)) ?? readDefaultWorkbenchState(key);
};

export const writeWorkbenchStateSync = (key: WorkbenchStateKey, json: string): void => {
  if (film) { filmState.set(key, json); return; }
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKey(key), json);
};

export const removeWorkbenchStateSync = (key: WorkbenchStateKey): void => {
  if (film) { filmState.delete(key); return; }
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(storageKey(key));
};

export const resetWorkbenchStateStorageForTests = (): void => undefined;
