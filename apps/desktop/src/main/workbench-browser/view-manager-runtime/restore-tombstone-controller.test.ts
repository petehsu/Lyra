import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  HIDDEN_PAGE_TOMBSTONE_DELAY_MS,
  HIDDEN_PAGE_TOMBSTONE_RETRY_MS,
  HIDDEN_PAGE_TOMBSTONE_SAFETY_RETRY_LIMIT
} from "./normalizers";
import { createRestoreTombstoneController } from "./restore-tombstone-controller";
import type { BrowserPageEntry } from "./types";

const createEntry = (
  tabId: string,
  patch?: {
    readonly updatedAt?: number;
    readonly execute?: () => Promise<{ hasEditedField: boolean; hasActiveMedia: boolean }>;
    readonly editedFieldCount?: number;
  }
): BrowserPageEntry => {
  const execute = patch?.execute ?? (async () => ({ hasEditedField: false, hasActiveMedia: false }));
  return {
    tabId,
    requestedAddress: `https://${tabId}.example/`,
    titleHint: tabId,
    attached: false,
    viewVisible: false,
    isDestroyed: false,
    layout: null,
    historyRestoreAttempted: false,
    runtimeAddressUpdatedAt: 0,
    lastTopologySyncAt: 0,
    disposeListeners: () => undefined,
    view: {} as BrowserPageEntry["view"],
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: () => execute()
    } as unknown as BrowserPageEntry["webContents"],
    runtime: {
      tabId,
      address: `https://${tabId}.example/`,
      title: tabId,
      isActive: false,
      isVisible: false,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isHtmlFullscreen: false,
      updatedAt: patch?.updatedAt ?? 1,
      ...(patch?.editedFieldCount === undefined
        ? {}
        : {
            restoreState: {
              formDraft: { editedFieldCount: patch.editedFieldCount }
            }
          })
    }
  } as BrowserPageEntry;
};

describe("restore tombstone lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createController = (entryList: readonly BrowserPageEntry[]) => {
    const entries = new Map(entryList.map((entry) => [entry.tabId, entry]));
    const destroyEntry = vi.fn((entry: BrowserPageEntry) => {
      entry.isDestroyed = true;
    });
    const deleteEntry = vi.fn((tabId: string) => {
      entries.delete(tabId);
    });
    const controller = createRestoreTombstoneController({
      entries,
      readPageStorageAvailability: async () => undefined,
      navigationHistorySnapshot: () => undefined,
      updateRuntimeState: (entry, patch) => {
        entry.runtime = { ...entry.runtime, ...patch, updatedAt: Date.now() };
      },
      publishRuntimeState: () => undefined,
      scheduleBrowserSessionSnapshotWrite: () => undefined,
      hasActiveLiveAgentBrowserTask: () => false,
      hasActiveDebuggerClients: () => false,
      disposeCdpAuditSession: () => undefined,
      destroyEntry,
      deleteEntry,
      scheduleBrowserTargetRegistryWarmup: () => undefined
    });
    return { controller, destroyEntry, entries };
  };

  test("destroys a hidden page after a few seconds, not 45s", async () => {
    const entry = createEntry("a");
    const { controller, destroyEntry } = createController([entry]);
    controller.scheduleTombstone(entry);
    await vi.advanceTimersByTimeAsync(HIDDEN_PAGE_TOMBSTONE_DELAY_MS - 1);
    expect(destroyEntry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(destroyEntry).toHaveBeenCalledTimes(1);
  });

  test("retries a failed safety probe then tombstones", async () => {
    const entry = createEntry("a", {
      execute: async () => {
        throw new Error("isolated world");
      }
    });
    const { controller, destroyEntry } = createController([entry]);
    controller.scheduleTombstone(entry);
    await vi.advanceTimersByTimeAsync(HIDDEN_PAGE_TOMBSTONE_DELAY_MS);
    await Promise.resolve();
    expect(destroyEntry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(
      HIDDEN_PAGE_TOMBSTONE_RETRY_MS * HIDDEN_PAGE_TOMBSTONE_SAFETY_RETRY_LIMIT
    );
    await Promise.resolve();
    expect(destroyEntry).toHaveBeenCalledTimes(1);
  });

  test("keeps a hidden page that already has an edited form", async () => {
    const entry = createEntry("a", { editedFieldCount: 2 });
    const { controller, destroyEntry } = createController([entry]);
    controller.scheduleTombstone(entry);
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.resolve();
    expect(destroyEntry).not.toHaveBeenCalled();
  });

  test("urgently tombstones oldest hot-hidden pages past the live cap", async () => {
    const execute = vi.fn(async () => ({ hasEditedField: false, hasActiveMedia: false }));
    const hidden = ["a", "b", "c", "d"].map((tabId, index) =>
      createEntry(tabId, { updatedAt: index + 1, execute })
    );
    const { controller, destroyEntry } = createController(hidden);
    controller.evictExcessHiddenPages();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    expect(destroyEntry.mock.calls.map((call) => call[0].tabId)).toEqual(["a"]);
  });

  test("urgent eviction drains one extra hidden page per pass", async () => {
    const hidden = ["a", "b", "c", "d"].map((tabId, index) =>
      createEntry(tabId, { updatedAt: index + 1 })
    );
    const { controller, destroyEntry } = createController(hidden);
    controller.evictExcessHiddenPages();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    controller.evictExcessHiddenPages();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(destroyEntry.mock.calls.map((call) => call[0].tabId)).toEqual(["a", "b"]);
  });

  test("urgent eviction keeps a hidden page that already has an edited form", async () => {
    const hidden = [
      createEntry("a", { updatedAt: 1, editedFieldCount: 2 }),
      createEntry("b", { updatedAt: 2 }),
      createEntry("c", { updatedAt: 3 }),
      createEntry("d", { updatedAt: 4 })
    ];
    const { controller, destroyEntry } = createController(hidden);
    controller.evictExcessHiddenPages();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(destroyEntry.mock.calls.map((call) => call[0].tabId)).toEqual(["b"]);
  });
});
