import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  LyraDesktopApi,
  SearchIndexStatusResponse
} from "../../../../shared/desktop-bridge";
import {
  SEARCH_INDEX_STATUS_POLL_INTERVAL_MS_FOR_TESTS,
  useWorkbenchSearchIndexStatus
} from "../use-workbench-search-index-status";

const idleStatus: SearchIndexStatusResponse = {
  state: "idle",
  indexedFiles: 0,
  indexedDirs: 0
};

const readyStatus: SearchIndexStatusResponse = {
  state: "ready",
  indexedFiles: 12,
  indexedDirs: 3,
  lastBuiltAt: "2026-04-27T00:00:00.000Z"
};

describe("useWorkbenchSearchIndexStatus", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("reads the current index status on mount", async () => {
    const readIndexStatus = vi.fn().mockResolvedValue(readyStatus);
    const desktopApi = {
      search: {
        readIndexStatus,
        rebuildIndex: vi.fn()
      }
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() =>
      useWorkbenchSearchIndexStatus({
        desktopApi,
        scopePreset: "home",
        customRoots: [],
        includeHidden: false
      })
    );

    await waitFor(() => {
      expect(result.current.searchIndexStatus).toEqual(readyStatus);
    });
    expect(readIndexStatus).toHaveBeenCalledTimes(1);
  });

  test("polls index status while mounted", async () => {
    vi.useFakeTimers();
    const readIndexStatus = vi
      .fn()
      .mockResolvedValueOnce(idleStatus)
      .mockResolvedValueOnce(readyStatus);
    const desktopApi = {
      search: {
        readIndexStatus,
        rebuildIndex: vi.fn()
      }
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() =>
      useWorkbenchSearchIndexStatus({
        desktopApi,
        scopePreset: "home",
        customRoots: [],
        includeHidden: false
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.searchIndexStatus).toEqual(idleStatus);

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_INDEX_STATUS_POLL_INTERVAL_MS_FOR_TESTS);
      await Promise.resolve();
    });
    expect(result.current.searchIndexStatus).toEqual(readyStatus);
    expect(readIndexStatus).toHaveBeenCalledTimes(2);
  });

  test("rebuilds with the current search preferences and guards duplicate requests", async () => {
    let resolveRebuild!: (value: {
      readonly status: SearchIndexStatusResponse;
      readonly scopePreset: "custom";
      readonly roots: readonly string[];
    }) => void;
    const rebuildIndex = vi.fn(() =>
      new Promise<{
        readonly status: SearchIndexStatusResponse;
        readonly scopePreset: "custom";
        readonly roots: readonly string[];
      }>((resolve) => {
        resolveRebuild = resolve;
      })
    );
    const desktopApi = {
      search: {
        readIndexStatus: vi.fn().mockResolvedValue(idleStatus),
        rebuildIndex
      }
    } as unknown as LyraDesktopApi;
    const { result } = renderHook(() =>
      useWorkbenchSearchIndexStatus({
        desktopApi,
        scopePreset: "custom",
        customRoots: ["/workspace"],
        includeHidden: true
      })
    );

    act(() => {
      result.current.onSearchRebuildIndex();
      result.current.onSearchRebuildIndex();
    });

    expect(result.current.searchRebuildIndexPending).toBe(true);
    expect(rebuildIndex).toHaveBeenCalledTimes(1);
    expect(rebuildIndex).toHaveBeenCalledWith({
      scopePreset: "custom",
      customRoots: ["/workspace"],
      includeHidden: true,
      force: true
    });

    await act(async () => {
      resolveRebuild({
        status: readyStatus,
        scopePreset: "custom",
        roots: ["/workspace"]
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.searchRebuildIndexPending).toBe(false);
      expect(result.current.searchIndexStatus).toEqual(readyStatus);
    });
  });
});
