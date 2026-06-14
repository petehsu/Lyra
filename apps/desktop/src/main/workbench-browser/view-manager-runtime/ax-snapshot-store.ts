import type {
  BrowserAxNode,
  BrowserAxSnapshot,
  WorkbenchBrowserAgentTargetMode
} from "../types";
import { browserAgentCacheKey } from "./agent-state-store";

export const BROWSER_AX_SNAPSHOT_TTL_MS = 60_000;

export type BrowserAxRefResolution =
  | { readonly kind: "ok"; readonly snapshot: BrowserAxSnapshot; readonly node: BrowserAxNode }
  | { readonly kind: "stale"; readonly reason: "missingSnapshot" | "expired" }
  | { readonly kind: "unknownNode"; readonly snapshot: BrowserAxSnapshot };

const snapshotIsExpired = (snapshot: BrowserAxSnapshot, now: number): boolean =>
  now - snapshot.createdAt > snapshot.ttlMs;

const snapshotHashFromAxRef = (axRef: string): string | null => {
  // axRef format: ax:<snapshotHash>:<nodeHash>
  if (!axRef.startsWith("ax:")) {
    return null;
  }
  const parts = axRef.split(":");
  const snapshotHash = parts[1];
  const nodeHash = parts[2];
  if (parts.length !== 3 || snapshotHash === undefined || snapshotHash.length === 0 || nodeHash === undefined || nodeHash.length === 0) {
    return null;
  }
  return snapshotHash;
};

export const createBrowserAxSnapshotStore = () => {
  const snapshots = new Map<string, BrowserAxSnapshot>();
  const latestByKey = new Map<string, string>();
  const snapshotIdByHash = new Map<string, string>();

  const evictExpired = (now: number): void => {
    for (const [snapshotId, snapshot] of snapshots) {
      if (snapshotIsExpired(snapshot, now)) {
        snapshots.delete(snapshotId);
        snapshotIdByHash.delete(snapshot.snapshotHash);
        const cacheKey = browserAgentCacheKey(snapshot.tabId, snapshot.targetMode);
        if (latestByKey.get(cacheKey) === snapshotId) {
          latestByKey.delete(cacheKey);
        }
      }
    }
  };

  const rememberSnapshot = (snapshot: BrowserAxSnapshot): void => {
    evictExpired(Date.now());
    snapshots.set(snapshot.snapshotId, snapshot);
    snapshotIdByHash.set(snapshot.snapshotHash, snapshot.snapshotId);
    latestByKey.set(browserAgentCacheKey(snapshot.tabId, snapshot.targetMode), snapshot.snapshotId);
  };

  const getSnapshot = (snapshotId: string): BrowserAxSnapshot | undefined => {
    const snapshot = snapshots.get(snapshotId);
    if (snapshot === undefined) {
      return undefined;
    }
    if (snapshotIsExpired(snapshot, Date.now())) {
      return undefined;
    }
    return snapshot;
  };

  const getLatest = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): BrowserAxSnapshot | undefined => {
    const snapshotId = latestByKey.get(browserAgentCacheKey(tabId, targetMode));
    if (snapshotId === undefined) {
      return undefined;
    }
    return getSnapshot(snapshotId);
  };

  const resolveAxRef = (axRef: string): BrowserAxRefResolution => {
    const snapshotHash = snapshotHashFromAxRef(axRef);
    if (snapshotHash === null) {
      return { kind: "stale", reason: "missingSnapshot" };
    }
    const snapshotId = snapshotIdByHash.get(snapshotHash);
    const snapshot = snapshotId === undefined ? undefined : snapshots.get(snapshotId);
    if (snapshot === undefined) {
      return { kind: "stale", reason: "missingSnapshot" };
    }
    if (snapshotIsExpired(snapshot, Date.now())) {
      return { kind: "stale", reason: "expired" };
    }
    const node = snapshot.nodesByAxRef.get(axRef);
    if (node === undefined) {
      return { kind: "unknownNode", snapshot };
    }
    return { kind: "ok", snapshot, node };
  };

  const invalidate = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    _reason: "navigation" | "frameReload" = "navigation"
  ): void => {
    const cacheKey = browserAgentCacheKey(tabId, targetMode);
    latestByKey.delete(cacheKey);
    for (const [snapshotId, snapshot] of snapshots) {
      if (snapshot.tabId === tabId && snapshot.targetMode === targetMode) {
        snapshots.delete(snapshotId);
        snapshotIdByHash.delete(snapshot.snapshotHash);
      }
    }
  };

  const dispose = (): void => {
    snapshots.clear();
    latestByKey.clear();
    snapshotIdByHash.clear();
  };

  return {
    rememberSnapshot,
    getSnapshot,
    getLatest,
    resolveAxRef,
    invalidate,
    dispose
  };
};

export type BrowserAxSnapshotStore = ReturnType<typeof createBrowserAxSnapshotStore>;
