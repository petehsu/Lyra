import {
  ClipboardPaste,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X
} from "lucide-react";
import type { FormEvent } from "react";

import {
  AppBadge,
  AppEmptyState,
  AppIconButton,
  AppInput,
  AppSelect
} from "@renderer/ui/components";
import type { AppBadgeTone } from "@renderer/ui/components";
import type {
  DownloadManagerPriority,
  DownloadManagerTask
} from "../../../shared/download-manager";
import {
  formatDownloadBytes,
  formatDownloadEta,
  formatDownloadSpeed,
  getDownloadProgressRatio,
  resolveDownloadPriorityLabel,
  resolveDownloadSourceLabel,
  resolveDownloadStateLabel
} from "./download-utils";
import { renderFileManagerSectionIcon } from "./icon-registry";
import type { FileManagerSurfaceViewProps } from "./surface-view-types";

const formatTaskSize = (
  task: DownloadManagerTask,
  labels: FileManagerSurfaceViewProps["labels"]
): string => {
  const received = formatDownloadBytes(task.receivedBytes, labels);
  const total = formatDownloadBytes(task.totalBytes, labels);
  return task.totalBytes > 0 ? `${received} / ${total}` : received;
};

const DOWNLOAD_PRIORITIES: readonly DownloadManagerPriority[] = ["high", "normal", "low"];

const isPausableDownload = (task: DownloadManagerTask): boolean =>
  task.state === "queued" || task.state === "downloading";

const isResumableDownload = (task: DownloadManagerTask): boolean =>
  task.state === "paused";

const isCancelableDownload = (task: DownloadManagerTask): boolean =>
  task.state === "queued" || task.state === "downloading" || task.state === "paused";

const resolveDownloadStateTone = (state: DownloadManagerTask["state"]): AppBadgeTone => {
  switch (state) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "paused":
      return "warning";
    case "downloading":
      return "info";
    case "queued":
    case "canceled":
    default:
      return "neutral";
  }
};

const DownloadTaskActions = ({
  task,
  labels,
  actions
}: {
  readonly task: DownloadManagerTask;
  readonly labels: FileManagerSurfaceViewProps["labels"];
  readonly actions: FileManagerSurfaceViewProps["actions"];
}) => (
  <div className="lyra-file-manager-download-actions">
    {task.state === "downloading" ? (
      <AppIconButton
        aria-label={labels.downloadPause}
        title={labels.downloadPause}
        onClick={() => {
          actions.onPauseDownload(task.id);
        }}
      >
        <Pause size={14} aria-hidden="true" />
      </AppIconButton>
    ) : null}
    {task.state === "paused" ? (
      <AppIconButton
        aria-label={labels.downloadResume}
        title={labels.downloadResume}
        onClick={() => {
          actions.onResumeDownload(task.id);
        }}
      >
        <Play size={14} aria-hidden="true" />
      </AppIconButton>
    ) : null}
    {task.state === "queued" || task.state === "downloading" || task.state === "paused" ? (
      <AppIconButton
        tone="danger"
        aria-label={labels.downloadCancel}
        title={labels.downloadCancel}
        onClick={() => {
          actions.onCancelDownload(task.id);
        }}
      >
        <X size={14} aria-hidden="true" />
      </AppIconButton>
    ) : null}
    {task.state === "failed" || task.state === "canceled" ? (
      <AppIconButton
        aria-label={labels.downloadRetry}
        title={labels.downloadRetry}
        onClick={() => {
          actions.onRetryDownload(task.id);
        }}
      >
        <RotateCcw size={14} aria-hidden="true" />
      </AppIconButton>
    ) : null}
    {task.state === "completed" ? (
      <>
        <AppIconButton
          aria-label={labels.downloadOpenFile}
          title={labels.downloadOpenFile}
          onClick={() => {
            actions.onOpenDownloadedFile(task.id);
          }}
        >
          <ExternalLink size={14} aria-hidden="true" />
        </AppIconButton>
        <AppIconButton
          aria-label={labels.downloadRevealFile}
          title={labels.downloadRevealFile}
          onClick={() => {
            actions.onRevealDownloadedFile(task.id);
          }}
        >
          <FolderOpen size={14} aria-hidden="true" />
        </AppIconButton>
      </>
    ) : null}
    {task.state === "completed" || task.state === "failed" || task.state === "canceled" ? (
      <AppIconButton
        tone="danger"
        aria-label={labels.downloadRemove}
        title={labels.downloadRemove}
        onClick={() => {
          actions.onRemoveDownload(task.id);
        }}
      >
        <Trash2 size={14} aria-hidden="true" />
      </AppIconButton>
    ) : null}
  </div>
);

