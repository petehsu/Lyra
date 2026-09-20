import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X
} from "@lyra/icons";

import {
  formatDownloadBytes,
  formatDownloadEta,
  formatDownloadSpeed,
  getDownloadProgressRatio,
  resolveDownloadPriorityLabel,
  resolveDownloadSourceLabel,
  resolveDownloadStateLabel,
  resolveDownloadStateTone
} from "./format";
import type {
  DownloadPriority,
  DownloadTask,
  DownloadsMessages
} from "./types";

const PRIORITIES: readonly DownloadPriority[] = ["high", "normal", "low"];

const isPausableDownload = (task: DownloadTask): boolean =>
  task.state === "queued" || task.state === "downloading";

const isResumableDownload = (task: DownloadTask): boolean =>
  task.state === "paused";

const isCancelableDownload = (task: DownloadTask): boolean =>
  task.state === "queued" || task.state === "downloading" || task.state === "paused";

const formatTaskSize = (task: DownloadTask, labels: DownloadsMessages): string => {
  const received = formatDownloadBytes(task.receivedBytes, labels);
  const total = formatDownloadBytes(task.totalBytes, labels);
  return task.totalBytes > 0 ? `${received} / ${total}` : received;
};

const IconButton = ({
  label,
  tone,
  disabled,
  type = "button",
  onClick,
  children
}: {
  readonly label: string;
  readonly tone?: "danger";
  readonly disabled?: boolean;
  readonly type?: "button" | "submit";
  readonly onClick?: () => void;
  readonly children: ReactNode;
}): ReactNode => (
  <button
    type={type}
    className="lyra-ui-button lyra-ui-button-ghost lyra-ui-button-size-icon lyra-app-icon-button"
    aria-label={label}
    title={label}
    disabled={disabled}
    data-tone={tone ?? "default"}
    onClick={onClick}
  >
    {children}
  </button>
);

