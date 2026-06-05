import { afterEach, describe, expect, test, vi } from "vitest";

import {
  LOCAL_SEARCH_STREAM_TIMEOUT_MS,
  startStandardSearchTask
} from "../standard-search-task";
import type {
  BrowserSearchSettings,
  StandardSearchTask
} from "../runtime-types";
import type {
  AggregatedSearchPayload,
  BrowserSearchPayload,
  LocalSearchScopePreset,
  LocalSearchPayload
} from "../types";
import type {
  LocalSearchStreamReadPayload,
  LocalSearchStreamStartPayload
} from "../service";

const flushPromises = async (rounds = 6): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
};

const searchSettings: BrowserSearchSettings = {
  searchEngines: [{ id: "bing", label: "Bing", accentColor: "#008373" }],
  resultsPerEngine: 5,
  deepBudgetPreset: "medium",
  deepSiteExpansionEnabled: true,
  deepProactiveDomainGuessingEnabled: true,
  deepCrawlPolicy: "accessibility_only"
};

const webPayload: AggregatedSearchPayload = {
  query: "lyra",
  blendedResults: [],
  engineBuckets: [],
  fetchedAt: "2026-04-27T00:00:00.000Z",
  elapsedMs: 5
};

const localPayload: LocalSearchPayload = {
  query: "lyra",
  scopePreset: "home",
  roots: ["/Users/test"],
  results: [],
  truncated: false,
  elapsedMs: 3,
  stats: {
    scannedFiles: 2,
    scannedDirs: 1,
    contentScannedFiles: 1,
    matchedFiles: 0,
    skippedUnreadable: 0,
    skippedBinaryOrTooLarge: 0,
    usedIndex: true
  }
};

