import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  SearchDeepSnapshot,
  SearchDeepStreamReadResponse
} from "../../../../shared/desktop-bridge";
import { startDeepSearchTask } from "../deep-search-task";
import type {
  BrowserSearchSettings,
  DeepSearchTask
} from "../runtime-types";
import type { DeepSearchViewState } from "../types";

const flushPromises = async (rounds = 6): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
};

const searchSettings: BrowserSearchSettings = {
  searchEngines: [{ id: "bing", label: "Bing", accentColor: "#008373" }],
  resultsPerEngine: 5,
  localScopePreset: "home",
  localCustomRoots: [],
  localIncludeHidden: false,
  localEnableFuzzy: true,
  localEnableContent: true,
  localEnableExtensionMatch: true,
  deepBudgetPreset: "medium",
  deepSiteExpansionEnabled: true,
  deepProactiveDomainGuessingEnabled: true,
  deepCrawlPolicy: "accessibility_only"
};

const createSnapshot = (phase: SearchDeepSnapshot["phase"]): SearchDeepSnapshot => ({
  query: "lyra",
  budgetPreset: "medium",
  phase,
  nodes: [],
  edges: [],
  web: {
    status: "ready",
    engineBuckets: [],
    blendedCount: 0,
    siteExpansion: {
      status: "idle",
      domainCandidates: 0,
      verifiedDomains: 0,
      discoveredSubdomains: 0,
      visitedPages: 0,
      queuedPages: 0,
      droppedPages: 0,
      guessAttempts: 0
    }
  },
  local: {
    status: "ready",
    scopePreset: "home",
    roots: [],
    elapsedMs: 0,
    stats: {
      scannedFiles: 0,
      scannedDirs: 0,
      contentScannedFiles: 0,
      matchedFiles: 0,
      skippedUnreadable: 0,
      skippedBinaryOrTooLarge: 0,
      usedIndex: false
    }
  },
  stats: {
    dedupedResults: 0,
    derivedQueries: 0,
    expansionRounds: 0
  },
  lastUpdatedAt: "2026-04-27T00:00:00.000Z"
});

afterEach(() => {
  vi.useRealTimers();
});

describe("deep search task", () => {
  test("starts a stream, polls it, and caches the finished state", async () => {
    vi.useFakeTimers();
    const taskCache = new Map<string, DeepSearchTask>();
    const resultCache = new Map<string, DeepSearchViewState>();
    const published: DeepSearchViewState[] = [];

    const task = startDeepSearchTask({
      desktopApi: null,
      cacheKey: "tab-1:deep:lyra:settings",
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
        startDeepSearchStream: vi.fn(async () => ({
          streamId: "deep-stream-1",
          snapshot: createSnapshot("streaming")
        })),
        readDeepSearchStream: vi.fn(async () => ({
          streamId: "deep-stream-1",
          snapshot: createSnapshot("completed"),
          done: true
        })),
        setTimeout,
        clearTimeout
      }
    });

    expect(taskCache.get(task.cacheKey)).toBe(task);
    expect(published[0]?.status).toBe("loading");

    await flushPromises();
    expect(task.streamId).toBe("deep-stream-1");

    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();

    const cached = resultCache.get(task.cacheKey);
    expect(cached?.streamId).toBe("deep-stream-1");
    expect(cached?.status).toBe("ready");
    expect(cached?.done).toBe(true);
    expect(cached?.snapshot.phase).toBe("completed");
  });

  test("cancels active streams and removes task cache entries", async () => {
    vi.useFakeTimers();
    const taskCache = new Map<string, DeepSearchTask>();
    const resultCache = new Map<string, DeepSearchViewState>();
    const cancelDeepSearchStream = vi.fn(async () => undefined);

    const task = startDeepSearchTask({
      desktopApi: null,
      cacheKey: "tab-1:deep:lyra:settings",
      tabId: "tab-1",
      query: "lyra",
      requestId: "request-1",
      searchSettings,
      taskCache,
      resultCache,
      publishTaskState: vi.fn(),
      services: {
        startDeepSearchStream: vi.fn(async () => ({
          streamId: "deep-stream-1",
          snapshot: createSnapshot("streaming")
        })),
        readDeepSearchStream: vi.fn(
          () => new Promise<SearchDeepStreamReadResponse | null>(() => undefined)
        ),
        cancelDeepSearchStream,
        setTimeout,
        clearTimeout
      }
    });

    await flushPromises();
    task.cancel();

    expect(taskCache.has(task.cacheKey)).toBe(false);
    expect(resultCache.has(task.cacheKey)).toBe(false);
    expect(cancelDeepSearchStream).toHaveBeenCalledWith({
      desktopApi: null,
      streamId: "deep-stream-1"
    });
  });
});
