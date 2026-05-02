import { ExternalLink, Info, Pause, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  LyraDesktopApi,
  LyraResourceLifecycleState,
  LyraResourceMonitorScope,
  LyraResourceSnapshot,
  LyraSystemActivity,
  LyraSystemActivityAction,
  LyraSystemActivityKind,
  LyraSystemLoadSample,
  LyraSystemMetricSnapshot,
  LyraSystemSnapshot
} from "../../../shared/desktop-bridge";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

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
  readonly scopeLyra: string;
  readonly scopeAll: string;
  readonly runtime: string;
  readonly kernel: string;
  readonly unifiedLoad: string;
  readonly cpu: string;
  readonly memory: string;
  readonly buffers: string;
  readonly disk: string;
  readonly network: string;
  readonly gpu: string;
  readonly lyra: string;
  readonly activities: string;
  readonly usage: string;
  readonly actions: string;
  readonly unavailable: string;
  readonly cores: string;
  readonly loadAverage: string;
  readonly networkReceived: string;
  readonly networkTransmitted: string;
  readonly free: string;
  readonly actionFailed: string;
  readonly lifecycleStates: Record<LyraResourceLifecycleState, string>;
  readonly activityKinds: Record<LyraSystemActivityKind, string>;
  readonly activityActions: Record<LyraSystemActivityAction, string>;
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

const EMPTY_METRIC: LyraSystemMetricSnapshot = {
  supported: false,
  value: null,
  unit: "count"
};

const EMPTY_SYSTEM_SNAPSHOT: LyraSystemSnapshot = {
  capturedAt: 0,
  runtimeName: "Lyra Sentinel Runtime",
  kernelName: "Lyra Native Resource Kernel",
  loadScore: 0,
  cpu: { ...EMPTY_METRIC, unit: "percent" },
  memory: { ...EMPTY_METRIC, unit: "bytes" },
  buffers: { ...EMPTY_METRIC, unit: "bytes" },
  disk: { ...EMPTY_METRIC, unit: "bytes" },
  network: { ...EMPTY_METRIC, unit: "bytes" },
  gpu: { ...EMPTY_METRIC, unit: "percent" },
  lyra: { ...EMPTY_METRIC, unit: "count" },
  activities: []
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

const formatBytes = (value: number): string => {
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let next = value / 1024;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  return `${next.toFixed(next >= 100 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatPercent = (value: number | null | undefined, fallback: string): string => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return fallback;
  }
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
};

const formatMetricValue = (
  metric: LyraSystemMetricSnapshot,
  labels: ResourceMonitorSurfaceLabels
): string => {
  if (metric.supported === false || metric.value === null) {
    return labels.unavailable;
  }
  if (metric.unit === "bytes") {
    if (typeof metric.used === "number" && typeof metric.total === "number" && metric.total > 0) {
      return `${formatBytes(metric.used)} / ${formatBytes(metric.total)}`;
    }
    return formatBytes(metric.value);
  }
  if (metric.unit === "percent" || metric.unit === "score") {
    return formatPercent(metric.value, labels.unavailable);
  }
  return `${Math.round(metric.value)}`;
};

const fallbackLabel = (value: string | undefined, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const loadToneClassName = (score: number): string => {
  if (score >= 82) {
    return "lyra-resource-monitor-load-line-critical";
  }
  if (score >= 58) {
    return "lyra-resource-monitor-load-line-high";
  }
  if (score >= 32) {
    return "lyra-resource-monitor-load-line-medium";
  }
  return "lyra-resource-monitor-load-line-low";
};

const actionIcon = (action: LyraSystemActivityAction): JSX.Element => {
  switch (action) {
    case "restart":
      return <RotateCcw size={13} aria-hidden="true" />;
    case "suspend":
      return <Pause size={13} aria-hidden="true" />;
    case "resume":
      return <Play size={13} aria-hidden="true" />;
    case "inspect":
      return <Info size={13} aria-hidden="true" />;
    case "reveal":
      return <ExternalLink size={13} aria-hidden="true" />;
    case "kill":
    default:
      return <X size={13} aria-hidden="true" />;
  }
};

const formatActivityUsage = (
  activity: Pick<LyraSystemActivity, "cpuPercent" | "memoryBytes" | "loadScore">,
  labels: ResourceMonitorSurfaceLabels
): string => {
  const parts = [
    typeof activity.cpuPercent === "number" ? formatPercent(activity.cpuPercent, labels.unavailable) : "",
    typeof activity.memoryBytes === "number" ? formatBytes(activity.memoryBytes) : "",
    typeof activity.loadScore === "number" ? formatPercent(activity.loadScore, labels.unavailable) : ""
  ].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" / ") : labels.unavailable;
};

const LoadTrace = ({
  samples,
  fallbackScore
}: {
  readonly samples: readonly LyraSystemLoadSample[];
  readonly fallbackScore: number;
}): JSX.Element => {
  const safeFallbackScore = Math.max(4, Math.min(96, fallbackScore));
  const fallbackSamples = Array.from({ length: 24 }, (_item, index) => {
    const pulse = [0, 8, -5, 14, -9, 5, -3, 10][index % 8] ?? 0;
    return {
      score: Math.max(2, Math.min(98, safeFallbackScore + pulse)),
      capturedAt: index
    };
  });
  const visibleSamples = samples.length > 1
    ? samples
    : fallbackSamples;
  const width = 220;
  const height = 46;
  const step = width / Math.max(1, visibleSamples.length - 1);
  return (
    <svg
      className="lyra-resource-monitor-load-trace"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {visibleSamples.slice(1).map((sample, index) => {
        const previous = visibleSamples[index] ?? sample;
        const x1 = index * step;
        const x2 = (index + 1) * step;
        const y1 = height - (Math.max(0, Math.min(100, previous.score)) / 100) * (height - 8) - 4;
        const y2 = height - (Math.max(0, Math.min(100, sample.score)) / 100) * (height - 8) - 4;
        const toneClassName = loadToneClassName((previous.score + sample.score) / 2);
        return (
          <line
            key={`${sample.capturedAt}-${index}`}
            className={`lyra-resource-monitor-load-line ${toneClassName}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
          />
        );
      })}
    </svg>
  );
};

