export type DownloadTaskState =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export type DownloadTaskSource = "browser" | "manual" | "retry";

export type DownloadPriority = "low" | "normal" | "high";

export type DownloadTask = {
  readonly id: string;
  readonly url: string;
  readonly fileName: string;
  readonly source: DownloadTaskSource;
  readonly state: DownloadTaskState;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly speedBytesPerSecond: number;
  readonly estimatedRemainingMs?: number;
  readonly priority: DownloadPriority;
  readonly connectionsRequested: number;
  readonly connectionsActive: number;
  readonly errorMessage?: string;
};

export type DownloadsSnapshot = {
  readonly tasks: readonly DownloadTask[];
};

export type DownloadsMessages = {
  readonly emptyDownloads: string;
  readonly downloadAddUrl: string;
  readonly downloadUrlPlaceholder: string;
  readonly downloadOpenFile: string;
  readonly downloadRevealFile: string;
  readonly downloadPause: string;
  readonly downloadResume: string;
  readonly downloadCancel: string;
  readonly downloadRetry: string;
  readonly downloadRemove: string;
  readonly downloadPauseAll: string;
  readonly downloadResumeAll: string;
  readonly downloadCancelAll: string;
  readonly downloadPriority: string;
  readonly downloadPriorityLow: string;
  readonly downloadPriorityNormal: string;
  readonly downloadPriorityHigh: string;
  readonly downloadStateQueued: string;
  readonly downloadStateDownloading: string;
  readonly downloadStatePaused: string;
  readonly downloadStateCompleted: string;
  readonly downloadStateFailed: string;
  readonly downloadStateCanceled: string;
  readonly downloadSourceBrowser: string;
  readonly downloadSourceManual: string;
  readonly downloadConnections: string;
  readonly downloadUnknownSize: string;
  readonly downloadSpeedIdle: string;
  readonly downloadDurationSeconds: string;
  readonly downloadDurationMinutes: string;
  readonly downloadDurationHours: string;
  readonly downloadEta: string;
};
