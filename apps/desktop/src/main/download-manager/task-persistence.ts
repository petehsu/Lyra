import type {
  DownloadManagerTask,
  DownloadManagerTaskState
} from "../../shared/download-manager";

export type DownloadTaskStartupRestoreDefaults = {
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly nowIso: () => string;
};

export const restoreDownloadTaskForStartup = (
  task: DownloadManagerTask,
  defaults: DownloadTaskStartupRestoreDefaults
): DownloadManagerTask => {
  const wasActive =
    task.state === "downloading" || task.state === "paused" || task.state === "queued";
  const restoredState: DownloadManagerTaskState =
    task.state === "downloading" || task.state === "queued"
      ? "queued"
      : task.state;

  return {
    ...task,
    state: restoredState,
    speedBytesPerSecond: 0,
    connectionsActive: 0,
    canResume:
      task.state === "completed" || task.state === "canceled"
        ? false
        : wasActive || task.canResume,
    retryCount: task.retryCount ?? 0,
    maxRetries: task.maxRetries ?? defaults.maxRetries,
    retryDelayMs: task.retryDelayMs ?? defaults.retryDelayMs,
    backend: task.backend ?? "electron",
    outputKind: task.outputKind ?? "file",
    activeMirrorIndex: task.activeMirrorIndex ?? 0,
    schedulePaused: task.schedulePaused ?? false,
    postProcessingState: task.postProcessingState ?? "idle",
    updatedAt: task.updatedAt ?? defaults.nowIso(),
    errorMessage: wasActive ? undefined : task.errorMessage
  };
};