const MetricCard = ({
  label,
  value,
  detail
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
}): JSX.Element => (
  <div>
    <span>{label}</span>
    <strong>{value}</strong>
    {detail !== undefined && detail.length > 0 ? <small>{detail}</small> : null}
  </div>
);

export const ResourceMonitorSurface = ({
  desktopApi,
  labels
}: ResourceMonitorSurfaceProps): JSX.Element => {
  const [scope, setScope] = useState<LyraResourceMonitorScope>("lyra");
  const [snapshot, setSnapshot] = useState<LyraResourceSnapshot>(EMPTY_SNAPSHOT);
  const [systemSnapshot, setSystemSnapshot] = useState<LyraSystemSnapshot>(EMPTY_SYSTEM_SNAPSHOT);
  const [loadSamples, setLoadSamples] = useState<readonly LyraSystemLoadSample[]>([]);
  const [actionNonce, setActionNonce] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

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

  useEffect(() => {
    const resourcesApi = desktopApi?.resources;
    if (resourcesApi === undefined || scope !== "all") {
      return;
    }
    let disposed = false;
    const refresh = (): void => {
      void resourcesApi.readSystemSnapshot().then((next) => {
        if (disposed) {
          return;
        }
        setSystemSnapshot(next);
        setLoadSamples((current) => [
          ...current.slice(-47),
          {
            score: next.loadScore,
            capturedAt: next.capturedAt
          }
        ]);
      }).catch(() => undefined);
    };
    refresh();
    const interval = window.setInterval(refresh, 1500);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [actionNonce, desktopApi, scope]);

  const stateCounts = useMemo(
    () => STATE_ORDER.map((state) => ({
      state,
      count: snapshot.resources.filter((resource) => resource.lifecycleState === state).length
    })).filter((entry) => entry.count > 0),
    [snapshot.resources]
  );

  const systemMetricCards = useMemo(
    () => [
      {
        id: "cpu",
        label: labels.cpu,
        value: formatMetricValue(systemSnapshot.cpu, labels),
        detail: [
          typeof systemSnapshot.cpu.logicalCores === "number"
            ? `${systemSnapshot.cpu.logicalCores} ${labels.cores}`
            : "",
          typeof systemSnapshot.cpu.loadAverage1m === "number"
            ? `${labels.loadAverage} ${systemSnapshot.cpu.loadAverage1m.toFixed(2)}`
            : ""
        ].filter(Boolean).join(" / ")
      },
      {
        id: "memory",
        label: labels.memory,
        value: formatMetricValue(systemSnapshot.memory, labels),
        detail: systemSnapshot.memory.free !== undefined
          ? `${labels.free}: ${formatBytes(systemSnapshot.memory.free)}`
          : ""
      },
      {
        id: "buffers",
        label: labels.buffers,
        value: formatMetricValue(systemSnapshot.buffers, labels),
        detail: systemSnapshot.buffers.detail
      },
      {
        id: "disk",
        label: labels.disk,
        value: formatMetricValue(systemSnapshot.disk, labels),
        detail: systemSnapshot.disk.free !== undefined
          ? `${labels.free}: ${formatBytes(systemSnapshot.disk.free)}`
          : ""
      },
      {
        id: "network",
        label: labels.network,
        value: formatMetricValue(systemSnapshot.network, labels),
        detail: [
          systemSnapshot.network.receivedBytes !== undefined
            ? `${labels.networkReceived} ${formatBytes(systemSnapshot.network.receivedBytes)}`
            : "",
          systemSnapshot.network.transmittedBytes !== undefined
            ? `${labels.networkTransmitted} ${formatBytes(systemSnapshot.network.transmittedBytes)}`
            : ""
        ].filter(Boolean).join(" / ")
      },
      {
        id: "gpu",
        label: labels.gpu,
        value: formatMetricValue(systemSnapshot.gpu, labels),
        detail: systemSnapshot.gpu.detail
      },
      {
        id: "lyra",
        label: labels.lyra,
        value: formatMetricValue(systemSnapshot.lyra, labels),
        detail: `${labels.coreGroups}: ${systemSnapshot.lyra.coreGroups ?? 0} / ${labels.tombstoned}: ${systemSnapshot.lyra.tombstoned ?? 0}`
      }
    ],
    [labels, systemSnapshot]
  );

  const runActivityAction = (
    activityId: string,
    action: LyraSystemActivityAction
  ): void => {
    const resourcesApi = desktopApi?.resources;
    if (resourcesApi === undefined) {
      return;
    }
    void resourcesApi.requestActivityAction({
      activityId,
      action
    }).then((result) => {
      setActionMessage(result.ok ? null : `${labels.actionFailed}: ${result.message}`);
      setActionNonce((current) => current + 1);
    }).catch((error: unknown) => {
      setActionMessage(`${labels.actionFailed}: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const lyraResourceActions: readonly LyraSystemActivityAction[] = [
    "restart",
    "suspend",
    "resume",
    "kill"
  ];
  const titlebarContribution = useMemo(
    () => ({
      ariaLabel: labels.title,
      content: (
        <>
          <div className="lyra-titlebar-context-controls">
            <button
              type="button"
              role="tab"
              aria-selected={scope === "lyra"}
              className={
                scope === "lyra"
                  ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active lyra-resource-monitor-titlebar-scope-button"
                  : "lyra-titlebar-context-text-button lyra-resource-monitor-titlebar-scope-button"
              }
              onClick={() => {
                setScope("lyra");
              }}
            >
              {labels.scopeLyra}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "all"}
              className={
                scope === "all"
                  ? "lyra-titlebar-context-text-button lyra-titlebar-context-button-active lyra-resource-monitor-titlebar-scope-button"
                  : "lyra-titlebar-context-text-button lyra-resource-monitor-titlebar-scope-button"
              }
              onClick={() => {
                setScope("all");
              }}
            >
              {labels.scopeAll}
            </button>
          </div>
          <span className="lyra-titlebar-context-chip lyra-resource-monitor-titlebar-pid">
            {labels.pid} {snapshot.process.pid}
          </span>
          <span className="lyra-titlebar-context-chip lyra-resource-monitor-titlebar-memory">
            {formatBytes(snapshot.process.memoryBytes)}
          </span>
        </>
      )
    }),
    [
      labels,
      scope,
      snapshot.process.memoryBytes,
      snapshot.process.pid
    ]
  );
  useWorkbenchTitlebarContribution(titlebarContribution);

  return (
    <section className="lyra-resource-monitor" aria-label="resource-monitor-surface">
      {scope === "lyra" ? (
        <>
          <section className="lyra-resource-monitor-metrics" aria-label="resource-monitor-metrics">
            <MetricCard label={labels.resources} value={`${snapshot.resources.length}`} />
            <MetricCard label={labels.coreGroups} value={`${snapshot.coreGroups.length}`} />
            <MetricCard
              label={labels.tombstoned}
              value={`${snapshot.resources.filter((resource) => resource.lifecycleState === "tombstoned").length}`}
            />
            <MetricCard label={labels.generation} value={`${snapshot.generation}`} />
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
                <div className="lyra-resource-monitor-grid-head">{labels.actions}</div>
                {snapshot.resources.map((resource) => (
                  <div className="lyra-resource-monitor-row" key={resource.resourceId}>
                    <span className={`lyra-resource-monitor-state lyra-resource-monitor-state-${resource.lifecycleState}`}>
                      {labels.lifecycleStates[resource.lifecycleState]}
                    </span>
                    <span>{resource.kind}</span>
                    <strong>{resource.label}</strong>
                    <small>{resource.coreKey}</small>
                    <div className="lyra-resource-monitor-row-actions">
                      {lyraResourceActions.map((action) => (
                        <button
                          key={action}
                          type="button"
                          aria-label={labels.activityActions[action]}
                          title={labels.activityActions[action]}
                          onClick={() => {
                            runActivityAction(`lyra-resource:${resource.resourceId}`, action);
                          }}
                        >
                          {actionIcon(action)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </section>
        </>
      ) : (
        <section className="lyra-resource-monitor-system">
          <section className="lyra-resource-monitor-system-head" aria-label="resource-monitor-system-load">
            <div>
              <span>{labels.runtime}</span>
              <strong>{labels.scopeAll}</strong>
              <small>{labels.kernel}</small>
            </div>
            <div className="lyra-resource-monitor-load">
              <span>{labels.unifiedLoad}</span>
              <strong>{formatPercent(systemSnapshot.loadScore, labels.unavailable)}</strong>
              <LoadTrace samples={loadSamples} fallbackScore={systemSnapshot.loadScore} />
            </div>
          </section>

          <section className="lyra-resource-monitor-system-metrics" aria-label="resource-monitor-system-metrics">
            {systemMetricCards.map((metric) => (
              <MetricCard
                key={metric.id}
                label={metric.label}
                value={metric.value}
                detail={metric.detail}
              />
            ))}
          </section>

          <section className="lyra-resource-monitor-activities" aria-label="resource-monitor-system-activities">
            <header>
              <h3>{labels.activities}</h3>
              {actionMessage !== null ? <span>{actionMessage}</span> : null}
            </header>
            <div className="lyra-resource-monitor-activity-grid">
              <div className="lyra-resource-monitor-grid-head">{fallbackLabel(labels.kind, "类型")}</div>
              <div className="lyra-resource-monitor-grid-head">{fallbackLabel(labels.label, "名称")}</div>
              <div className="lyra-resource-monitor-grid-head">{fallbackLabel(labels.usage, "占用")}</div>
              <div className="lyra-resource-monitor-grid-head">{fallbackLabel(labels.actions, "操作")}</div>
              {systemSnapshot.activities.map((activity) => (
                <div className="lyra-resource-monitor-activity-row" key={activity.activityId}>
                  <span>{labels.activityKinds[activity.kind]}</span>
                  <span className="lyra-resource-monitor-activity-name">
                    <strong>{activity.label}</strong>
                    <small>
                      {activity.pid !== undefined ? `${labels.pid} ${activity.pid}` : activity.subtitle}
                      {activity.state !== undefined ? ` / ${activity.state}` : ""}
                    </small>
                  </span>
                  <span>{formatActivityUsage(activity, labels)}</span>
                  <div className="lyra-resource-monitor-activity-actions">
                    {activity.actions.map((action) => (
                      <button
                        key={action}
                        type="button"
                        aria-label={labels.activityActions[action]}
                        title={labels.activityActions[action]}
                        onClick={() => {
                          runActivityAction(activity.activityId, action);
                        }}
                      >
                        {actionIcon(action)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>
      )}
    </section>
  );
};
