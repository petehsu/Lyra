import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Clock3,
  FileText,
  Moon,
  RefreshCw,
  Square,
  Timer
} from "lucide-react";

import {
  AppBadge,
  AppButton,
  AppEmptyState,
  AppIconButton,
  AppInput,
  AppLoadingState,
  AppObjectRow,
  AppStatusMessage,
  AppSwitch,
  AppTabs,
  AppTextarea,
  type AppTabOption
} from "@renderer/ui/components";

import type {
  AgentSessionSnapshot,
  AgentOvernightRunSnapshot
} from "../../../shared/desktop-bridge";
import { setLocale, type Locale } from "../ai-panel/lyra-agents/core/i18n";
import { DataContextProvider } from "../ai-panel/lyra-agents/data/DataProvider";
import { createDataProviderValue } from "../ai-panel/lyra-agents/data/createDataProviderValue";
import { Message } from "../ai-panel/lyra-agents/features/chat/Message";
import {
  agentSessionToChatMessages,
  agentSessionToSessionMeta
} from "../agent-session-view-model";
import type {
  AgentOvernightLabels,
  AgentOvernightState,
  AgentOvernightSurfaceProps
} from "./types";

const durationPresets = [60, 240, 480] as const;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown, key: string): string | null => {
  if (!isRecord(value)) return null;
  const raw = value[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
};

const readNumber = (value: unknown, key: string): number | null => {
  if (!isRecord(value)) return null;
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
};

const readField = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const formatDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
};

const runStatusTone = (
  status: string
): "neutral" | "success" | "warning" | "error" | "info" => {
  if (status === "running") return "info";
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (status === "cancel requested" || status === "cancelled") return "warning";
  return "neutral";
};

const durationLabel = (labels: AgentOvernightLabels, minutes: number): string => {
  if (minutes === 60) return labels.oneHour;
  if (minutes === 240) return labels.fourHours;
  if (minutes === 480) return labels.eightHours;
  return `${minutes}m`;
};

const taskTitle = (card: unknown, index: number): string =>
  readString(card, "title") ?? readString(card, "id") ?? `Task ${index + 1}`;

const taskStatus = (card: unknown): string =>
  readString(card, "status") ?? readString(readField(card, "after"), "status") ?? "active";

const eventSummary = (event: unknown): string =>
  readString(event, "summary") ?? readString(event, "kind") ?? "event";

const eventKind = (event: unknown): string => readString(event, "kind") ?? "event";

const eventTime = (event: unknown): string => {
  const timestamp = readString(event, "timestamp");
  return timestamp === null ? "" : formatDateTime(timestamp);
};

const createTranscriptData = (snapshot: AgentSessionSnapshot | null) =>
  createDataProviderValue({
    session: agentSessionToSessionMeta(snapshot),
    messages: agentSessionToChatMessages(snapshot),
    sendMessage: async () => undefined,
    cancelTurn: async () => undefined,
    isMock: false,
    isTurnRunning: false
  });

const OvernightTranscript = ({
  snapshot,
  labels
}: {
  readonly snapshot: AgentSessionSnapshot | null | undefined;
  readonly labels: AgentOvernightLabels;
}) => {
  const messages = agentSessionToChatMessages(snapshot ?? null);
  const data = useMemo(() => createTranscriptData(snapshot ?? null), [snapshot]);
  if (messages.length === 0) {
    return <p className="lyra-agent-overnight-muted">{labels.emptyTranscript}</p>;
  }
  return (
    <DataContextProvider value={data}>
      <div className="lyra-agent-overnight-transcript-list">
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </div>
    </DataContextProvider>
  );
};

