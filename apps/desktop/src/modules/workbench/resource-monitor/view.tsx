import { useEffect, useMemo, useState } from "react";

import type {
  LyraDesktopApi,
  LyraResourceLifecycleState,
  LyraResourceSnapshot
} from "../../../shared/desktop-bridge";

export type ResourceMonitorSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: ResourceMonitorSurfaceLabels;
};

export type ResourceMonitorSurfaceLabels = {
  readonly title: string;
  readonly subtitle: string;
  readonly pid: string;
  readonly resources: string;
  readonly coreGroups: string;
  readonly tombstoned: string;
  readonly generation: string;
  readonly coreSharing: string;
  readonly empty: string;
  readonly views: string;
  readonly state: string;
  readonly kind: string;
  readonly label: string;
  readonly core: string;
  readonly lifecycleStates: Record<LyraResourceLifecycleState, string>;
};

const EMPTY_SNAPSHOT: LyraResourceSnapshot = {
  generation: 0,
  capturedAt: 0,
  process: {
    pid: 0,
    memoryBytes: 0
  },
  resources: [],
  coreGroups: []
};

const formatBytes = (value: number): string => {
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB"];
  let next = value / 1024;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  return `${next.toFixed(next >= 100 ? 0 : 1)} ${units[unitIndex]}`;
};

const STATE_ORDER: readonly LyraResourceLifecycleState[] = [
  "foreground",
  "visible",
  "hot-hidden",
  "warm-suspended",
  "frozen",
  "tombstoned",
  "restoring",
  "archived"
];

export const ResourceMonitorSurface = ({
  desktopApi,
  labels
}: ResourceMonitorSurfaceProps): JSX.Element => {
  const [snapshot, setSnapshot] = useState<LyraResourceSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    const resourcesApi = desktopApi?.resources;
    if (resourcesApi === undefined) {
      return;
    }
    let disposed = false;
    const refresh = (): void => {
      void resourcesApi.readSnapshot().then((next) => {
        if (!disposed) {
          setSnapshot(next);
        }
      }).catch(() => undefined);
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    const unsubscribe = resourcesApi.onEvent((event) => {
      if (event.kind === "snapshot") {
        setSnapshot(event.snapshot);
        return;
      }
      refresh();
    });
    return () => {
      disposed = true;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [desktopApi]);

  const stateCounts = useMemo(
    () => STATE_ORDER.map((state) => ({
      state,
      count: snapshot.resources.filter((resource) => resource.lifecycleState === state).length
    })).filter((entry) => entry.count > 0),
    [snapshot.resources]
  );

  return (
    <section className="lyra-resource-monitor" aria-label="resource-monitor-surface">
      <header className="lyra-resource-monitor-header">
        <div>
          <h2>{labels.title}</h2>
          <p>{labels.subtitle}</p>
        </div>
        <div className="lyra-resource-monitor-process">
          <span>{labels.pid} {snapshot.process.pid}</span>
          <strong>{formatBytes(snapshot.process.memoryBytes)}</strong>
        </div>
      </header>

      <section className="lyra-resource-monitor-metrics" aria-label="resource-monitor-metrics">
        <div>
          <span>{labels.resources}</span>
          <strong>{snapshot.resources.length}</strong>
        </div>
        <div>
          <span>{labels.coreGroups}</span>
          <strong>{snapshot.coreGroups.length}</strong>
        </div>
        <div>
          <span>{labels.tombstoned}</span>
          <strong>
            {snapshot.resources.filter((resource) => resource.lifecycleState === "tombstoned").length}
          </strong>
        </div>
        <div>
          <span>{labels.generation}</span>
          <strong>{snapshot.generation}</strong>
        </div>
      </section>

      <section className="lyra-resource-monitor-body">
        <aside className="lyra-resource-monitor-groups" aria-label="resource-monitor-core-groups">
          <h3>{labels.coreSharing}</h3>
          {snapshot.coreGroups.length === 0 ? (
            <div className="lyra-resource-monitor-empty">{labels.empty}</div>
          ) : (
            snapshot.coreGroups.map((group) => (
              <article key={group.coreKey} className="lyra-resource-monitor-group">
                <strong>{group.coreKey}</strong>
                <span>{group.viewCount} {labels.views} / {group.tombstonedCount} {labels.tombstoned}</span>
              </article>
            ))
          )}
        </aside>

        <section className="lyra-resource-monitor-table" aria-label="resource-monitor-resources">
          <header>
            <h3>{labels.resources}</h3>
            <div className="lyra-resource-monitor-state-strip">
              {stateCounts.map((entry) => (
                <span key={entry.state}>{labels.lifecycleStates[entry.state]}: {entry.count}</span>
              ))}
            </div>
          </header>
          <div className="lyra-resource-monitor-grid">
            <div className="lyra-resource-monitor-grid-head">{labels.state}</div>
            <div className="lyra-resource-monitor-grid-head">{labels.kind}</div>
            <div className="lyra-resource-monitor-grid-head">{labels.label}</div>
            <div className="lyra-resource-monitor-grid-head">{labels.core}</div>
            {snapshot.resources.map((resource) => (
              <div className="lyra-resource-monitor-row" key={resource.resourceId}>
                <span className={`lyra-resource-monitor-state lyra-resource-monitor-state-${resource.lifecycleState}`}>
                  {labels.lifecycleStates[resource.lifecycleState]}
                </span>
                <span>{resource.kind}</span>
                <strong>{resource.label}</strong>
                <small>{resource.coreKey}</small>
              </div>
            ))}
          </div>
        </section>
      </section>
    </section>
  );
};
