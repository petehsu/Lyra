import { randomUUID } from "node:crypto";
import { presentBrowserMap, type BrowserMapView } from "../workbench-browser/view-manager-runtime/agent-map-presentation";
import type { WorkbenchBrowserAgentObservation } from "../workbench-browser/types";

const TTL_MS = 5 * 60_000;
const MAX_SNAPSHOTS = 16;
const MAX_CONTROLS = 32_000;
const expired = "Map snapshot expired or cursor does not match this tab/query/region. Call browser_map without cursor to obtain a current map.";
type Snapshot = { key: string; query: string; region: string; createdAt: number; maxChars?: number; observation: WorkbenchBrowserAgentObservation };

/** Pagination is a bounded snapshot of the observed index. A changing label or
 * a newly mounted feed row cannot reshuffle page two. Actions still resolve refs
 * against live DOM identity, and fresh queries always collect a new observation. */
export const createLumenMapPager = () => {
  const snapshots = new Map<string, Snapshot>();
  const prune = (now: number) => {
    for (const [id, snapshot] of snapshots) if (now - snapshot.createdAt > TTL_MS) snapshots.delete(id);
    let count = [...snapshots.values()].reduce((sum, item) => sum + item.observation.elements.length, 0);
    while (snapshots.size > MAX_SNAPSHOTS || count > MAX_CONTROLS) {
      const first = snapshots.entries().next().value;
      if (!first) break;
      count -= first[1].observation.elements.length; snapshots.delete(first[0]);
    }
  };
  const filters = (view: BrowserMapView) => ({ query: view.query?.trim() ?? "", region: view.region?.trim() ?? "" });
  const render = (id: string, snapshot: Snapshot, view: BrowserMapView) => {
    const text = presentBrowserMap(snapshot.observation, view, snapshot.maxChars ?? 5_860).replace(/Next cursor=([^\s]+)/, `Next cursor=${id}~$1`);
    return { observation: snapshot.observation, mapAppendix: text + "\nSnapshot pagination; actions revalidate live targets. Omit cursor to refresh." };
  };
  return {
    start(key: string, observation: WorkbenchBrowserAgentObservation, view: BrowserMapView, now = Date.now(), maxChars?: number) {
      const id = randomUUID();
      const snapshot: Snapshot = { key, ...filters(view), createdAt: now, ...(maxChars === undefined ? {} : { maxChars }), observation: structuredClone(observation) };
      snapshots.set(id, snapshot); prune(now);
      return render(id, snapshot, view);
    },
    next(key: string, view: BrowserMapView, url?: string, now = Date.now()) {
      prune(now);
      const [id, cursor, extra] = (view.cursor ?? "").split("~");
      const snapshot = id ? snapshots.get(id) : undefined;
      const filter = filters(view);
      if (!snapshot || !cursor || extra || snapshot.key !== key || snapshot.query !== filter.query
        || snapshot.region !== filter.region || url !== undefined && snapshot.observation.url !== url) throw new Error(expired);
      return render(id!, snapshot, { ...view, cursor });
    }
  };
};
