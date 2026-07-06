import type { WorkbenchBrowserAgentTargetMode } from "../types";
import type { WorkbenchBrowserAxActionResult } from "../types";

// ActCache mirrors the ax-snapshot-store pattern. It records successful
// `axActOnNode` results keyed by (page url + snapshot hash + axRef + interaction
// + optional NL intent) so that repeatable production/CI automations can replay
// a verified NL→axRef mapping without re-mapping the page or re-running the LLM
// selection step.
//
// Key strictness is intentional: the key folds `snapshotHash`, which changes on
// every `axMapAgentPage` call. A hit therefore requires the *same* AX snapshot,
// the *same* target node, the *same* action verb, and (when provided) the *same*
// natural-language intent. This makes hits rare outside of deliberate
// record/replay scenarios, which is the intended safety property — we never
// replay an act across a page that has been re-mapped, navigated, or mutated.
//
// The cache is process-global, TTL'd, and LRU-bounded. It is invalidated per-tab
// whenever the AX snapshot store is invalidated (navigation/frame reload), via
// `invalidate(tabId)`.

export const BROWSER_AX_ACT_CACHE_TTL_MS = 60_000;
export const BROWSER_AX_ACT_CACHE_MAX_ENTRIES = 64;

export type BrowserAxActCacheEntry = {
  readonly tabId: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly axRef: string;
  readonly interaction: string;
  readonly intent?: string;
  readonly snapshotHash: string;
  readonly url: string;
  readonly result: WorkbenchBrowserAxActionResult;
  readonly recordedAt: number;
  readonly ttlMs: number;
};

export type BrowserAxActCacheLookup = {
  readonly hit: boolean;
  readonly entry?: BrowserAxActCacheEntry;
};

export const buildAxActCacheKey = (parts: {
  readonly url: string;
  readonly snapshotHash: string;
  readonly axRef: string;
  readonly interaction: string;
  readonly intent?: string;
}): string =>
  [parts.url, parts.snapshotHash, parts.axRef, parts.interaction, parts.intent ?? ""].join("|");

const entryIsExpired = (entry: BrowserAxActCacheEntry, now: number): boolean =>
  now - entry.recordedAt > entry.ttlMs;

export const createBrowserActCache = () => {
  const entries = new Map<string, BrowserAxActCacheEntry>();

  const evictExpired = (now: number): void => {
    for (const [key, entry] of entries) {
      if (entryIsExpired(entry, now)) {
        entries.delete(key);
      }
    }
  };

  const get = (key: string): BrowserAxActCacheLookup => {
    evictExpired(Date.now());
    const entry = entries.get(key);
    if (entry === undefined) {
      return { hit: false };
    }
    if (entryIsExpired(entry, Date.now())) {
      entries.delete(key);
      return { hit: false };
    }
    // Move-to-end for LRU ordering: Map preserves insertion order, so re-insert.
    entries.delete(key);
    entries.set(key, entry);
    return { hit: true, entry };
  };

  const set = (entry: BrowserAxActCacheEntry): void => {
    evictExpired(Date.now());
    const key = buildAxActCacheKey({
      url: entry.url,
      snapshotHash: entry.snapshotHash,
      axRef: entry.axRef,
      interaction: entry.interaction,
      ...(entry.intent !== undefined ? { intent: entry.intent } : {})
    });
    // LRU bound: drop the oldest entry when at capacity.
    if (entries.size >= BROWSER_AX_ACT_CACHE_MAX_ENTRIES && !entries.has(key)) {
      const firstKey = entries.keys().next().value;
      if (firstKey !== undefined) {
        entries.delete(firstKey);
      }
    }
    entries.set(key, entry);
  };

  const invalidate = (
    tabId: string,
    _targetMode?: WorkbenchBrowserAgentTargetMode
  ): void => {
    for (const [key, entry] of entries) {
      if (entry.tabId === tabId) {
        entries.delete(key);
      }
    }
  };

  const dispose = (): void => {
    entries.clear();
  };

  return {
    get,
    set,
    invalidate,
    dispose
  };
};

export type BrowserAxActCache = ReturnType<typeof createBrowserActCache>;