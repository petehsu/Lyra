import { randomUUID } from "node:crypto";
import type {
  BrowserAxNode,
  BrowserAxSnapshot,
  WorkbenchBrowserAgentTargetMode
} from "../types";
import { browserAgentCacheKey } from "./agent-state-store";

// Observation metadata only. Node refs live until navigation / frame reload,
// independently of query snapshots, and are checked against the live DOM on act.
export const BROWSER_AX_SNAPSHOT_TTL_MS = 60_000;
const MAX_QUERY_SNAPSHOTS_PER_DOCUMENT = 16;

export type BrowserAxReferenceScope = {
  readonly hash: string;
  readonly tabId: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly nodes: Map<string, BrowserAxNode>;
  readonly nodeEpochs: Map<string, number>;
};

export type BrowserAxRefResolution =
  | { readonly kind: "ok"; readonly snapshot: BrowserAxSnapshot; readonly node: BrowserAxNode }
  | { readonly kind: "stale"; readonly reason: "missingSnapshot" }
  | { readonly kind: "unknownNode"; readonly snapshot: BrowserAxSnapshot };

const documentHashFromAxRef = (axRef: string): string | null => {
  // axRef format: ax:<documentHash>:<nodeHash>
  if (!axRef.startsWith("ax:")) {
    return null;
  }
  const parts = axRef.split(":");
  const documentHash = parts[1];
  const nodeHash = parts[2];
  if (parts.length !== 3 || documentHash === undefined || documentHash.length === 0 || nodeHash === undefined || nodeHash.length === 0) {
    return null;
  }
  return documentHash;
};

export const createBrowserAxSnapshotStore = () => {
  const snapshots = new Map<string, BrowserAxSnapshot>();
  const latestByKey = new Map<string, string>();
  const scopesByKey = new Map<string, BrowserAxReferenceScope>();
  const scopesByHash = new Map<string, BrowserAxReferenceScope>();

  const referenceScopeFor = (tabId: string, targetMode: WorkbenchBrowserAgentTargetMode): BrowserAxReferenceScope => {
    const key = browserAgentCacheKey(tabId, targetMode);
    let scope = scopesByKey.get(key);
    if (scope === undefined) {
      scope = { hash: randomUUID().replaceAll("-", ""), tabId, targetMode, nodes: new Map(), nodeEpochs: new Map() };
      scopesByKey.set(key, scope);
      scopesByHash.set(scope.hash, scope);
    }
    return scope;
  };

  const rememberSnapshot = (snapshot: BrowserAxSnapshot, scope: BrowserAxReferenceScope): boolean => {
    const key = browserAgentCacheKey(snapshot.tabId, snapshot.targetMode);
    // A map that finishes after navigation cannot resurrect the prior document.
    if (scopesByKey.get(key) !== scope) return false;
    const previous = getLatest(snapshot.tabId, snapshot.targetMode);
    for (const [axRef, node] of snapshot.nodesByAxRef) {
      if (snapshot.mapEpoch >= (scope.nodeEpochs.get(axRef) ?? -1)) {
        scope.nodes.set(axRef, node);
        scope.nodeEpochs.set(axRef, snapshot.mapEpoch);
      }
    }
    snapshots.set(snapshot.snapshotId, snapshot);
    if (previous === undefined || snapshot.mapEpoch >= previous.mapEpoch) latestByKey.set(key, snapshot.snapshotId);
    const history = [...snapshots.values()]
      .filter((entry) => entry.tabId === snapshot.tabId && entry.targetMode === snapshot.targetMode)
      .sort((a, b) => b.mapEpoch - a.mapEpoch);
    for (const expired of history.slice(MAX_QUERY_SNAPSHOTS_PER_DOCUMENT)) snapshots.delete(expired.snapshotId);
    return true;
  };

  const getSnapshot = (snapshotId: string): BrowserAxSnapshot | undefined =>
    snapshots.get(snapshotId);

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
    const documentHash = documentHashFromAxRef(axRef);
    if (documentHash === null) {
      return { kind: "stale", reason: "missingSnapshot" };
    }
    const scope = scopesByHash.get(documentHash);
    const snapshot = scope === undefined ? undefined : getLatest(scope.tabId, scope.targetMode);
    if (snapshot === undefined) {
      return { kind: "stale", reason: "missingSnapshot" };
    }
    const node = scope?.nodes.get(axRef);
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
    const scope = scopesByKey.get(cacheKey);
    if (scope !== undefined) scopesByHash.delete(scope.hash);
    scopesByKey.delete(cacheKey);
    for (const [snapshotId, snapshot] of snapshots) {
      if (snapshot.tabId === tabId && snapshot.targetMode === targetMode) {
        snapshots.delete(snapshotId);
      }
    }
  };

  const dispose = (): void => {
    snapshots.clear();
    latestByKey.clear();
    scopesByKey.clear();
    scopesByHash.clear();
  };

  return {
    referenceScopeFor,
    rememberSnapshot,
    getSnapshot,
    getLatest,
    resolveAxRef,
    invalidate,
    dispose
  };
};

export type BrowserAxSnapshotStore = ReturnType<typeof createBrowserAxSnapshotStore>;