const PrioritySelect = ({
  task,
  labels,
  onChange
}: {
  readonly task: DownloadTask;
  readonly labels: DownloadsMessages;
  readonly onChange: (priority: DownloadPriority) => void;
}): ReactNode => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (): void => setOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  const selectedLabel = resolveDownloadPriorityLabel(task.priority, labels);
  const ariaLabel = `${labels.downloadPriority}: ${task.fileName}`;

  return (
    <div className="lyra-app-select" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="lyra-ui-select-trigger lyra-app-select"
        aria-label={ariaLabel}
        title={selectedLabel}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="lyra-ui-select-trigger-value">{selectedLabel}</span>
        <ChevronDown className="lyra-ui-select-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="lyra-ui-select-content" role="listbox" aria-label={ariaLabel}>
          {PRIORITIES.map((priority) => {
            const label = resolveDownloadPriorityLabel(priority, labels);
            const active = priority === task.priority;
            return (
              <button
                key={priority}
                type="button"
                role="option"
                aria-selected={active}
                className="lyra-ui-select-item"
                onClick={() => {
                  onChange(priority);
                  setOpen(false);
                }}
              >
                <span className="lyra-ui-select-item-indicator" aria-hidden="true">
                  {active ? <Check className="lyra-ui-select-check" aria-hidden="true" /> : null}
                </span>
                <span className="lyra-ui-select-item-copy">
                  <span>{label}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

const DownloadTaskActions = ({
  task,
  labels,
  busyKey,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRemove,
  onOpen,
  onReveal
}: {
  readonly task: DownloadTask;
  readonly labels: DownloadsMessages;
  readonly busyKey: string | null;
  readonly onPause: (taskId: string) => void;
  readonly onResume: (taskId: string) => void;
  readonly onCancel: (taskId: string) => void;
  readonly onRetry: (taskId: string) => void;
  readonly onRemove: (taskId: string) => void;
  readonly onOpen: (taskId: string) => void;
  readonly onReveal: (taskId: string) => void;
}): ReactNode => (
  <div className="lyra-file-manager-download-actions">
    {task.state === "downloading" ? (
      <IconButton
        label={labels.downloadPause}
        disabled={busyKey === task.id}
        onClick={() => onPause(task.id)}
      >
        <Pause size={14} aria-hidden="true" />
      </IconButton>
    ) : null}
    {task.state === "paused" ? (
      <IconButton
        label={labels.downloadResume}
        disabled={busyKey === task.id}
        onClick={() => onResume(task.id)}
      >
        <Play size={14} aria-hidden="true" />
      </IconButton>
    ) : null}
    {task.state === "queued" || task.state === "downloading" || task.state === "paused" ? (
      <IconButton
        label={labels.downloadCancel}
        tone="danger"
        disabled={busyKey === task.id}
        onClick={() => onCancel(task.id)}
      >
        <X size={14} aria-hidden="true" />
      </IconButton>
    ) : null}
    {task.state === "failed" || task.state === "canceled" ? (
      <IconButton
        label={labels.downloadRetry}
        disabled={busyKey === task.id}
        onClick={() => onRetry(task.id)}
      >
        <RotateCcw size={14} aria-hidden="true" />
      </IconButton>
    ) : null}
    {task.state === "completed" ? (
      <>
        <IconButton label={labels.downloadOpenFile} onClick={() => onOpen(task.id)}>
          <ExternalLink size={14} aria-hidden="true" />
        </IconButton>
        <IconButton label={labels.downloadRevealFile} onClick={() => onReveal(task.id)}>
          <FolderOpen size={14} aria-hidden="true" />
        </IconButton>
      </>
    ) : null}
    {task.state === "completed" || task.state === "failed" || task.state === "canceled" ? (
      <IconButton
        label={labels.downloadRemove}
        tone="danger"
        disabled={busyKey === task.id}
        onClick={() => onRemove(task.id)}
      >
        <Trash2 size={14} aria-hidden="true" />
      </IconButton>
    ) : null}
  </div>
);

export const DownloadsEmbeddedChrome = ({
  labels,
  tasks,
  urlDraft,
  error,
  busyKey,
  onUrlDraftChange,
  onSubmitUrl,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRemove,
  onPauseAll,
  onResumeAll,
  onCancelAll,
  onOpen,
  onReveal,
  onSetPriority
}: {
  readonly labels: DownloadsMessages;
  readonly tasks: readonly DownloadTask[];
  readonly urlDraft: string;
  readonly error: string | null;
  readonly busyKey: string | null;
  readonly onUrlDraftChange: (value: string) => void;
  readonly onSubmitUrl: () => void;
  readonly onPause: (taskId: string) => void;
  readonly onResume: (taskId: string) => void;
  readonly onCancel: (taskId: string) => void;
  readonly onRetry: (taskId: string) => void;
  readonly onRemove: (taskId: string) => void;
  readonly onPauseAll: () => void;
  readonly onResumeAll: () => void;
  readonly onCancelAll: () => void;
  readonly onOpen: (taskId: string) => void;
  readonly onReveal: (taskId: string) => void;
  readonly onSetPriority: (taskId: string, priority: DownloadPriority) => void;
}): ReactNode => {
  const canPauseAll = tasks.some(isPausableDownload);
  const canResumeAll = tasks.some(isResumableDownload);
  const canCancelAll = tasks.some(isCancelableDownload);
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmitUrl();
  };

  return (
    <div
      className="lyra-app-content-column lyra-app-content-column-wide lyra-file-manager-downloads-page"
      data-lyra-component="lyra.downloads"
      aria-label="downloads-surface"
    >
      <header className="lyra-app-group lyra-file-manager-downloads-header">
        <div className="lyra-file-manager-downloads-controls">
          <div className="lyra-file-manager-downloads-batch-actions">
            {canPauseAll ? (
              <IconButton label={labels.downloadPauseAll} onClick={onPauseAll}>
                <Pause size={14} aria-hidden="true" />
              </IconButton>
            ) : null}
            {canResumeAll ? (
              <IconButton label={labels.downloadResumeAll} onClick={onResumeAll}>
                <Play size={14} aria-hidden="true" />
              </IconButton>
            ) : null}
            {canCancelAll ? (
              <IconButton
                label={labels.downloadCancelAll}
                tone="danger"
                onClick={onCancelAll}
              >
                <X size={14} aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
          <form className="lyra-file-manager-downloads-form" onSubmit={onSubmit}>
            <input
              className="lyra-ui-input"
              value={urlDraft}
              placeholder={labels.downloadUrlPlaceholder}
              aria-label={labels.downloadUrlPlaceholder}
              onChange={(event) => onUrlDraftChange(event.target.value)}
            />
            <IconButton
              type="submit"
              label={labels.downloadAddUrl}
              disabled={urlDraft.trim().length === 0}
            >
              <Plus size={14} aria-hidden="true" />
            </IconButton>
          </form>
        </div>
      </header>

      {error === null ? null : (
        <div className="lyra-file-manager-downloads-error">{error}</div>
      )}

      {tasks.length === 0 ? (
        <div className="lyra-app-state lyra-app-state-empty lyra-app-state-density-default lyra-app-state-align-center lyra-app-state-tone-neutral lyra-file-manager-empty-state">
          <span className="lyra-app-state-icon" aria-hidden="true">
            <span className="lyra-app-logo-mark lyra-app-state-logo" />
          </span>
          <span className="lyra-app-state-copy">
            <strong className="lyra-app-state-title">{labels.emptyDownloads}</strong>
          </span>
        </div>
      ) : (
        <div className="lyra-app-group lyra-app-row-list lyra-file-manager-download-list">
          {tasks.map((task) => {
            const progressRatio = getDownloadProgressRatio(task);
            const progressLabel = `${Math.round(progressRatio * 100)}%`;
            const etaLabel = formatDownloadEta(task.estimatedRemainingMs, labels);
            return (
              <div key={task.id} className="lyra-file-manager-download-row">
                <div className="lyra-file-manager-download-main">
                  <div className="lyra-file-manager-download-name-line">
                    <strong title={task.fileName}>{task.fileName}</strong>
                    <span
                      className={`lyra-app-badge lyra-app-badge-${resolveDownloadStateTone(task.state)} lyra-file-manager-download-state`}
                    >
                      {resolveDownloadStateLabel(task.state, labels)}
                    </span>
                  </div>
                  <div className="lyra-file-manager-download-meta">
                    <span title={task.url}>{resolveDownloadSourceLabel(task.source, labels)}</span>
                    <span>
                      {labels.downloadConnections.replace(
                        "{count}",
                        String(Math.max(task.connectionsActive, task.connectionsRequested))
                      )}
                    </span>
                    <span>{formatTaskSize(task, labels)}</span>
                    <span>{formatDownloadSpeed(task.speedBytesPerSecond, labels)}</span>
                    {etaLabel === null ? null : <span>{etaLabel}</span>}
                  </div>
                  <div
                    className="lyra-file-manager-download-progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progressRatio * 100)}
                    aria-label={`${task.fileName} ${progressLabel}`}
                  >
                    <div
                      className="lyra-file-manager-download-progress-fill"
                      style={{ transform: `scaleX(${progressRatio})` }}
                    />
                  </div>
                  {task.errorMessage === undefined ? null : (
                    <div className="lyra-file-manager-download-error">{task.errorMessage}</div>
                  )}
                </div>
                <PrioritySelect
                  task={task}
                  labels={labels}
                  onChange={(priority) => onSetPriority(task.id, priority)}
                />
                <DownloadTaskActions
                  task={task}
                  labels={labels}
                  busyKey={busyKey}
                  onPause={onPause}
                  onResume={onResume}
                  onCancel={onCancel}
                  onRetry={onRetry}
                  onRemove={onRemove}
                  onOpen={onOpen}
                  onReveal={onReveal}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
