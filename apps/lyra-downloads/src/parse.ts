import type {
  DownloadPriority,
  DownloadTask,
  DownloadTaskSource,
  DownloadTaskState,
  DownloadsSnapshot
} from "./types";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const finiteNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

const STATES = new Set<DownloadTaskState>([
  "queued",
  "downloading",
  "paused",
  "completed",
  "failed",
  "canceled"
]);

const SOURCES = new Set<DownloadTaskSource>(["browser", "manual", "retry"]);
const PRIORITIES = new Set<DownloadPriority>(["low", "normal", "high"]);

const parseState = (value: unknown): DownloadTaskState | undefined => {
  const state = stringValue(value);
  return state !== undefined && STATES.has(state as DownloadTaskState)
    ? state as DownloadTaskState
    : undefined;
};

const parseSource = (value: unknown): DownloadTaskSource => {
  const source = stringValue(value);
  return source !== undefined && SOURCES.has(source as DownloadTaskSource)
    ? source as DownloadTaskSource
    : "manual";
};

const parsePriority = (value: unknown): DownloadPriority => {
  const priority = stringValue(value);
  return priority !== undefined && PRIORITIES.has(priority as DownloadPriority)
    ? priority as DownloadPriority
    : "normal";
};

const parseTask = (value: unknown): DownloadTask | undefined => {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const url = stringValue(value.url);
  const fileName = stringValue(value.fileName);
  const state = parseState(value.state);
  if (id === undefined || url === undefined || fileName === undefined || state === undefined) {
    return undefined;
  }
  const estimatedRemainingMs = typeof value.estimatedRemainingMs === "number"
    && Number.isFinite(value.estimatedRemainingMs)
    && value.estimatedRemainingMs > 0
    ? value.estimatedRemainingMs
    : undefined;
  const errorMessage = stringValue(value.errorMessage);
  return {
    id,
    url,
    fileName,
    source: parseSource(value.source),
    state,
    receivedBytes: finiteNumber(value.receivedBytes),
    totalBytes: finiteNumber(value.totalBytes),
    speedBytesPerSecond: finiteNumber(value.speedBytesPerSecond),
    priority: parsePriority(value.priority),
    connectionsRequested: Math.max(1, Math.floor(finiteNumber(value.connectionsRequested) || 1)),
    connectionsActive: Math.floor(finiteNumber(value.connectionsActive)),
    ...(estimatedRemainingMs === undefined ? {} : { estimatedRemainingMs }),
    ...(errorMessage === undefined ? {} : { errorMessage })
  };
};

export const parseDownloadsSnapshot = (value: unknown): DownloadsSnapshot => {
  if (!isRecord(value) || !Array.isArray(value.tasks)) {
    throw new Error("Core returned an invalid download snapshot.");
  }
  return {
    tasks: value.tasks.flatMap((entry) => {
      const parsed = parseTask(entry);
      return parsed === undefined ? [] : [parsed];
    })
  };
};
