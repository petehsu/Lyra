import type {
  DownloadPriority,
  DownloadTask,
  DownloadTaskSource,
  DownloadTaskState,
  DownloadsMessages
} from "./types";

export const getDownloadProgressRatio = (task: DownloadTask): number => {
  if (task.totalBytes <= 0) {
    return task.state === "completed" ? 1 : 0;
  }
  return Math.max(0, Math.min(1, task.receivedBytes / task.totalBytes));
};

export const formatDownloadBytes = (
  value: number,
  labels: Pick<DownloadsMessages, "downloadUnknownSize">
): string => {
  if (value <= 0) {
    return labels.downloadUnknownSize;
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = size >= 100 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
};

export const formatDownloadSpeed = (
  bytesPerSecond: number,
  labels: Pick<DownloadsMessages, "downloadSpeedIdle" | "downloadUnknownSize">
): string => {
  if (bytesPerSecond <= 0) {
    return labels.downloadSpeedIdle;
  }
  return `${formatDownloadBytes(bytesPerSecond, labels)}/s`;
};

export const formatDownloadDuration = (
  milliseconds: number,
  labels: Pick<
    DownloadsMessages,
    "downloadDurationSeconds" | "downloadDurationMinutes" | "downloadDurationHours"
  >
): string => {
  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return labels.downloadDurationHours
      .replace("{hours}", String(hours))
      .replace("{minutes}", String(minutes));
  }
  if (minutes > 0) {
    return labels.downloadDurationMinutes
      .replace("{minutes}", String(minutes))
      .replace("{seconds}", String(seconds));
  }
  return labels.downloadDurationSeconds.replace("{seconds}", String(seconds));
};

export const formatDownloadEta = (
  milliseconds: number | undefined,
  labels: Pick<
    DownloadsMessages,
    | "downloadDurationSeconds"
    | "downloadDurationMinutes"
    | "downloadDurationHours"
    | "downloadEta"
  >
): string | null => {
  if (milliseconds === undefined || Number.isFinite(milliseconds) === false || milliseconds <= 0) {
    return null;
  }
  return labels.downloadEta.replace(
    "{duration}",
    formatDownloadDuration(milliseconds, labels)
  );
};

export const resolveDownloadStateLabel = (
  state: DownloadTaskState,
  labels: DownloadsMessages
): string => {
  switch (state) {
    case "queued":
      return labels.downloadStateQueued;
    case "downloading":
      return labels.downloadStateDownloading;
    case "paused":
      return labels.downloadStatePaused;
    case "completed":
      return labels.downloadStateCompleted;
    case "failed":
      return labels.downloadStateFailed;
    case "canceled":
      return labels.downloadStateCanceled;
    default:
      return state;
  }
};

export const resolveDownloadSourceLabel = (
  source: DownloadTaskSource,
  labels: DownloadsMessages
): string => source === "browser" ? labels.downloadSourceBrowser : labels.downloadSourceManual;

export const resolveDownloadPriorityLabel = (
  priority: DownloadPriority,
  labels: DownloadsMessages
): string => {
  switch (priority) {
    case "low":
      return labels.downloadPriorityLow;
    case "high":
      return labels.downloadPriorityHigh;
    default:
      return labels.downloadPriorityNormal;
  }
};

export const resolveDownloadStateTone = (
  state: DownloadTaskState
): "success" | "error" | "warning" | "info" | "neutral" => {
  switch (state) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "paused":
      return "warning";
    case "downloading":
      return "info";
    default:
      return "neutral";
  }
};
