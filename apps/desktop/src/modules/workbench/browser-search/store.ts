import type { BrowserSearchPayload, DeepSearchViewState } from "./types";

type SearchTabSnapshot = {
  readonly standard?: BrowserSearchPayload;
  readonly deep?: DeepSearchViewState;
};

const snapshotsByTabId = new Map<string, SearchTabSnapshot>();

const updateSnapshot = (
  tabId: string,
  updater: (current: SearchTabSnapshot) => SearchTabSnapshot
): void => {
  const trimmedTabId = tabId.trim();
  if (trimmedTabId.length === 0) {
    return;
  }
  const current = snapshotsByTabId.get(trimmedTabId) ?? {};
  snapshotsByTabId.set(trimmedTabId, updater(current));
};

export const setStandardSearchSnapshot = (
  tabId: string,
  payload: BrowserSearchPayload
): void => {
  updateSnapshot(tabId, (current) => ({
    ...current,
    standard: payload
  }));
};

export const setDeepSearchSnapshot = (
  tabId: string,
  payload: DeepSearchViewState
): void => {
  updateSnapshot(tabId, (current) => ({
    ...current,
    deep: payload
  }));
};

export const getStandardSearchSnapshot = (tabId: string): BrowserSearchPayload | null =>
  snapshotsByTabId.get(tabId)?.standard ?? null;

export const getDeepSearchSnapshot = (tabId: string): DeepSearchViewState | null =>
  snapshotsByTabId.get(tabId)?.deep ?? null;

export const retainSearchSnapshots = (tabIds: readonly string[]): void => {
  const validIds = new Set(tabIds.map((tabId) => tabId.trim()).filter((tabId) => tabId.length > 0));
  for (const existingTabId of snapshotsByTabId.keys()) {
    if (!validIds.has(existingTabId)) {
      snapshotsByTabId.delete(existingTabId);
    }
  }
};