const RunList = ({
  runs,
  selectedRunId,
  labels,
  onSelect
}: {
  readonly runs: readonly AgentOvernightRunSnapshot[];
  readonly selectedRunId: string | null;
  readonly labels: AgentOvernightLabels;
  readonly onSelect: (run: AgentOvernightRunSnapshot) => void;
}) => (
  <section className="lyra-agent-overnight-runs">
    <h2>{labels.latestRuns}</h2>
    {runs.length === 0 ? (
      <p className="lyra-agent-overnight-muted">{labels.noRunsDescription}</p>
    ) : (
      <div className="lyra-agent-overnight-run-list">
        {runs.map((run) => (
          <AppObjectRow
            key={run.runId}
            className="lyra-agent-overnight-run-row"
            active={selectedRunId === run.runId}
            title={run.mission ?? run.coordinatorSessionName}
            description={formatDateTime(run.startedAt)}
            badges={<AppBadge tone={runStatusTone(run.status)}>{run.status}</AppBadge>}
            onClick={() => onSelect(run)}
          />
        ))}
      </div>
    )}
  </section>
);

const Dashboard = ({
  run,
  labels,
  refreshing,
  cancelling,
  onRefresh,
  onReview,
  onCancel
}: {
  readonly run: AgentOvernightRunSnapshot | null;
  readonly labels: AgentOvernightLabels;
  readonly refreshing: boolean;
  readonly cancelling: boolean;
  readonly onRefresh: () => void;
  readonly onReview: () => void;
  readonly onCancel: () => void;
}) => {
  if (run === null) {
    return (
      <AppEmptyState
        className="lyra-agent-overnight-empty"
        icon={<Moon size={22} aria-hidden="true" />}
        title={labels.noRunsTitle}
        description={labels.noRunsDescription}
      />
    );
  }

  const phase = readString(run.progress, "phase");
  const remaining = readString(run.progress, "timeRemainingLabel");
  const totalTasks = readNumber(readField(run.progress, "taskSummary"), "total");
  const canCancel = run.status === "running" || run.status === "cancel requested";

  return (
    <section className="lyra-agent-overnight-dashboard">
      <header className="lyra-agent-overnight-status">
        <AppBadge className="lyra-agent-overnight-badge">{labels.title}</AppBadge>
        <span>{labels.status}: {run.status}</span>
        <span>{labels.targetWake}: {formatDateTime(run.targetWakeAt)}</span>
        <div className="lyra-agent-overnight-status-actions">
          <AppIconButton
            aria-label={labels.refresh}
            title={labels.refresh}
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </AppIconButton>
          <AppIconButton
            aria-label={labels.review}
            title={labels.review}
            onClick={onReview}
            disabled={refreshing}
          >
            <FileText size={14} aria-hidden="true" />
          </AppIconButton>
          <AppIconButton
            tone="danger"
            aria-label={labels.cancel}
            title={labels.cancel}
            onClick={onCancel}
            disabled={!canCancel || cancelling}
          >
            <Square size={13} aria-hidden="true" />
          </AppIconButton>
        </div>
      </header>

      <div className="lyra-agent-overnight-dashboard-body">
        <section className="lyra-agent-overnight-card lyra-agent-overnight-overview">
          <h2>{run.mission ?? run.coordinatorSessionName}</h2>
          <div className="lyra-agent-overnight-meta-grid">
            <span>{labels.provider}: {run.providerName}</span>
            <span>{labels.model}: {run.model}</span>
            {run.workingDir === null || run.workingDir === undefined ? null : (
              <span>{labels.workingDir}: {run.workingDir}</span>
            )}
            <span>{labels.lastActivity}: {formatDateTime(run.lastActivityAt)}</span>
          </div>
        </section>

        <section className="lyra-agent-overnight-card">
          <h3>{labels.progress}</h3>
          <div className="lyra-agent-overnight-progress">
            {phase === null ? null : <span><Timer size={13} aria-hidden="true" />{phase}</span>}
            {remaining === null ? null : <span><Clock3 size={13} aria-hidden="true" />{remaining}</span>}
            {totalTasks === null ? null : <span><CalendarClock size={13} aria-hidden="true" />{totalTasks}</span>}
          </div>
          <pre>{run.statusMarkdown}</pre>
        </section>

        <section className="lyra-agent-overnight-card">
          <h3>{labels.taskCards}</h3>
          {run.taskCards.length === 0 ? (
            <p className="lyra-agent-overnight-muted">{labels.emptyTasks}</p>
          ) : (
            <div className="lyra-agent-overnight-task-list">
              {run.taskCards.map((card, index) => (
                <article key={`${taskTitle(card, index)}-${index}`} className="lyra-agent-overnight-task">
                  <strong>{taskTitle(card, index)}</strong>
                  <AppBadge tone={runStatusTone(taskStatus(card))}>{taskStatus(card)}</AppBadge>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="lyra-agent-overnight-card">
          <h3>{labels.events}</h3>
          {run.events.length === 0 ? (
            <p className="lyra-agent-overnight-muted">{labels.emptyEvents}</p>
          ) : (
            <div className="lyra-agent-overnight-event-list">
              {run.events.slice(-24).reverse().map((event, index) => (
                <article key={`${eventKind(event)}-${index}`} className="lyra-agent-overnight-event">
                  <span>{eventKind(event)}</span>
                  <strong>{eventSummary(event)}</strong>
                  <small>{eventTime(event)}</small>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="lyra-agent-overnight-card">
          <h3>{labels.log}</h3>
          <pre>{run.logMarkdown}</pre>
        </section>

        {run.reviewHtml === null || run.reviewHtml === undefined ? null : (
          <section className="lyra-agent-overnight-card lyra-agent-overnight-review">
            <h3>{labels.reviewPreview}</h3>
            <iframe title={labels.reviewPreview} sandbox="" srcDoc={run.reviewHtml} />
          </section>
        )}

        <section className="lyra-agent-overnight-card lyra-agent-overnight-transcript">
          <h3>{labels.transcript}</h3>
          <OvernightTranscript snapshot={run.coordinatorSnapshot} labels={labels} />
        </section>
      </div>
    </section>
  );
};

export const AgentOvernightSurface = ({
  desktopApi,
  labels,
  parentSessionId,
  locale
}: AgentOvernightSurfaceProps) => {
  const [state, setState] = useState<AgentOvernightState>({
    runs: [],
    selectedRun: null,
    loading: true,
    error: null
  });
  const [durationMinutes, setDurationMinutes] = useState(240);
  const [mission, setMission] = useState("");
  const [inheritContext, setInheritContext] = useState(true);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (locale !== undefined) {
      setLocale(locale as Locale);
    }
  }, [locale]);

  const durationTabOptions = useMemo<readonly AppTabOption<string>[]>(
    () => durationPresets.map((minutes) => ({
      value: String(minutes),
      label: durationLabel(labels, minutes)
    })),
    [labels]
  );

  const loadRuns = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) {
      setState((current) => ({
        ...current,
        loading: false,
        error: labels.unavailable
      }));
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await desktopApi.agent.listOvernightRuns();
      setState({
        runs: response.runs,
        selectedRun: response.runs[0] ?? null,
        loading: false,
        error: null
      });
    } catch (error: unknown) {
      setState((current) => ({
        ...current,
        loading: false,
        error: toErrorMessage(error)
      }));
    }
  }, [desktopApi, labels.unavailable]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const refreshSelected = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const runId = state.selectedRun?.runId ?? null;
    setRefreshing(true);
    try {
      const response = await desktopApi.agent.readOvernightStatus({ runId });
      setState((current) => {
        if (response.run === null || response.run === undefined) {
          return current;
        }
        return {
          ...current,
          selectedRun: response.run,
          runs: current.runs.map((run) => run.runId === response.run?.runId ? response.run : run),
          error: null
        };
      });
    } catch (error: unknown) {
      setState((current) => ({ ...current, error: toErrorMessage(error) }));
    } finally {
      setRefreshing(false);
    }
  }, [desktopApi, state.selectedRun?.runId]);

  useEffect(() => {
    const status = state.selectedRun?.status;
    if (status !== "running" && status !== "cancel requested") {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshSelected();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshSelected, state.selectedRun?.status]);

  const startRun = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined || starting) return;
    setStarting(true);
    try {
      const response = await desktopApi.agent.startOvernight({
        sessionId: parentSessionId,
        durationMinutes,
        mission: mission.trim() || null,
        inheritContext
      });
      setState((current) => ({
        runs: [response.run, ...current.runs.filter((run) => run.runId !== response.run.runId)],
        selectedRun: response.run,
        loading: false,
        error: null
      }));
      setMission("");
    } catch (error: unknown) {
      setState((current) => ({ ...current, error: toErrorMessage(error) }));
    } finally {
      setStarting(false);
    }
  }, [desktopApi, durationMinutes, inheritContext, mission, parentSessionId, starting]);

  const refreshReview = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined) return;
    const runId = state.selectedRun?.runId ?? null;
    setRefreshing(true);
    try {
      const response = await desktopApi.agent.readOvernightReview({ runId });
      if (response.run !== null && response.run !== undefined) {
        setState((current) => ({
          ...current,
          selectedRun: response.run ?? null,
          runs: current.runs.map((run) => run.runId === response.run?.runId ? response.run : run),
          error: null
        }));
      }
    } catch (error: unknown) {
      setState((current) => ({ ...current, error: toErrorMessage(error) }));
    } finally {
      setRefreshing(false);
    }
  }, [desktopApi, state.selectedRun?.runId]);

  const cancelRun = useCallback(async (): Promise<void> => {
    if (desktopApi?.agent === undefined || state.selectedRun === null) return;
    setCancelling(true);
    try {
      const response = await desktopApi.agent.cancelOvernight({ runId: state.selectedRun.runId });
      if (response.run !== null && response.run !== undefined) {
        setState((current) => ({
          ...current,
          selectedRun: response.run ?? null,
          runs: current.runs.map((run) => run.runId === response.run?.runId ? response.run : run),
          error: null
        }));
      }
    } catch (error: unknown) {
      setState((current) => ({ ...current, error: toErrorMessage(error) }));
    } finally {
      setCancelling(false);
    }
  }, [desktopApi, state.selectedRun]);

  return (
    <section className="lyra-agent-overnight-surface" aria-label={labels.title}>
      <aside className="lyra-agent-overnight-panel">
        <div className="lyra-agent-overnight-kicker">{labels.title}</div>
        <p className="lyra-agent-overnight-subtitle">{labels.subtitle}</p>

        <fieldset className="lyra-agent-overnight-fieldset">
          <legend>{labels.durationLabel}</legend>
          <AppTabs
            ariaLabel={labels.durationLabel}
            className="lyra-agent-overnight-segments"
            value={String(durationMinutes)}
            options={durationTabOptions}
            onValueChange={(value) => setDurationMinutes(Number(value))}
          />
          <label className="lyra-agent-overnight-inline-field">
            <span>{labels.customMinutes}</span>
            <AppInput
              type="number"
              min={1}
              max={4320}
              aria-label={labels.customMinutes}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
            />
          </label>
        </fieldset>

        <label className="lyra-agent-overnight-field">
          <span>{labels.missionLabel}</span>
          <AppTextarea
            value={mission}
            onChange={(event) => setMission(event.target.value)}
            placeholder={labels.missionPlaceholder}
            rows={7}
          />
        </label>

        <label className="lyra-agent-overnight-toggle">
          <AppSwitch
            checked={inheritContext}
            onCheckedChange={setInheritContext}
            aria-label={labels.inheritContext}
          />
          <span>{labels.inheritContext}</span>
        </label>

        <AppButton
          className="lyra-agent-overnight-start"
          disabled={starting || desktopApi?.agent === undefined}
          onClick={() => void startRun()}
        >
          {starting ? labels.starting : labels.start}
        </AppButton>

        {state.error === null ? null : (
          <AppStatusMessage
            className="lyra-agent-overnight-error"
            tone="error"
            role="status"
          >
            {state.error}
          </AppStatusMessage>
        )}

        <RunList
          runs={state.runs}
          selectedRunId={state.selectedRun?.runId ?? null}
          labels={labels}
          onSelect={(run) => setState((current) => ({ ...current, selectedRun: run }))}
        />
      </aside>

      <main className="lyra-agent-overnight-main">
        {state.loading ? (
          <AppLoadingState className="lyra-agent-overnight-empty" title={labels.loading} />
        ) : (
          <Dashboard
            run={state.selectedRun}
            labels={labels}
            refreshing={refreshing}
            cancelling={cancelling}
            onRefresh={() => void refreshSelected()}
            onReview={() => void refreshReview()}
            onCancel={() => void cancelRun()}
          />
        )}
      </main>
    </section>
  );
};