const DownloadTaskRow = ({
  task,
  labels,
  actions
}: {
  readonly task: DownloadManagerTask;
  readonly labels: FileManagerSurfaceViewProps["labels"];
  readonly actions: FileManagerSurfaceViewProps["actions"];
}) => {
  const progressRatio = getDownloadProgressRatio(task);
  const stateLabel = resolveDownloadStateLabel(task.state, labels);
  const sourceLabel = resolveDownloadSourceLabel(task.source, labels);
  const speedLabel = formatDownloadSpeed(task.speedBytesPerSecond, labels);
  const etaLabel = formatDownloadEta(task.estimatedRemainingMs, labels);
  const sizeLabel = formatTaskSize(task, labels);
  const connectionLabel = labels.downloadConnections.replace(
    "{count}",
    String(Math.max(task.connectionsActive, task.connectionsRequested))
  );
  const progressLabel = `${Math.round(progressRatio * 100)}%`;

  return (
    <div className="lyra-file-manager-download-row">
      <div className="lyra-file-manager-download-main">
        <div className="lyra-file-manager-download-name-line">
          <strong title={task.fileName}>{task.fileName}</strong>
          <AppBadge
            className="lyra-file-manager-download-state"
            tone={resolveDownloadStateTone(task.state)}
          >
            {stateLabel}
          </AppBadge>
        </div>
        <div className="lyra-file-manager-download-meta">
          <span title={task.url}>{sourceLabel}</span>
          <span>{connectionLabel}</span>
          <span>{sizeLabel}</span>
          <span>{speedLabel}</span>
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
      <AppSelect
        ariaLabel={`${labels.downloadPriority}: ${task.fileName}`}
        value={task.priority}
        options={DOWNLOAD_PRIORITIES.map((priority) => ({
          value: priority,
          label: resolveDownloadPriorityLabel(priority, labels)
        }))}
        onValueChange={(value) => {
          actions.onSetDownloadPriority(
            task.id,
            value as DownloadManagerPriority
          );
        }}
      />
      <DownloadTaskActions task={task} labels={labels} actions={actions} />
    </div>
  );
};

export const FileManagerDownloadsContent = ({
  renderModel,
  labels,
  actions
}: FileManagerSurfaceViewProps) => {
  if (renderModel.body.kind !== "downloads") {
    return null;
  }
  const downloads = renderModel.body.downloads;
  const canPauseAll = downloads.tasks.some(isPausableDownload);
  const canResumeAll = downloads.tasks.some(isResumableDownload);
  const canCancelAll = downloads.tasks.some(isCancelableDownload);
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    actions.onSubmitDownloadUrlDraft();
  };

  return (
    <div className="lyra-app-content-column lyra-app-content-column-wide lyra-file-manager-downloads-page">
      <header className="lyra-app-group lyra-file-manager-downloads-header">
        <div className="lyra-file-manager-downloads-title">
          {renderFileManagerSectionIcon("downloads")}
          <h3>{labels.downloadManagerTitle}</h3>
        </div>
        <div className="lyra-file-manager-downloads-controls">
          <div className="lyra-file-manager-downloads-batch-actions">
            {canPauseAll ? (
              <AppIconButton
                type="button"
                aria-label={labels.downloadPauseAll}
                title={labels.downloadPauseAll}
                onClick={actions.onPauseAllDownloads}
              >
                <Pause size={14} aria-hidden="true" />
              </AppIconButton>
            ) : null}
            {canResumeAll ? (
              <AppIconButton
                type="button"
                aria-label={labels.downloadResumeAll}
                title={labels.downloadResumeAll}
                onClick={actions.onResumeAllDownloads}
              >
                <Play size={14} aria-hidden="true" />
              </AppIconButton>
            ) : null}
            {canCancelAll ? (
              <AppIconButton
                type="button"
                tone="danger"
                aria-label={labels.downloadCancelAll}
                title={labels.downloadCancelAll}
                onClick={actions.onCancelAllDownloads}
              >
                <X size={14} aria-hidden="true" />
              </AppIconButton>
            ) : null}
          </div>
          <form className="lyra-file-manager-downloads-form" onSubmit={onSubmit}>
            <AppInput
              value={downloads.urlDraft}
              placeholder={labels.downloadUrlPlaceholder}
              onChange={(event) => {
                actions.onDownloadUrlDraftChange(event.target.value);
              }}
            />
            <AppIconButton
              type="button"
              aria-label={labels.downloadImportClipboard}
              title={labels.downloadImportClipboard}
              onClick={actions.onImportDownloadUrlsFromClipboard}
            >
              <ClipboardPaste size={14} aria-hidden="true" />
            </AppIconButton>
            <AppIconButton
              type="submit"
              aria-label={labels.downloadAddUrl}
              title={labels.downloadAddUrl}
              disabled={downloads.urlDraft.trim().length === 0}
            >
              <Plus size={14} aria-hidden="true" />
            </AppIconButton>
          </form>
        </div>
      </header>

      {downloads.errorMessage === undefined ? null : (
        <div className="lyra-file-manager-downloads-error">{downloads.errorMessage}</div>
      )}

      {downloads.isEmpty ? (
        <AppEmptyState className="lyra-file-manager-empty-state" title={labels.emptyDownloads} />
      ) : (
        <div className="lyra-app-group lyra-app-row-list lyra-file-manager-download-list">
          {downloads.tasks.map((task) => (
            <DownloadTaskRow
              key={task.id}
              task={task}
              labels={labels}
              actions={actions}
            />
          ))}
        </div>
      )}
    </div>
  );
};