describe("standard search task", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("publishes loading, web/local results, and caches the finished payload", async () => {
    const taskCache = new Map<string, StandardSearchTask>();
    const resultCache = new Map<string, BrowserSearchPayload>();
    const published: BrowserSearchPayload[] = [];

    const task = startStandardSearchTask({
      desktopApi: null,
      cacheKey: "tab-1:standard:lyra:settings",
      tabId: "tab-1",
      query: "lyra",
      requestId: "request-1",
      searchSettings,
      taskCache,
      resultCache,
      publishTaskState: (_cacheKey, nextTask) => {
        published.push(nextTask.state);
      },
      services: {
        fetchAggregatedSearchPayload: vi.fn(async () => webPayload),
        startLocalSearchStream: vi.fn(async () => ({
          streamId: "local-stream-1",
          query: "lyra",
          scopePreset: "home" as LocalSearchScopePreset,
          roots: ["/Users/test"]
        })),
        readLocalSearchStream: vi.fn(async () => ({
          streamId: "local-stream-1",
          payload: localPayload,
          done: true
        }))
      }
    });

    expect(taskCache.get(task.cacheKey)).toBe(task);
    expect(published[0]?.web.status).toBe("loading");
    expect(published[0]?.local.status).toBe("loading");

    await flushPromises();

    const cached = resultCache.get(task.cacheKey);
    expect(taskCache.has(task.cacheKey)).toBe(false);
    expect(cached?.web.status).toBe("ready");
    expect(cached?.web.payload).toBe(webPayload);
    expect(cached?.local.status).toBe("ready");
    expect(cached?.local.payload).toBe(localPayload);
    expect(cached?.lastUpdatedAt).toBeDefined();
  });

  test("cancels active local streams and removes task cache entries", async () => {
    const taskCache = new Map<string, StandardSearchTask>();
    const resultCache = new Map<string, BrowserSearchPayload>();
    const cancelLocalSearchStream = vi.fn(async () => undefined);

    const task = startStandardSearchTask({
      desktopApi: null,
      cacheKey: "tab-1:standard:lyra:settings",
      tabId: "tab-1",
      query: "lyra",
      requestId: "request-1",
      searchSettings,
      taskCache,
      resultCache,
      publishTaskState: vi.fn(),
      services: {
        fetchAggregatedSearchPayload: vi.fn(
          () => new Promise<AggregatedSearchPayload>(() => undefined)
        ),
        startLocalSearchStream: vi.fn(async (): Promise<LocalSearchStreamStartPayload> => ({
          streamId: "local-stream-1",
          query: "lyra",
          scopePreset: "home",
          roots: []
        })),
        readLocalSearchStream: vi.fn(
          () => new Promise<LocalSearchStreamReadPayload | null>(() => undefined)
        ),
        cancelLocalSearchStream
      }
    });

    await flushPromises(2);
    task.cancel();

    expect(taskCache.has(task.cacheKey)).toBe(false);
    expect(resultCache.has(task.cacheKey)).toBe(false);
    expect(cancelLocalSearchStream).toHaveBeenCalledWith({
      desktopApi: null,
      streamId: "local-stream-1"
    });
  });

  test("stops waiting for stalled local streams without turning the whole local panel into an error", async () => {
    vi.useFakeTimers();
    const taskCache = new Map<string, StandardSearchTask>();
    const resultCache = new Map<string, BrowserSearchPayload>();
    const cancelLocalSearchStream = vi.fn(async () => undefined);
    const published: BrowserSearchPayload[] = [];

    const task = startStandardSearchTask({
      desktopApi: null,
      cacheKey: "tab-1:standard:lyra:settings",
      tabId: "tab-1",
      query: "lyra",
      requestId: "request-1",
      searchSettings,
      taskCache,
      resultCache,
      publishTaskState: (_cacheKey, nextTask) => {
        published.push(nextTask.state);
      },
      services: {
        fetchAggregatedSearchPayload: vi.fn(async () => webPayload),
        startLocalSearchStream: vi.fn(async (): Promise<LocalSearchStreamStartPayload> => ({
          streamId: "local-stream-1",
          query: "lyra",
          scopePreset: "home",
          roots: ["/Users/test"]
        })),
        readLocalSearchStream: vi.fn(
          () => new Promise<LocalSearchStreamReadPayload | null>(() => undefined)
        ),
        cancelLocalSearchStream,
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis)
      }
    });

    await flushPromises();
    expect(taskCache.get(task.cacheKey)).toBe(task);
    expect(published.at(-1)?.local.status).toBe("loading");

    await vi.advanceTimersByTimeAsync(LOCAL_SEARCH_STREAM_TIMEOUT_MS);
    await flushPromises();

    const cached = resultCache.get(task.cacheKey);
    expect(cancelLocalSearchStream).toHaveBeenCalledWith({
      desktopApi: null,
      streamId: "local-stream-1"
    });
    expect(taskCache.has(task.cacheKey)).toBe(false);
    expect(cached?.local.status).toBe("ready");
    expect(cached?.local.error).toBeUndefined();
  });

  test("starts zero-config local search without waiting for index status", async () => {
    const taskCache = new Map<string, StandardSearchTask>();
    const resultCache = new Map<string, BrowserSearchPayload>();
    const startLocalSearchStream = vi.fn(async (): Promise<LocalSearchStreamStartPayload> => ({
      streamId: "local-stream-1",
      query: "lyra",
      scopePreset: "home",
      roots: ["/Users/test"]
    }));

    startStandardSearchTask({
      desktopApi: null,
      cacheKey: "tab-1:standard:lyra:settings",
      tabId: "tab-1",
      query: "lyra",
      requestId: "request-1",
      searchSettings: {
        ...searchSettings,
        localProjectRoot: "/Users/test/project"
      },
      taskCache,
      resultCache,
      publishTaskState: vi.fn(),
      services: {
        fetchAggregatedSearchPayload: vi.fn(async () => webPayload),
        startLocalSearchStream,
        readLocalSearchStream: vi.fn(async () => ({
          streamId: "local-stream-1",
          payload: localPayload,
          done: true
        }))
      }
    });

    await flushPromises();

    expect(startLocalSearchStream).toHaveBeenCalledWith({
      desktopApi: null,
      request: {
        query: "lyra",
        limit: 60,
        context: {
          projectRoot: "/Users/test/project"
        }
      }
    });
  });
});
