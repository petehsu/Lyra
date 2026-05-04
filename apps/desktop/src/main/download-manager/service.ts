import {
  app,
  ipcMain,
  session,
  shell,
  type BrowserWindow,
  type DownloadItem,
  type WebContents
} from "electron";
import {
  existsSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type {
  DownloadManagerBatchRequest,
  DownloadManagerBtTaskOptions,
  DownloadManagerBtSettings,
  DownloadManagerEnqueueRequest,
  DownloadManagerEvent,
  DownloadManagerPriority,
  DownloadManagerPostProcessingSettings,
  DownloadManagerProxySettings,
  DownloadManagerRemoteApiStartRequest,
  DownloadManagerSaveRule,
  DownloadManagerScheduleSettings,
  DownloadManagerSetPriorityRequest,
  DownloadManagerSettings,
  DownloadManagerSnapshot,
  DownloadManagerTask,
  DownloadManagerChecksum,
  DownloadManagerTaskRequest,
  DownloadManagerTaskSource,
  DownloadManagerTaskState,
  DownloadManagerUpdateSettingsRequest
} from "../../shared/download-manager";
import {
  HttpDownloadController,
  isNativeHttpDownloadUrl
} from "./http-engine";
import {
  CurlDownloadController,
  isCurlDownloadUrl
} from "./curl-engine";
import {
  materializeBrowserPartialFileForResume,
  resolveBrowserPartialFileName
} from "./browser-partial";
import { scanExternalBrowserDownloads } from "./browser-import";
import {
  Aria2DownloadController,
  isAria2DownloadUrl
} from "./aria2-engine";
import { resolveAria2Runtime } from "./aria2-runtime";
import {
  parseDownloadImportItems,
  parseDownloadUrls
} from "./download-import";
import { sortDownloadMirrorsByProbe } from "./mirror-prober";
import { runDownloadPostProcessing } from "./post-processing";
import { sortDownloadQueueTaskIds } from "./queue";
import { createDownloadManagerRemoteApi } from "./remote-api";
import { restoreDownloadTaskForStartup } from "./task-persistence";

const TASKS_FILE_NAME = "tasks.v1.json";
const SETTINGS_FILE_NAME = "settings.v1.json";
const SAVE_DEBOUNCE_MS = 500;
const DEFAULT_CONNECTION_COUNT = 1;
const DEFAULT_NATIVE_HTTP_CONNECTIONS = 4;
const MAX_ACTIVE_NATIVE_DOWNLOADS = 3;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1_500;
const MIRROR_PROBE_TIMEOUT_MS = 1_500;

type DownloadSourceContext = {
  readonly tabId: string;
  readonly title?: string | undefined;
  readonly url?: string | undefined;
};

type StoredDownloadTasksFile = {
  readonly version: 1;
  readonly tasks: readonly DownloadManagerTask[];
};

type SaveRuleResolution = {
  readonly directory: string;
  readonly tags: readonly string[];
};

const nowIso = (): string => new Date().toISOString();

const createId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `download-${crypto.randomUUID()}`;
  }
  return `download-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
};

const toOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const sanitizeFileName = (value: string): string => {
  const trimmed = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  const withoutTrailingDots = trimmed.replace(/[. ]+$/g, "");
  if (withoutTrailingDots.length === 0) {
    return "download";
  }
  return withoutTrailingDots.slice(0, 180);
};

const fileNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "magnet:") {
      const displayName = parsed.searchParams.get("dn");
      if (displayName !== null && displayName.trim().length > 0) {
        return sanitizeFileName(displayName);
      }
      return "magnet-download";
    }
    const lastSegment = parsed.pathname.split("/").filter(Boolean).pop();
    if (lastSegment !== undefined && lastSegment.length > 0) {
      return sanitizeFileName(decodeURIComponent(lastSegment));
    }
  } catch {
    // Fall through to generic naming.
  }
  return "download";
};

const parseProtocol = (url: string): string => {
  try {
    return new URL(url).protocol.replace(/:$/u, "");
  } catch {
    return "unknown";
  }
};

export { parseDownloadUrls } from "./download-import";

const normalizeMirrorUrls = (
  value: readonly string[] | undefined
): readonly string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const urls = parseDownloadUrls({ urls: value });
  return urls.length === 0 ? undefined : urls;
};

const normalizeRetryCount = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return fallback;
  }
  return Math.max(0, Math.min(20, Math.round(value)));
};

const normalizeRetryDelayMs = (value: number | undefined): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return DEFAULT_RETRY_DELAY_MS;
  }
  return Math.max(0, Math.min(60_000, Math.round(value)));
};

const normalizeTaskRequest = (payload: DownloadManagerTaskRequest): DownloadManagerTaskRequest => {
  const taskId = payload.taskId.trim();
  if (taskId.length === 0) {
    throw new Error("taskId is required");
  }
  return { taskId };
};

const isDownloadPriority = (value: unknown): value is DownloadManagerPriority =>
  value === "low" || value === "normal" || value === "high";

const normalizeSetPriorityRequest = (
  payload: DownloadManagerSetPriorityRequest
): DownloadManagerSetPriorityRequest => {
  const { taskId } = normalizeTaskRequest(payload);
  if (isDownloadPriority(payload.priority) === false) {
    throw new Error("priority must be low, normal, or high");
  }
  return {
    taskId,
    priority: payload.priority
  };
};

const normalizeBatchRequest = (payload: unknown): DownloadManagerBatchRequest => {
  if (payload === undefined || payload === null) {
    return {};
  }
  const request = payload as DownloadManagerBatchRequest;
  const rawTaskIds = Array.isArray(request.taskIds) ? request.taskIds : undefined;
  const taskIds = rawTaskIds
    ?.filter((taskId): taskId is string => typeof taskId === "string")
    .map((taskId) => taskId.trim())
    .filter((taskId) => taskId.length > 0);
  return taskIds === undefined || taskIds.length === 0
    ? {}
    : { taskIds: [...new Set(taskIds)] };
};

const mapDoneState = (state: "completed" | "cancelled" | "interrupted"): DownloadManagerTaskState => {
  if (state === "completed") {
    return "completed";
  }
  if (state === "cancelled") {
    return "canceled";
  }
  return "failed";
};

const estimateRemainingMs = (
  receivedBytes: number,
  totalBytes: number,
  speedBytesPerSecond: number
): number | undefined => {
  if (totalBytes <= 0 || speedBytesPerSecond <= 0 || receivedBytes >= totalBytes) {
    return undefined;
  }
  return Math.round(((totalBytes - receivedBytes) / speedBytesPerSecond) * 1000);
};

const computeFileHash = (
  filePath: string,
  algorithm: DownloadManagerChecksum["algorithm"]
): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const input = createReadStream(filePath);
    input.on("data", (chunk) => {
      hash.update(chunk);
    });
    input.on("error", reject);
    input.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });

const sortTasks = (tasks: Iterable<DownloadManagerTask>): readonly DownloadManagerTask[] =>
  [...tasks].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

const readStoredTasks = (tasksFilePath: string): readonly DownloadManagerTask[] => {
  try {
    const raw = readFileSync(tasksFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredDownloadTasksFile>;
    if (parsed.version !== 1 || Array.isArray(parsed.tasks) === false) {
      return [];
    }
    return parsed.tasks
      .filter((task): task is DownloadManagerTask =>
        typeof task?.id === "string"
        && typeof task.url === "string"
        && typeof task.fileName === "string"
        && typeof task.savePath === "string"
      )
      .map((task) =>
        restoreDownloadTaskForStartup(task, {
          maxRetries: DEFAULT_MAX_RETRIES,
          retryDelayMs: DEFAULT_RETRY_DELAY_MS,
          nowIso
        })
      );
  } catch {
    return [];
  }
};

const writeStoredTasks = (
  storageRoot: string,
  tasksFilePath: string,
  tasks: readonly DownloadManagerTask[]
): void => {
  mkdirSync(storageRoot, { recursive: true });
  const tempPath = `${tasksFilePath}.tmp`;
  const payload: StoredDownloadTasksFile = {
    version: 1,
    tasks
  };
  writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  renameSync(tempPath, tasksFilePath);
};

const createDefaultSettings = (): DownloadManagerSettings => ({
  version: 1,
  speedLimitBytesPerSecond: null,
  schedule: null,
  proxy: {
    mode: "system"
  },
  postProcessing: {
    autoExtract: false,
    deleteArchiveAfterExtract: false,
    detectSplitArchives: true
  },
  bt: {
    dhtEnabled: true,
    peerExchangeEnabled: true,
    localPeerDiscoveryEnabled: true,
    seedTimeMinutes: 0,
    trackerUrls: [],
    maxUploadBytesPerSecond: null
  },
  defaultHeaders: {},
  defaultCookieHeader: null,
  saveRules: [],
  updatedAt: nowIso()
});

const normalizeSpeedLimit = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return null;
  }
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
};

const normalizeStringList = (value: unknown): readonly string[] | undefined => {
  if (Array.isArray(value) === false) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length === 0 ? undefined : [...new Set(items)];
};

const normalizePositiveIntegerList = (value: unknown): readonly number[] | undefined => {
  if (Array.isArray(value) === false) {
    return undefined;
  }
  const items = value
    .filter((item): item is number => typeof item === "number" && Number.isInteger(item))
    .map((item) => Math.max(1, Math.min(10_000, item)));
  return items.length === 0 ? undefined : [...new Set(items)];
};

const normalizeHeaderMap = (value: unknown): Readonly<Record<string, string>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    const normalizedName = name.trim();
    if (
      normalizedName.length === 0
      || typeof headerValue !== "string"
      || headerValue.trim().length === 0
    ) {
      continue;
    }
    headers[normalizedName] = headerValue.trim();
  }
  return headers;
};

const clampMinuteOfDay = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return fallback;
  }
  return Math.max(0, Math.min(1439, Math.round(value)));
};

const normalizeSchedule = (value: unknown): DownloadManagerScheduleSettings | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const schedule = value as Partial<DownloadManagerScheduleSettings>;
  return {
    enabled: schedule.enabled !== false,
    startMinuteOfDay: clampMinuteOfDay(schedule.startMinuteOfDay, 0),
    endMinuteOfDay: clampMinuteOfDay(schedule.endMinuteOfDay, 1439),
    outsideAction: schedule.outsideAction === "speed-limit" ? "speed-limit" : "pause",
    outsideSpeedLimitBytesPerSecond:
      normalizeSpeedLimit(schedule.outsideSpeedLimitBytesPerSecond)
  };
};

const normalizeProxy = (value: unknown): DownloadManagerProxySettings => {
  const proxy = value as Partial<DownloadManagerProxySettings>;
  const mode =
    proxy.mode === "direct"
    || proxy.mode === "http"
    || proxy.mode === "socks5"
    || proxy.mode === "system"
      ? proxy.mode
      : "system";
  const url = typeof proxy.url === "string" && proxy.url.trim().length > 0
    ? proxy.url.trim()
    : undefined;
  return {
    mode,
    ...(url === undefined ? {} : { url })
  };
};

const normalizePostProcessing = (value: unknown): DownloadManagerPostProcessingSettings => {
  const postProcessing = value as Partial<DownloadManagerPostProcessingSettings>;
  return {
    autoExtract: postProcessing.autoExtract === true,
    ...(typeof postProcessing.extractDirectory === "string"
      && postProcessing.extractDirectory.trim().length > 0
      ? { extractDirectory: postProcessing.extractDirectory.trim() }
      : {}),
    deleteArchiveAfterExtract: postProcessing.deleteArchiveAfterExtract === true,
    detectSplitArchives: postProcessing.detectSplitArchives !== false
  };
};

const normalizeBtSettings = (value: unknown): DownloadManagerBtSettings => {
  const bt = value as Partial<DownloadManagerBtSettings>;
  const seedTimeMinutes = typeof bt.seedTimeMinutes === "number" && Number.isFinite(bt.seedTimeMinutes)
    ? Math.max(0, Math.min(10_080, Math.round(bt.seedTimeMinutes)))
    : 0;
  return {
    dhtEnabled: bt.dhtEnabled !== false,
    peerExchangeEnabled: bt.peerExchangeEnabled !== false,
    localPeerDiscoveryEnabled: bt.localPeerDiscoveryEnabled !== false,
    seedTimeMinutes,
    trackerUrls: normalizeStringList(bt.trackerUrls) ?? [],
    maxUploadBytesPerSecond: normalizeSpeedLimit(bt.maxUploadBytesPerSecond)
  };
};

const normalizeBtTaskOptions = (
  value: unknown
): DownloadManagerBtTaskOptions | undefined => {
  const bt = value as Partial<DownloadManagerBtTaskOptions> | undefined;
  if (bt === undefined || bt === null) {
    return undefined;
  }
  const selectedFileIndexes = normalizePositiveIntegerList(bt.selectedFileIndexes);
  const trackerUrls = normalizeStringList(bt.trackerUrls);
  if (selectedFileIndexes === undefined && trackerUrls === undefined) {
    return undefined;
  }
  return {
    ...(selectedFileIndexes === undefined ? {} : { selectedFileIndexes }),
    ...(trackerUrls === undefined ? {} : { trackerUrls })
  };
};

const normalizeSaveRule = (value: unknown): DownloadManagerSaveRule | null => {
  const rule = value as Partial<DownloadManagerSaveRule>;
  if (
    typeof rule.id !== "string"
    || rule.id.trim().length === 0
    || typeof rule.name !== "string"
    || rule.name.trim().length === 0
    || typeof rule.directory !== "string"
    || rule.directory.trim().length === 0
  ) {
    return null;
  }
  return {
    id: rule.id.trim(),
    enabled: rule.enabled !== false,
    name: rule.name.trim(),
    directory: rule.directory.trim(),
    ...(normalizeStringList(rule.extensions) === undefined
      ? {}
      : { extensions: normalizeStringList(rule.extensions) }),
    ...(normalizeStringList(rule.hostContains) === undefined
      ? {}
      : { hostContains: normalizeStringList(rule.hostContains) }),
    ...(normalizeStringList(rule.protocols) === undefined
      ? {}
      : { protocols: normalizeStringList(rule.protocols) }),
    ...(normalizeStringList(rule.tags) === undefined
      ? {}
      : { tags: normalizeStringList(rule.tags) })
  };
};

const normalizeSettings = (value: unknown): DownloadManagerSettings => {
  const parsed = value as Partial<DownloadManagerSettings>;
  const saveRules = Array.isArray(parsed.saveRules)
    ? parsed.saveRules
      .map(normalizeSaveRule)
      .filter((rule): rule is DownloadManagerSaveRule => rule !== null)
    : [];
  return {
    version: 1,
    speedLimitBytesPerSecond: normalizeSpeedLimit(parsed.speedLimitBytesPerSecond),
    schedule: normalizeSchedule(parsed.schedule),
    proxy: normalizeProxy(parsed.proxy),
    postProcessing: normalizePostProcessing(parsed.postProcessing),
    bt: normalizeBtSettings(parsed.bt),
    defaultHeaders: normalizeHeaderMap(parsed.defaultHeaders),
    defaultCookieHeader:
      typeof parsed.defaultCookieHeader === "string"
      && parsed.defaultCookieHeader.trim().length > 0
        ? parsed.defaultCookieHeader.trim()
        : null,
    saveRules,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso()
  };
};

const readStoredSettings = (settingsFilePath: string): DownloadManagerSettings => {
  try {
    const raw = readFileSync(settingsFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DownloadManagerSettings>;
    if (parsed.version !== 1) {
      return createDefaultSettings();
    }
    return normalizeSettings(parsed);
  } catch {
    return createDefaultSettings();
  }
};

const writeStoredSettings = (
  storageRoot: string,
  settingsFilePath: string,
  settings: DownloadManagerSettings
): void => {
  mkdirSync(storageRoot, { recursive: true });
  const tempPath = `${settingsFilePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(settings, null, 2), "utf8");
  renameSync(tempPath, settingsFilePath);
};

const extensionOfFileName = (fileName: string): string => {
  const extension = path.extname(fileName).replace(/^\./u, "").toLowerCase();
  return extension;
};

const resolveSaveRule = (
  settings: DownloadManagerSettings,
  url: string,
  fileName: string
): DownloadManagerSaveRule | null => {
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }
  const protocol = parsedUrl?.protocol.replace(/:$/u, "").toLowerCase();
  const host = parsedUrl?.host.toLowerCase() ?? "";
  const extension = extensionOfFileName(fileName);

  for (const rule of settings.saveRules) {
    if (rule.enabled === false) {
      continue;
    }
    if (
      rule.extensions !== undefined
      && (extension.length === 0 || rule.extensions.map((item) => item.toLowerCase()).includes(extension) === false)
    ) {
      continue;
    }
    if (
      rule.protocols !== undefined
      && (protocol === undefined || rule.protocols.map((item) => item.toLowerCase()).includes(protocol) === false)
    ) {
      continue;
    }
    if (
      rule.hostContains !== undefined
      && rule.hostContains.some((item) => host.includes(item.toLowerCase())) === false
    ) {
      continue;
    }
    return rule;
  }
  return null;
};

const resolveUniqueSavePath = (
  directory: string,
  fileName: string,
  reservedPaths: ReadonlySet<string>
): string => {
  const parsed = path.parse(fileName);
  const baseName = parsed.name.length > 0 ? parsed.name : "download";
  const extension = parsed.ext;
  for (let index = 0; index < 10_000; index += 1) {
    const candidateName = index === 0 ? `${baseName}${extension}` : `${baseName} (${index})${extension}`;
    const candidatePath = path.join(directory, candidateName);
    if (reservedPaths.has(candidatePath) === false && existsSync(candidatePath) === false) {
      return candidatePath;
    }
  }
  return path.join(directory, `${baseName}-${Date.now().toString(36)}${extension}`);
};

const resolveUniqueDirectoryPath = (
  directory: string,
  directoryName: string,
  reservedPaths: ReadonlySet<string>
): string => {
  const baseName = sanitizeFileName(directoryName);
  for (let index = 0; index < 10_000; index += 1) {
    const candidateName = index === 0 ? baseName : `${baseName} (${index})`;
    const candidatePath = path.join(directory, candidateName);
    if (reservedPaths.has(candidatePath) === false && existsSync(candidatePath) === false) {
      return candidatePath;
    }
  }
  return path.join(directory, `${baseName}-${Date.now().toString(36)}`);
};

const getReservedSavePaths = (
  tasks: Iterable<DownloadManagerTask>,
  ignoreTaskId?: string
): ReadonlySet<string> => {
  const paths = new Set<string>();
  for (const task of tasks) {
    if (task.id === ignoreTaskId) {
      continue;
    }
    paths.add(task.savePath);
  }
  return paths;
};

const createQueuedTask = ({
  url,
  fileName,
  savePathOverride,
  source,
  directory,
  reservedPaths,
  headersSource,
  checksum,
  requestHeaders,
  proxy,
  maxRetries,
  retryDelayMs,
  mirrors,
  bt,
  backend,
  outputKind,
  tags
}: {
  readonly url: string;
  readonly fileName?: string | undefined;
  readonly savePathOverride?: string | undefined;
  readonly source: DownloadManagerTaskSource;
  readonly directory: string;
  readonly reservedPaths: ReadonlySet<string>;
  readonly headersSource?: DownloadSourceContext | undefined;
  readonly checksum?: DownloadManagerChecksum | undefined;
  readonly requestHeaders?: Readonly<Record<string, string>> | undefined;
  readonly proxy?: DownloadManagerProxySettings | undefined;
  readonly maxRetries?: number | undefined;
  readonly retryDelayMs?: number | undefined;
  readonly mirrors?: readonly string[] | undefined;
  readonly bt?: DownloadManagerBtTaskOptions | undefined;
  readonly backend?: DownloadManagerTask["backend"] | undefined;
  readonly outputKind?: DownloadManagerTask["outputKind"] | undefined;
  readonly tags?: readonly string[] | undefined;
}): DownloadManagerTask => {
  const resolvedFileName = fileName ?? fileNameFromUrl(url);
  const resolvedOutputKind = outputKind ?? "file";
  const savePath = savePathOverride ?? (
    resolvedOutputKind === "directory"
      ? resolveUniqueDirectoryPath(directory, resolvedFileName, reservedPaths)
      : resolveUniqueSavePath(directory, resolvedFileName, reservedPaths)
  );
  const createdAt = nowIso();
  return {
    id: createId(),
    url,
    originalUrl: url,
    fileName: path.basename(savePath),
    ...(requestHeaders === undefined ? {} : { requestHeaders }),
    ...(proxy === undefined ? {} : { proxy }),
    savePath,
    directory,
    protocol: parseProtocol(url),
    source,
    backend: backend ?? "electron",
    outputKind: resolvedOutputKind,
    ...(headersSource?.tabId === undefined ? {} : { sourceTabId: headersSource.tabId }),
    ...(headersSource?.title === undefined ? {} : { sourceTitle: headersSource.title }),
    state: "queued",
    receivedBytes: 0,
    totalBytes: 0,
    speedBytesPerSecond: 0,
    priority: "normal",
    connectionsRequested: DEFAULT_CONNECTION_COUNT,
    connectionsActive: 0,
    canResume: false,
    createdAt,
    updatedAt: createdAt,
    ...(checksum === undefined ? {} : { checksum }),
    retryCount: 0,
    maxRetries: normalizeRetryCount(maxRetries, DEFAULT_MAX_RETRIES),
    retryDelayMs: normalizeRetryDelayMs(retryDelayMs),
    ...(mirrors === undefined ? {} : { mirrors }),
    activeMirrorIndex: 0,
    ...(bt === undefined ? {} : { bt }),
    schedulePaused: false,
    postProcessingState: "idle",
    tags: tags ?? []
  };
};

export type DownloadManagerIpcBridge = {
  readonly dispose: () => void;
  readonly attachWebContents: (tabId: string, webContents: WebContents) => () => void;
  readonly readSnapshot: () => DownloadManagerSnapshot;
};

export const createDownloadManagerIpcBridge = ({
  storageRoot,
  getWindow
}: {
  readonly storageRoot: string;
  readonly getWindow: () => BrowserWindow | null;
}): DownloadManagerIpcBridge => {
  mkdirSync(storageRoot, { recursive: true });
  const tasksFilePath = path.join(storageRoot, TASKS_FILE_NAME);
  const settingsFilePath = path.join(storageRoot, SETTINGS_FILE_NAME);
  const tasks = new Map<string, DownloadManagerTask>();
  const activeItems = new Map<string, DownloadItem>();
  const activeHttpDownloads = new Map<string, HttpDownloadController>();
  const activeCurlDownloads = new Map<string, CurlDownloadController>();
  const activeAria2Downloads = new Map<string, Aria2DownloadController>();
  const queuedNativeTaskIds: string[] = [];
  const queuedCurlTaskIds: string[] = [];
  const queuedAria2TaskIds: string[] = [];
  const nativeHeadersByTaskId = new Map<string, Readonly<Record<string, string>>>();
  const curlHeadersByTaskId = new Map<string, Readonly<Record<string, string>>>();
  const aria2HeadersByTaskId = new Map<string, Readonly<Record<string, string>>>();
  const pendingTaskIdsByUrl = new Map<string, string[]>();
  const sourcesByWebContentsId = new Map<number, DownloadSourceContext>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let settings = readStoredSettings(settingsFilePath);
  let scheduleTimer: ReturnType<typeof setInterval> | null = null;
  let startupRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  for (const task of readStoredTasks(tasksFilePath)) {
    tasks.set(task.id, task);
  }

  const snapshot = (): DownloadManagerSnapshot => ({
    tasks: sortTasks(tasks.values())
  });

  const sendEvent = (event: DownloadManagerEvent): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.downloadsEvent, event);
  };

  const flushTasks = (): void => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    writeStoredTasks(storageRoot, tasksFilePath, sortTasks(tasks.values()));
  };

  const scheduleSave = (): void => {
    if (saveTimer !== null) {
      return;
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        writeStoredTasks(storageRoot, tasksFilePath, sortTasks(tasks.values()));
      } catch (error) {
        console.warn(`[lyra-downloads] failed to persist tasks: ${String(error)}`);
      }
    }, SAVE_DEBOUNCE_MS);
  };

  const setSettings = (
    request: DownloadManagerUpdateSettingsRequest
  ): DownloadManagerSettings => {
    settings = normalizeSettings({
      ...settings,
      ...request,
      version: 1,
      updatedAt: nowIso()
    });
    writeStoredSettings(storageRoot, settingsFilePath, settings);
    setTimeout(applySchedule, 0);
    return settings;
  };

  const resolveSaveRuleForDownload = (
    url: string,
    fileName: string
  ): SaveRuleResolution => {
    const rule = resolveSaveRule(settings, url, fileName);
    if (rule === null) {
      return {
        directory: app.getPath("downloads"),
        tags: []
      };
    }
    return {
      directory: rule.directory,
      tags: rule.tags ?? []
    };
  };

  const isScheduleWindowActive = (): boolean => {
    const schedule = settings.schedule;
    if (schedule === null || schedule.enabled === false) {
      return true;
    }
    const now = new Date();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    if (schedule.startMinuteOfDay === schedule.endMinuteOfDay) {
      return true;
    }
    if (schedule.startMinuteOfDay < schedule.endMinuteOfDay) {
      return minuteOfDay >= schedule.startMinuteOfDay && minuteOfDay < schedule.endMinuteOfDay;
    }
    return minuteOfDay >= schedule.startMinuteOfDay || minuteOfDay < schedule.endMinuteOfDay;
  };

  const isSchedulePauseActive = (): boolean => {
    const schedule = settings.schedule;
    return schedule !== null
      && schedule.enabled
      && schedule.outsideAction === "pause"
      && isScheduleWindowActive() === false;
  };

  const resolveCurrentSpeedLimit = (): number | undefined => {
    const schedule = settings.schedule;
    if (
      schedule !== null
      && schedule.enabled
      && schedule.outsideAction === "speed-limit"
      && isScheduleWindowActive() === false
    ) {
      return schedule.outsideSpeedLimitBytesPerSecond ?? undefined;
    }
    return settings.speedLimitBytesPerSecond ?? undefined;
  };

  const resolveProxyUrl = (task?: DownloadManagerTask): string | undefined => {
    const proxy = task?.proxy ?? settings.proxy;
    if (proxy.mode === "direct" || proxy.mode === "system") {
      return undefined;
    }
    return proxy.url;
  };

  const resolveRequestHeaders = (
    headers?: Readonly<Record<string, string>>,
    cookieHeader?: string
  ): Readonly<Record<string, string>> | undefined => {
    const merged: Record<string, string> = {
      ...settings.defaultHeaders,
      ...(headers ?? {})
    };
    const effectiveCookieHeader =
      typeof cookieHeader === "string" && cookieHeader.trim().length > 0
        ? cookieHeader.trim()
        : settings.defaultCookieHeader;
    if (
      effectiveCookieHeader !== null
      && Object.keys(merged).some((name) => name.toLowerCase() === "cookie") === false
    ) {
      merged.Cookie = effectiveCookieHeader;
    }
    return Object.keys(merged).length === 0 ? undefined : merged;
  };

  const shouldUseCurlBackend = (url: string, task?: DownloadManagerTask): boolean =>
    task?.backend === "curl"
    || isCurlDownloadUrl(url)
    || (isNativeHttpDownloadUrl(url) && resolveProxyUrl(task) !== undefined);

  const shouldUseAria2Backend = (url: string): boolean => isAria2DownloadUrl(url);

  const resolveAria2RuntimeForDownload = () =>
    resolveAria2Runtime({
      platform: process.platform,
      arch: process.arch,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
      allowPathFallback: app.isPackaged === false
    });

  const setTask = (task: DownloadManagerTask): DownloadManagerTask => {
    tasks.set(task.id, task);
    scheduleSave();
    sendEvent({ kind: "task-updated", task });
    return task;
  };

  const patchTask = (
    taskId: string,
    updater: (task: DownloadManagerTask) => DownloadManagerTask
  ): DownloadManagerTask | null => {
    const current = tasks.get(taskId);
    if (current === undefined) {
      return null;
    }
    return setTask(updater(current));
  };

  const verifyTaskChecksum = async (taskId: string): Promise<boolean> => {
    const task = tasks.get(taskId);
    if (task?.checksum === undefined) {
      return true;
    }
    try {
      const actual = await computeFileHash(task.savePath, task.checksum.algorithm);
      const verified = actual.toLowerCase() === task.checksum.expected.toLowerCase();
      patchTask(taskId, (current) => ({
        ...current,
        state: verified ? current.state : "failed",
        checksum: {
          ...task.checksum!,
          actual,
          verified
        },
        updatedAt: nowIso(),
        errorMessage: verified
          ? current.errorMessage
          : `${task.checksum!.algorithm.toUpperCase()} checksum mismatch.`
      }));
      return verified;
    } catch (error) {
      patchTask(taskId, (current) => ({
        ...current,
        state: "failed",
        updatedAt: nowIso(),
        errorMessage: error instanceof Error ? error.message : String(error)
      }));
      return false;
    }
  };

  const finalizeCompletedDownload = async (taskId: string): Promise<void> => {
    const checksumOk = await verifyTaskChecksum(taskId);
    const task = tasks.get(taskId);
    if (checksumOk === false || task === undefined || task.state !== "completed") {
      return;
    }
    patchTask(taskId, (current) => ({
      ...current,
      postProcessingState: "running",
      postProcessingMessage: undefined,
      missingArchiveParts: undefined,
      updatedAt: nowIso()
    }));
    const result = await runDownloadPostProcessing(task, settings.postProcessing);
    patchTask(taskId, (current) => ({
      ...current,
      postProcessingState: result.state,
      postProcessingMessage: result.message,
      missingArchiveParts: result.missingParts,
      updatedAt: nowIso()
    }));
  };

  const startNativeHttpDownload = (
    task: DownloadManagerTask,
    headers?: Readonly<Record<string, string>>
  ): void => {
    const partsRoot = path.join(storageRoot, "parts");
    const speedLimit = resolveCurrentSpeedLimit();
    const requestHeaders = headers ?? task.requestHeaders ?? resolveRequestHeaders();
    const controller = new HttpDownloadController({
      taskId: task.id,
      url: task.url,
      savePath: task.savePath,
      partsRoot,
      connections: task.connectionsRequested,
      ...(speedLimit === undefined
        ? {}
        : { maxBytesPerSecond: speedLimit }),
      ...(requestHeaders === undefined ? {} : { headers: requestHeaders }),
      onUpdate: (update) => {
        patchTask(task.id, (current) => ({
          ...current,
          state: "downloading",
          receivedBytes: update.receivedBytes,
          totalBytes: update.totalBytes,
          speedBytesPerSecond: update.speedBytesPerSecond,
          estimatedRemainingMs: estimateRemainingMs(
            update.receivedBytes,
            update.totalBytes,
            update.speedBytesPerSecond
          ),
          connectionsActive: update.connectionsActive,
          canResume: true,
          updatedAt: nowIso(),
          errorMessage: undefined
        }));
      },
      onComplete: (completion) => {
        activeHttpDownloads.delete(task.id);
        patchTask(task.id, (current) => ({
          ...current,
          finalUrl: completion.finalUrl,
          state: "completed",
          receivedBytes: completion.totalBytes > 0 ? completion.totalBytes : current.receivedBytes,
          totalBytes: completion.totalBytes > 0 ? completion.totalBytes : current.totalBytes,
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          canResume: false,
          completedAt: nowIso(),
          updatedAt: nowIso(),
          errorMessage: undefined
        }));
        void finalizeCompletedDownload(task.id);
        drainNativeHttpQueue();
      },
      onError: (error) => {
        activeHttpDownloads.delete(task.id);
        const current = tasks.get(task.id);
        if (current !== undefined) {
          const retryTask = scheduleNativeAutoRetry(current);
          if (retryTask !== null) {
            drainNativeHttpQueue();
            return;
          }
        }
        patchTask(task.id, (currentTask) => ({
          ...currentTask,
          state: "failed",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          canResume: true,
          updatedAt: nowIso(),
          errorMessage: error.message
        }));
        drainNativeHttpQueue();
      },
      onPaused: () => {
        activeHttpDownloads.delete(task.id);
        patchTask(task.id, (current) => ({
          ...current,
          state: "paused",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          canResume: true,
          updatedAt: nowIso()
        }));
        drainNativeHttpQueue();
      },
      onCanceled: () => {
        activeHttpDownloads.delete(task.id);
        patchTask(task.id, (current) => ({
          ...current,
          state: "canceled",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          updatedAt: nowIso(),
          errorMessage: "Download canceled."
        }));
        drainNativeHttpQueue();
      }
    });
    activeHttpDownloads.set(task.id, controller);
    setTask({
      ...task,
      state: "downloading",
      schedulePaused: false,
      connectionsRequested: task.connectionsRequested,
      connectionsActive: Math.max(1, task.connectionsRequested),
      canResume: true,
      startedAt: task.startedAt ?? nowIso(),
      updatedAt: nowIso(),
      errorMessage: undefined
    });
    void controller.start().finally(() => {
      if (activeHttpDownloads.get(task.id) === controller) {
        activeHttpDownloads.delete(task.id);
      }
    });
  };

  const startCurlDownload = (
    task: DownloadManagerTask,
    headers?: Readonly<Record<string, string>>
  ): void => {
    const speedLimit = resolveCurrentSpeedLimit();
    const proxyUrl = resolveProxyUrl(task);
    const requestHeaders = headers ?? task.requestHeaders ?? resolveRequestHeaders();
    const controller = new CurlDownloadController({
      taskId: task.id,
      url: task.url,
      savePath: task.savePath,
      ...(requestHeaders === undefined ? {} : { headers: requestHeaders }),
      ...(speedLimit === undefined
        ? {}
        : { maxBytesPerSecond: speedLimit }),
      ...(proxyUrl === undefined ? {} : { proxyUrl }),
      onUpdate: (update) => {
        patchTask(task.id, (current) => ({
          ...current,
          state: "downloading",
          receivedBytes: update.receivedBytes,
          speedBytesPerSecond: update.speedBytesPerSecond,
          connectionsActive: 1,
          canResume: true,
          updatedAt: nowIso(),
          errorMessage: undefined
        }));
      },
      onComplete: () => {
        activeCurlDownloads.delete(task.id);
        patchTask(task.id, (current) => ({
          ...current,
          state: "completed",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          canResume: false,
          completedAt: nowIso(),
          updatedAt: nowIso(),
          errorMessage: undefined
        }));
        void finalizeCompletedDownload(task.id);
      },
      onError: (error) => {
        activeCurlDownloads.delete(task.id);
        const current = tasks.get(task.id);
        if (current !== undefined) {
          const retryTask = scheduleCurlAutoRetry(current);
          if (retryTask !== null) {
            drainCurlQueue();
            return;
          }
        }
        patchTask(task.id, (current) => ({
          ...current,
          state: "failed",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          canResume: true,
          updatedAt: nowIso(),
          errorMessage: error.message
        }));
      },
      onPaused: () => {
        activeCurlDownloads.delete(task.id);
        patchTask(task.id, (current) => ({
          ...current,
          state: "paused",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          canResume: true,
          updatedAt: nowIso()
        }));
      },
      onCanceled: () => {
        activeCurlDownloads.delete(task.id);
        patchTask(task.id, (current) => ({
          ...current,
          state: "canceled",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          updatedAt: nowIso(),
          errorMessage: "Download canceled."
        }));
      }
    });
    activeCurlDownloads.set(task.id, controller);
    setTask({
      ...task,
      state: "downloading",
      schedulePaused: false,
      connectionsRequested: 1,
      connectionsActive: 1,
      canResume: true,
      startedAt: task.startedAt ?? nowIso(),
      updatedAt: nowIso(),
      errorMessage: undefined
    });
    void controller.start().finally(() => {
      if (activeCurlDownloads.get(task.id) === controller) {
        activeCurlDownloads.delete(task.id);
      }
    });
  };

  const startAria2Download = (
    task: DownloadManagerTask,
    headers?: Readonly<Record<string, string>>
  ): void => {
    const runtime = resolveAria2RuntimeForDownload();
    if (runtime.available === false) {
      patchTask(task.id, (current) => ({
        ...current,
        state: "failed",
        backend: "aria2",
        outputKind: "directory",
        speedBytesPerSecond: 0,
        estimatedRemainingMs: undefined,
        connectionsActive: 0,
        canResume: true,
        updatedAt: nowIso(),
        errorMessage: runtime.target === null
          ? "aria2 is not bundled for this platform."
          : `Bundled aria2 runtime is missing for ${runtime.target.id}.`
      }));
      drainAria2Queue();
      return;
    }
    const speedLimit = resolveCurrentSpeedLimit();
    const btSettings = settings.bt;
    const proxyUrl = resolveProxyUrl(task);
    const requestHeaders = headers ?? task.requestHeaders ?? resolveRequestHeaders();
    const controller = new Aria2DownloadController({
      taskId: task.id,
      url: task.url,
      directory: task.savePath,
      binaryPath: runtime.binaryPath,
      ...(requestHeaders === undefined ? {} : { headers: requestHeaders }),
      ...(speedLimit === undefined
        ? {}
        : { maxBytesPerSecond: speedLimit }),
      ...(btSettings.maxUploadBytesPerSecond === null
        ? {}
        : { maxUploadBytesPerSecond: btSettings.maxUploadBytesPerSecond }),
      ...(proxyUrl === undefined ? {} : { proxyUrl }),
      dhtEnabled: btSettings.dhtEnabled,
      peerExchangeEnabled: btSettings.peerExchangeEnabled,
      localPeerDiscoveryEnabled: btSettings.localPeerDiscoveryEnabled,
      selectedFileIndexes: task.bt?.selectedFileIndexes,
      seedTimeMinutes: btSettings.seedTimeMinutes,
      trackerUrls: [
        ...(task.bt?.trackerUrls ?? []),
        ...btSettings.trackerUrls
      ],
      onUpdate: (update) => {
        patchTask(task.id, (current) => ({
          ...current,
          state: "downloading",
          backend: "aria2",
          outputKind: "directory",
          receivedBytes: update.receivedBytes,
          totalBytes: update.totalBytes,
          speedBytesPerSecond: update.speedBytesPerSecond,
          estimatedRemainingMs: estimateRemainingMs(
            update.receivedBytes,
            update.totalBytes,
            update.speedBytesPerSecond
          ),
          connectionsActive: update.connectionsActive,
          canResume: true,
          updatedAt: nowIso(),
          errorMessage: undefined
        }));
      },
      onComplete: () => {
        activeAria2Downloads.delete(task.id);
        patchTask(task.id, (current) => ({
          ...current,
          state: "completed",
          backend: "aria2",
          outputKind: "directory",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          canResume: false,
          postProcessingState: "idle",
          completedAt: nowIso(),
          updatedAt: nowIso(),
          errorMessage: undefined
        }));
        drainAria2Queue();
      },
      onError: (error) => {
        activeAria2Downloads.delete(task.id);
        const current = tasks.get(task.id);
        if (current !== undefined) {
          const retryTask = scheduleAria2AutoRetry(current);
          if (retryTask !== null) {
            drainAria2Queue();
            return;
          }
        }
        patchTask(task.id, (currentTask) => ({
          ...currentTask,
          state: "failed",
          backend: "aria2",
          outputKind: "directory",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          canResume: true,
          updatedAt: nowIso(),
          errorMessage: error.message
        }));
        drainAria2Queue();
      },
      onPaused: () => {
        activeAria2Downloads.delete(task.id);
        patchTask(task.id, (current) => ({
          ...current,
          state: "paused",
          backend: "aria2",
          outputKind: "directory",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          canResume: true,
          updatedAt: nowIso()
        }));
        drainAria2Queue();
      },
      onCanceled: () => {
        activeAria2Downloads.delete(task.id);
        patchTask(task.id, (current) => ({
          ...current,
          state: "canceled",
          backend: "aria2",
          outputKind: "directory",
          speedBytesPerSecond: 0,
          estimatedRemainingMs: undefined,
          connectionsActive: 0,
          updatedAt: nowIso(),
          errorMessage: "Download canceled."
        }));
        drainAria2Queue();
      }
    });
    activeAria2Downloads.set(task.id, controller);
    setTask({
      ...task,
      state: "downloading",
      backend: "aria2",
      outputKind: "directory",
      schedulePaused: false,
      connectionsRequested: 1,
      connectionsActive: 1,
      canResume: true,
      startedAt: task.startedAt ?? nowIso(),
      updatedAt: nowIso(),
      errorMessage: undefined
    });
    void controller.start();
  };

  const removeQueuedNativeTask = (taskId: string): void => {
    const index = queuedNativeTaskIds.indexOf(taskId);
    if (index >= 0) {
      queuedNativeTaskIds.splice(index, 1);
    }
    nativeHeadersByTaskId.delete(taskId);
  };

  const drainNativeHttpQueue = (): void => {
    if (isSchedulePauseActive()) {
      return;
    }
    while (activeHttpDownloads.size < MAX_ACTIVE_NATIVE_DOWNLOADS && queuedNativeTaskIds.length > 0) {
      const taskId = sortDownloadQueueTaskIds(queuedNativeTaskIds, tasks)[0];
      if (taskId === undefined) {
        return;
      }
      const task = tasks.get(taskId);
      const headers = nativeHeadersByTaskId.get(taskId);
      removeQueuedNativeTask(taskId);
      if (task === undefined || isNativeHttpDownloadUrl(task.url) === false) {
        continue;
      }
      if (task.state !== "queued" && task.state !== "paused" && task.state !== "failed") {
        continue;
      }
      startNativeHttpDownload(task, headers);
    }
  };

  const queueNativeHttpDownload = (
    task: DownloadManagerTask,
    headers?: Readonly<Record<string, string>>
  ): void => {
    if (queuedNativeTaskIds.includes(task.id) === false && activeHttpDownloads.has(task.id) === false) {
      queuedNativeTaskIds.push(task.id);
    }
    if (headers !== undefined) {
      nativeHeadersByTaskId.set(task.id, headers);
    }
    setTask({
      ...task,
      state: "queued",
      schedulePaused: false,
      connectionsActive: 0,
      speedBytesPerSecond: 0,
      estimatedRemainingMs: undefined,
      canResume: true,
      updatedAt: nowIso(),
      errorMessage: undefined
    });
    drainNativeHttpQueue();
  };

  const removeQueuedCurlTask = (taskId: string): void => {
    const index = queuedCurlTaskIds.indexOf(taskId);
    if (index >= 0) {
      queuedCurlTaskIds.splice(index, 1);
    }
    curlHeadersByTaskId.delete(taskId);
  };

  const drainCurlQueue = (): void => {
    if (isSchedulePauseActive()) {
      return;
    }
    while (queuedCurlTaskIds.length > 0) {
      const taskId = queuedCurlTaskIds.shift();
      if (taskId === undefined) {
        return;
      }
      const task = tasks.get(taskId);
      const headers = curlHeadersByTaskId.get(taskId);
      curlHeadersByTaskId.delete(taskId);
      if (task === undefined || shouldUseCurlBackend(task.url, task) === false) {
        continue;
      }
      if (task.state !== "queued" && task.state !== "paused" && task.state !== "failed") {
        continue;
      }
      startCurlDownload(task, headers);
    }
  };

  const queueCurlDownload = (
    task: DownloadManagerTask,
    headers?: Readonly<Record<string, string>>
  ): void => {
    if (queuedCurlTaskIds.includes(task.id) === false && activeCurlDownloads.has(task.id) === false) {
      queuedCurlTaskIds.push(task.id);
    }
    if (headers !== undefined) {
      curlHeadersByTaskId.set(task.id, headers);
    }
    setTask({
      ...task,
      state: "queued",
      schedulePaused: false,
      connectionsRequested: DEFAULT_CONNECTION_COUNT,
      connectionsActive: 0,
      speedBytesPerSecond: 0,
      estimatedRemainingMs: undefined,
      canResume: true,
      updatedAt: nowIso(),
      errorMessage: undefined
    });
    drainCurlQueue();
  };

  const removeQueuedAria2Task = (taskId: string): void => {
    const index = queuedAria2TaskIds.indexOf(taskId);
    if (index >= 0) {
      queuedAria2TaskIds.splice(index, 1);
    }
    aria2HeadersByTaskId.delete(taskId);
  };

  const drainAria2Queue = (): void => {
    if (isSchedulePauseActive()) {
      return;
    }
    while (queuedAria2TaskIds.length > 0) {
      const taskId = sortDownloadQueueTaskIds(queuedAria2TaskIds, tasks)[0];
      if (taskId === undefined) {
        return;
      }
      const task = tasks.get(taskId);
      const headers = aria2HeadersByTaskId.get(taskId);
      removeQueuedAria2Task(taskId);
      if (task === undefined || shouldUseAria2Backend(task.url) === false) {
        continue;
      }
      if (task.state !== "queued" && task.state !== "paused" && task.state !== "failed") {
        continue;
      }
      startAria2Download(task, headers);
    }
  };

  const queueAria2Download = (
    task: DownloadManagerTask,
    headers?: Readonly<Record<string, string>>
  ): void => {
    if (queuedAria2TaskIds.includes(task.id) === false && activeAria2Downloads.has(task.id) === false) {
      queuedAria2TaskIds.push(task.id);
    }
    if (headers !== undefined) {
      aria2HeadersByTaskId.set(task.id, headers);
    }
    setTask({
      ...task,
      state: "queued",
      backend: "aria2",
      outputKind: "directory",
      schedulePaused: false,
      connectionsRequested: 1,
      connectionsActive: 0,
      speedBytesPerSecond: 0,
      estimatedRemainingMs: undefined,
      canResume: true,
      updatedAt: nowIso(),
      errorMessage: undefined
    });
    drainAria2Queue();
  };

  const queuePendingTask = (url: string, taskId: string): void => {
    const current = pendingTaskIdsByUrl.get(url) ?? [];
    pendingTaskIdsByUrl.set(url, [...current, taskId]);
  };

  const shiftPendingTask = (url: string): string | undefined => {
    const current = pendingTaskIdsByUrl.get(url);
    if (current === undefined || current.length === 0) {
      return undefined;
    }
    const [taskId, ...rest] = current;
    if (rest.length === 0) {
      pendingTaskIdsByUrl.delete(url);
    } else {
      pendingTaskIdsByUrl.set(url, rest);
    }
    return taskId;
  };

  const queueDownloadTaskForBackend = (
    task: DownloadManagerTask,
    headers?: Readonly<Record<string, string>>
  ): void => {
    if (tasks.has(task.id) === false) {
      tasks.set(task.id, task);
    }
    if (shouldUseAria2Backend(task.url)) {
      queueAria2Download(task, headers);
      return;
    }
    if (isNativeHttpDownloadUrl(task.url) && shouldUseCurlBackend(task.url, task) === false) {
      queueNativeHttpDownload(task, headers);
      return;
    }
    if (shouldUseCurlBackend(task.url, task)) {
      queueCurlDownload(task, headers);
      return;
    }
    queuePendingTask(task.url, task.id);
    scheduleSave();
    sendEvent({ kind: "task-updated", task });
    try {
      session.defaultSession.downloadURL(
        task.url,
        headers === undefined ? undefined : { headers: { ...headers } }
      );
    } catch (error) {
      patchTask(task.id, (current) => ({
        ...current,
        state: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
      }));
    }
  };

  const maybeProbeMirrorsAndQueueTask = (
    task: DownloadManagerTask,
    headers?: Readonly<Record<string, string>>
  ): void => {
    const candidates = [
      task.url,
      ...(task.mirrors ?? [])
    ].filter((candidate, index, values) => values.indexOf(candidate) === index);
    if (
      candidates.length <= 1
      || candidates.some((candidate) => isNativeHttpDownloadUrl(candidate)) === false
    ) {
      queueDownloadTaskForBackend(task, headers);
      return;
    }

    tasks.set(task.id, task);
    scheduleSave();
    sendEvent({ kind: "task-updated", task });
    void sortDownloadMirrorsByProbe({
      urls: candidates,
      headers,
      timeoutMs: MIRROR_PROBE_TIMEOUT_MS
    })
      .then((rankedCandidates) => {
        const current = tasks.get(task.id);
        if (current === undefined || current.state !== "queued") {
          return;
        }
        const [selectedUrl, ...rankedMirrors] = rankedCandidates;
        const nextTask = setTask({
          ...current,
          url: selectedUrl ?? current.url,
          mirrors: rankedMirrors,
          activeMirrorIndex: 0,
          updatedAt: nowIso()
        });
        queueDownloadTaskForBackend(nextTask, headers);
      })
      .catch(() => {
        const current = tasks.get(task.id);
        if (current === undefined || current.state !== "queued") {
          return;
        }
        queueDownloadTaskForBackend(current, headers);
      });
  };

  const buildAutoRetryTask = (task: DownloadManagerTask): DownloadManagerTask | null => {
    const retryCount = task.retryCount ?? 0;
    const maxRetries = task.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (retryCount >= maxRetries) {
      return null;
    }
    const candidates = [
      task.url,
      ...(task.mirrors ?? []),
      ...(task.originalUrl === undefined ? [] : [task.originalUrl])
    ].filter((url, index, urls) => urls.indexOf(url) === index);
    const currentMirrorIndex = Math.max(0, candidates.indexOf(task.url));
    const nextMirrorIndex = candidates.length <= 1
      ? 0
      : (currentMirrorIndex + 1) % candidates.length;
    return {
      ...task,
      url: candidates[nextMirrorIndex] ?? task.url,
      state: "queued",
      retryCount: retryCount + 1,
      activeMirrorIndex: nextMirrorIndex,
      receivedBytes: 0,
      speedBytesPerSecond: 0,
      estimatedRemainingMs: undefined,
      connectionsActive: 0,
      canResume: true,
      completedAt: undefined,
      errorMessage: undefined,
      updatedAt: nowIso()
    };
  };

  const scheduleNativeAutoRetry = (
    task: DownloadManagerTask
  ): DownloadManagerTask | null => {
    const nextTask = buildAutoRetryTask(task);
    if (nextTask === null) {
      return null;
    }
    setTask(nextTask);
    setTimeout(() => {
      const current = tasks.get(nextTask.id);
      if (current?.state !== "queued") {
        return;
      }
      if (isNativeHttpDownloadUrl(current.url) && shouldUseCurlBackend(current.url, current) === false) {
        queueNativeHttpDownload(current);
        return;
      }
      if (shouldUseCurlBackend(current.url, current)) {
        queueCurlDownload(current);
      }
    }, nextTask.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    return nextTask;
  };

  const scheduleCurlAutoRetry = (
    task: DownloadManagerTask
  ): DownloadManagerTask | null => {
    const nextTask = buildAutoRetryTask(task);
    if (nextTask === null) {
      return null;
    }
    setTask(nextTask);
    setTimeout(() => {
      const current = tasks.get(nextTask.id);
      if (current?.state !== "queued" || shouldUseCurlBackend(current.url, current) === false) {
        return;
      }
      queueCurlDownload(current);
    }, nextTask.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    return nextTask;
  };

  const scheduleAria2AutoRetry = (
    task: DownloadManagerTask
  ): DownloadManagerTask | null => {
    const nextTask = buildAutoRetryTask(task);
    if (nextTask === null) {
      return null;
    }
    setTask({
      ...nextTask,
      backend: "aria2",
      outputKind: "directory"
    });
    setTimeout(() => {
      const current = tasks.get(nextTask.id);
      if (current?.state !== "queued" || shouldUseAria2Backend(current.url) === false) {
        return;
      }
      queueAria2Download(current);
    }, nextTask.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    return nextTask;
  };

  const enqueueDownload = (
    url: string,
    source: DownloadManagerTaskSource,
    headers?: Readonly<Record<string, string>>,
    checksum?: DownloadManagerChecksum,
    requestOptions?: Pick<
      DownloadManagerEnqueueRequest,
      "bt" | "cookieHeader" | "maxRetries" | "mirrors" | "partialFilePath" | "proxy" | "retryDelayMs"
    >
  ): DownloadManagerTask => {
    const effectiveHeaders = resolveRequestHeaders(headers, requestOptions?.cookieHeader);
    const effectiveProxy = requestOptions?.proxy === undefined
      ? undefined
      : normalizeProxy(requestOptions.proxy);
    const partialFilePath = toOptionalString(requestOptions?.partialFilePath);
    if (partialFilePath !== undefined && isNativeHttpDownloadUrl(url) === false) {
      throw new Error("Partial file resume is supported for HTTP, HTTPS, and WebDAV downloads.");
    }
    const initialFileName = partialFilePath === undefined
      ? fileNameFromUrl(url)
      : resolveBrowserPartialFileName(partialFilePath, fileNameFromUrl(url));
    const saveRule = resolveSaveRuleForDownload(url, initialFileName);
    const saveDirectory = partialFilePath === undefined
      ? saveRule.directory
      : path.dirname(partialFilePath);
    const partialSavePath = partialFilePath !== undefined
      && path.basename(partialFilePath) === initialFileName
      ? partialFilePath
      : undefined;
    const useAria2Backend = shouldUseAria2Backend(url);
    const task = createQueuedTask({
      url,
      fileName: initialFileName,
      savePathOverride: partialSavePath,
      source,
      directory: saveDirectory,
      reservedPaths: getReservedSavePaths(tasks.values()),
      checksum,
      requestHeaders: effectiveHeaders,
      proxy: effectiveProxy,
      maxRetries: requestOptions?.maxRetries,
      retryDelayMs: requestOptions?.retryDelayMs,
      mirrors: normalizeMirrorUrls(requestOptions?.mirrors),
      bt: normalizeBtTaskOptions(requestOptions?.bt),
      backend: partialFilePath === undefined
        ? useAria2Backend ? "aria2" : undefined
        : "curl",
      outputKind: useAria2Backend ? "directory" : "file",
      tags: saveRule.tags
    });
    const useCurlBackend = shouldUseCurlBackend(url, task);
    const queuedTask: DownloadManagerTask = {
      ...task,
      backend: useAria2Backend
        ? "aria2"
        : useCurlBackend
          ? "curl"
          : isNativeHttpDownloadUrl(url)
            ? "native-http"
            : "electron",
      outputKind: useAria2Backend ? "directory" : "file",
      connectionsRequested: useAria2Backend
        ? 1
        : isNativeHttpDownloadUrl(url) && useCurlBackend === false
        ? DEFAULT_NATIVE_HTTP_CONNECTIONS
        : DEFAULT_CONNECTION_COUNT
    };
    materializeBrowserPartialFileForResume(partialFilePath, queuedTask.savePath);
    maybeProbeMirrorsAndQueueTask(queuedTask, effectiveHeaders);
    return queuedTask;
  };

  const handleWillDownload = (
    _event: Electron.Event,
    item: DownloadItem,
    webContents: WebContents | undefined
  ): void => {
    const url = item.getURL();
    const sourceContext = webContents === undefined ? undefined : sourcesByWebContentsId.get(webContents.id);
    const pendingTaskId = shiftPendingTask(url);
    const existingTask = pendingTaskId === undefined ? undefined : tasks.get(pendingTaskId);
    const itemFileName = sanitizeFileName(item.getFilename() || fileNameFromUrl(url));
    const saveRule = resolveSaveRuleForDownload(url, itemFileName);
    const downloadsDirectory = existingTask?.directory ?? saveRule.directory;
    const savePath = existingTask?.savePath
      ?? resolveUniqueSavePath(
        downloadsDirectory,
        itemFileName,
        getReservedSavePaths(tasks.values(), existingTask?.id)
      );
    mkdirSync(path.dirname(savePath), { recursive: true });
    item.setSavePath(savePath);

    const startedAt = item.getStartTime() > 0
      ? new Date(item.getStartTime() * 1000).toISOString()
      : nowIso();
    const task: DownloadManagerTask = {
      ...(existingTask ?? createQueuedTask({
        url,
        source: "browser",
        directory: downloadsDirectory,
        reservedPaths: getReservedSavePaths(tasks.values()),
        headersSource: sourceContext,
        tags: saveRule.tags
      })),
      url,
      finalUrl: item.getURLChain().at(-1) ?? url,
      fileName: path.basename(savePath),
      mimeType: toOptionalString(item.getMimeType()),
      savePath,
      directory: path.dirname(savePath),
      protocol: parseProtocol(url),
      source: existingTask?.source ?? "browser",
      backend: existingTask?.backend ?? "electron",
      outputKind: existingTask?.outputKind ?? "file",
      ...(sourceContext?.tabId === undefined ? {} : { sourceTabId: sourceContext.tabId }),
      ...(sourceContext?.title === undefined ? {} : { sourceTitle: sourceContext.title }),
      state: item.isPaused() ? "paused" : "downloading",
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      speedBytesPerSecond: item.getCurrentBytesPerSecond(),
      estimatedRemainingMs: estimateRemainingMs(
        item.getReceivedBytes(),
        item.getTotalBytes(),
        item.getCurrentBytesPerSecond()
      ),
      connectionsActive: DEFAULT_CONNECTION_COUNT,
      canResume: item.canResume(),
      startedAt,
      updatedAt: nowIso(),
      errorMessage: undefined
    };
    activeItems.set(task.id, item);
    setTask(task);

    item.on("updated", (_updatedEvent, state) => {
      const current = tasks.get(task.id);
      if (current === undefined) {
        return;
      }
      const receivedBytes = item.getReceivedBytes();
      const totalBytes = item.getTotalBytes();
      const speedBytesPerSecond = item.getCurrentBytesPerSecond();
      setTask({
        ...current,
        finalUrl: item.getURLChain().at(-1) ?? current.finalUrl,
        state: state === "interrupted" ? "failed" : item.isPaused() ? "paused" : "downloading",
        receivedBytes,
        totalBytes,
        speedBytesPerSecond,
        estimatedRemainingMs: estimateRemainingMs(receivedBytes, totalBytes, speedBytesPerSecond),
        connectionsActive: state === "interrupted" || item.isPaused() ? 0 : DEFAULT_CONNECTION_COUNT,
        canResume: item.canResume(),
        updatedAt: nowIso(),
        errorMessage: state === "interrupted" ? "Download interrupted." : undefined
      });
    });

    item.once("done", (_doneEvent, state) => {
      activeItems.delete(task.id);
      const current = tasks.get(task.id);
      if (current === undefined) {
        return;
      }
      const nextState = mapDoneState(state);
      setTask({
        ...current,
        finalUrl: item.getURLChain().at(-1) ?? current.finalUrl,
        state: nextState,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        speedBytesPerSecond: 0,
        estimatedRemainingMs: undefined,
        connectionsActive: 0,
        canResume: item.canResume(),
        completedAt: nextState === "completed" ? nowIso() : current.completedAt,
        updatedAt: nowIso(),
        errorMessage:
          nextState === "failed"
            ? "Download interrupted."
            : nextState === "canceled"
              ? "Download canceled."
              : undefined
      });
      if (nextState === "completed") {
        void finalizeCompletedDownload(task.id);
      }
    });
  };

  session.defaultSession.on("will-download", handleWillDownload);

  const pauseTask = (taskId: string): DownloadManagerTask | null => {
    const current = tasks.get(taskId);
    if (
      current === undefined
      || current.state === "completed"
      || current.state === "failed"
      || current.state === "canceled"
    ) {
      return current ?? null;
    }
    removeQueuedNativeTask(taskId);
    removeQueuedCurlTask(taskId);
    removeQueuedAria2Task(taskId);
    const httpDownload = activeHttpDownloads.get(taskId);
    if (httpDownload !== undefined) {
      httpDownload.pause();
      activeHttpDownloads.delete(taskId);
      return tasks.get(taskId) ?? null;
    }
    const curlDownload = activeCurlDownloads.get(taskId);
    if (curlDownload !== undefined) {
      curlDownload.pause();
      activeCurlDownloads.delete(taskId);
      return tasks.get(taskId) ?? null;
    }
    const aria2Download = activeAria2Downloads.get(taskId);
    if (aria2Download !== undefined) {
      aria2Download.pause();
      activeAria2Downloads.delete(taskId);
      return tasks.get(taskId) ?? null;
    }
    const item = activeItems.get(taskId);
    if (item !== undefined && item.isPaused() === false) {
      item.pause();
    }
    return patchTask(taskId, (task) => ({
      ...task,
      state: "paused",
      schedulePaused: false,
      speedBytesPerSecond: 0,
      estimatedRemainingMs: undefined,
      connectionsActive: 0,
      canResume: item?.canResume() ?? task.canResume,
      updatedAt: nowIso()
    }));
  };

  const resumeTask = (taskId: string): DownloadManagerTask | null => {
    const current = tasks.get(taskId);
    if (
      current === undefined
      || current.state === "completed"
      || current.state === "downloading"
      || current.state === "canceled"
    ) {
      return current ?? null;
    }
    const item = activeItems.get(taskId);
    if (item !== undefined && item.isPaused()) {
      item.resume();
    }
    if (item === undefined) {
      const task = tasks.get(taskId);
      if (task !== undefined && shouldUseAria2Backend(task.url)) {
        queueAria2Download(task);
        return tasks.get(taskId) ?? task;
      }
      if (task !== undefined && isNativeHttpDownloadUrl(task.url) && shouldUseCurlBackend(task.url, task) === false) {
        queueNativeHttpDownload(task);
        return tasks.get(taskId) ?? task;
      }
      if (task !== undefined && isCurlDownloadUrl(task.url)) {
        queueCurlDownload(task);
        return tasks.get(taskId) ?? task;
      }
      if (task !== undefined && shouldUseCurlBackend(task.url, task)) {
        queueCurlDownload(task);
        return tasks.get(taskId) ?? task;
      }
    }
    return patchTask(taskId, (task) => ({
      ...task,
      state: item === undefined ? task.state : "downloading",
      schedulePaused: false,
      connectionsActive: item === undefined ? task.connectionsActive : DEFAULT_CONNECTION_COUNT,
      canResume: item?.canResume() ?? task.canResume,
      updatedAt: nowIso()
    }));
  };

  const cancelTask = (taskId: string): DownloadManagerTask | null => {
    const current = tasks.get(taskId);
    if (
      current === undefined
      || current.state === "completed"
      || current.state === "failed"
      || current.state === "canceled"
    ) {
      return current ?? null;
    }
    removeQueuedNativeTask(taskId);
    removeQueuedCurlTask(taskId);
    removeQueuedAria2Task(taskId);
    const httpDownload = activeHttpDownloads.get(taskId);
    if (httpDownload !== undefined) {
      httpDownload.cancel();
      activeHttpDownloads.delete(taskId);
      return tasks.get(taskId) ?? null;
    }
    const curlDownload = activeCurlDownloads.get(taskId);
    if (curlDownload !== undefined) {
      curlDownload.cancel();
      activeCurlDownloads.delete(taskId);
      return tasks.get(taskId) ?? null;
    }
    const aria2Download = activeAria2Downloads.get(taskId);
    if (aria2Download !== undefined) {
      aria2Download.cancel();
      activeAria2Downloads.delete(taskId);
      return tasks.get(taskId) ?? null;
    }
    const item = activeItems.get(taskId);
    if (item !== undefined) {
      item.cancel();
    }
    return patchTask(taskId, (task) => ({
      ...task,
      state: "canceled",
      schedulePaused: false,
      speedBytesPerSecond: 0,
      estimatedRemainingMs: undefined,
      connectionsActive: 0,
      updatedAt: nowIso(),
      errorMessage: "Download canceled."
    }));
  };

  const retryTask = (taskId: string): DownloadManagerTask | null => {
    const task = tasks.get(taskId);
    if (task === undefined) {
      return null;
    }
    if (shouldUseAria2Backend(task.url)) {
      const nextTask = setTask({
        ...task,
        state: "queued",
        backend: "aria2",
        outputKind: "directory",
        receivedBytes: 0,
        retryCount: 0,
        speedBytesPerSecond: 0,
        estimatedRemainingMs: undefined,
        connectionsRequested: 1,
        connectionsActive: 0,
        canResume: true,
        completedAt: undefined,
        errorMessage: undefined,
        updatedAt: nowIso()
      });
      queueAria2Download(nextTask);
      return nextTask;
    }
    if (isNativeHttpDownloadUrl(task.url) && shouldUseCurlBackend(task.url, task) === false) {
      const nextTask = setTask({
        ...task,
        state: "queued",
        receivedBytes: 0,
        retryCount: 0,
        speedBytesPerSecond: 0,
        estimatedRemainingMs: undefined,
        connectionsRequested: Math.max(task.connectionsRequested, DEFAULT_NATIVE_HTTP_CONNECTIONS),
        connectionsActive: 0,
        canResume: true,
        completedAt: undefined,
        errorMessage: undefined,
        updatedAt: nowIso()
      });
      queueNativeHttpDownload(nextTask);
      return nextTask;
    }
    if (shouldUseCurlBackend(task.url, task)) {
      const nextTask = setTask({
        ...task,
        state: "queued",
        receivedBytes: 0,
        retryCount: 0,
        speedBytesPerSecond: 0,
        estimatedRemainingMs: undefined,
        connectionsActive: 0,
        canResume: true,
        completedAt: undefined,
        errorMessage: undefined,
        updatedAt: nowIso()
      });
      queueCurlDownload(nextTask);
      return nextTask;
    }
    queuePendingTask(task.url, task.id);
    const nextTask = setTask({
      ...task,
      state: "queued",
      receivedBytes: 0,
      retryCount: 0,
      speedBytesPerSecond: 0,
      estimatedRemainingMs: undefined,
      connectionsActive: 0,
      canResume: false,
      completedAt: undefined,
      errorMessage: undefined,
      updatedAt: nowIso()
    });
    try {
      session.defaultSession.downloadURL(
        task.url,
        task.requestHeaders === undefined ? undefined : { headers: { ...task.requestHeaders } }
      );
    } catch (error) {
      return patchTask(task.id, (current) => ({
        ...current,
        state: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
      }));
    }
    return nextTask;
  };

  const removeTask = (taskId: string): void => {
    removeQueuedNativeTask(taskId);
    removeQueuedCurlTask(taskId);
    removeQueuedAria2Task(taskId);
    const httpDownload = activeHttpDownloads.get(taskId);
    if (httpDownload !== undefined) {
      httpDownload.cancel();
      activeHttpDownloads.delete(taskId);
    }
    const curlDownload = activeCurlDownloads.get(taskId);
    if (curlDownload !== undefined) {
      curlDownload.cancel();
      activeCurlDownloads.delete(taskId);
    }
    const aria2Download = activeAria2Downloads.get(taskId);
    if (aria2Download !== undefined) {
      aria2Download.cancel();
      activeAria2Downloads.delete(taskId);
    }
    const item = activeItems.get(taskId);
    if (item !== undefined) {
      item.cancel();
      activeItems.delete(taskId);
    }
    tasks.delete(taskId);
    scheduleSave();
    sendEvent({ kind: "task-removed", taskId });
  };

  const setTaskPriority = (
    taskId: string,
    priority: DownloadManagerPriority
  ): DownloadManagerTask | null => {
    const nextTask = patchTask(taskId, (task) => ({
      ...task,
      priority,
      updatedAt: nowIso()
    }));
    drainNativeHttpQueue();
    drainAria2Queue();
    return nextTask;
  };

  const selectBatchTaskIds = (payload: unknown): readonly string[] => {
    const request = normalizeBatchRequest(payload);
    if (request.taskIds !== undefined) {
      return request.taskIds.filter((taskId) => tasks.has(taskId));
    }
    return [...tasks.keys()];
  };

  const pauseAllTasks = (request?: DownloadManagerBatchRequest): DownloadManagerSnapshot => {
    for (const taskId of selectBatchTaskIds(request)) {
      pauseTask(taskId);
    }
    return snapshot();
  };

  const resumeAllTasks = (request?: DownloadManagerBatchRequest): DownloadManagerSnapshot => {
    for (const taskId of selectBatchTaskIds(request)) {
      resumeTask(taskId);
    }
    return snapshot();
  };

  const cancelAllTasks = (request?: DownloadManagerBatchRequest): DownloadManagerSnapshot => {
    for (const taskId of selectBatchTaskIds(request)) {
      cancelTask(taskId);
    }
    return snapshot();
  };

  const pauseRunningTaskForSchedule = (taskId: string): void => {
    const task = tasks.get(taskId);
    if (task === undefined || task.state !== "downloading") {
      return;
    }
    const httpDownload = activeHttpDownloads.get(taskId);
    const curlDownload = activeCurlDownloads.get(taskId);
    const aria2Download = activeAria2Downloads.get(taskId);
    const item = activeItems.get(taskId);
    if (httpDownload !== undefined) {
      httpDownload.pause();
      activeHttpDownloads.delete(taskId);
    } else if (curlDownload !== undefined) {
      curlDownload.pause();
      activeCurlDownloads.delete(taskId);
    } else if (aria2Download !== undefined) {
      aria2Download.pause();
      activeAria2Downloads.delete(taskId);
    } else if (item !== undefined && item.isPaused() === false) {
      item.pause();
    } else {
      return;
    }
    patchTask(taskId, (current) => ({
      ...current,
      state: "paused",
      schedulePaused: true,
      speedBytesPerSecond: 0,
      estimatedRemainingMs: undefined,
      connectionsActive: 0,
      canResume: true,
      updatedAt: nowIso()
    }));
  };

  const applySchedule = (): void => {
    if (isSchedulePauseActive()) {
      for (const task of tasks.values()) {
        pauseRunningTaskForSchedule(task.id);
      }
      return;
    }
    for (const task of tasks.values()) {
      if (task.schedulePaused === true && task.state === "paused") {
        patchTask(task.id, (current) => ({
          ...current,
          schedulePaused: false,
          updatedAt: nowIso()
        }));
        resumeTask(task.id);
      }
    }
    drainNativeHttpQueue();
    drainCurlQueue();
    drainAria2Queue();
  };

  const restorePersistedQueuedTasks = (): void => {
    for (const task of tasks.values()) {
      if (task.state !== "queued") {
        continue;
      }
      if (shouldUseAria2Backend(task.url)) {
        queueAria2Download(task);
        continue;
      }
      if (isNativeHttpDownloadUrl(task.url) && shouldUseCurlBackend(task.url, task) === false) {
        queueNativeHttpDownload(task);
        continue;
      }
      if (shouldUseCurlBackend(task.url, task)) {
        queueCurlDownload(task);
        continue;
      }
      queuePendingTask(task.url, task.id);
      setTask({
        ...task,
        speedBytesPerSecond: 0,
        estimatedRemainingMs: undefined,
        connectionsActive: 0,
        canResume: true,
        updatedAt: nowIso(),
        errorMessage: undefined
      });
      try {
        session.defaultSession.downloadURL(
          task.url,
          task.requestHeaders === undefined ? undefined : { headers: { ...task.requestHeaders } }
        );
      } catch (error) {
        patchTask(task.id, (current) => ({
          ...current,
          state: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: nowIso()
        }));
      }
    }
  };

  const enqueueImportRequest = (request: DownloadManagerEnqueueRequest): void => {
    const items = parseDownloadImportItems(request);
    if (toOptionalString(request.partialFilePath) !== undefined && items.length !== 1) {
      throw new Error("Partial file resume can only be used with one URL.");
    }
    for (const item of items) {
      enqueueDownload(
        item.url,
        "manual",
        request.headers,
        item.checksum ?? request.checksum,
        {
          ...request,
          mirrors: item.mirrors ?? request.mirrors
        }
      );
    }
  };

  const importExternalBrowserDownloads = async (): Promise<DownloadManagerSnapshot> => {
    const candidates = await scanExternalBrowserDownloads({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      cwd: process.cwd()
    });
    const seen = new Set<string>();
    const errors: string[] = [];
    let importedCount = 0;
    for (const candidate of candidates) {
      const partialFilePath = toOptionalString(candidate.partialFilePath);
      const key = `${candidate.url}\n${partialFilePath ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      try {
        enqueueDownload(
          candidate.url,
          "browser",
          candidate.referrer === undefined ? undefined : { Referer: candidate.referrer },
          undefined,
          {
            partialFilePath,
            maxRetries: DEFAULT_MAX_RETRIES,
            retryDelayMs: DEFAULT_RETRY_DELAY_MS
          }
        );
        importedCount += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (importedCount === 0) {
      throw new Error(
        errors[0] ?? "No resumable Chrome, Edge, Brave, Chromium, or Firefox downloads were found."
      );
    }
    return snapshot();
  };

  scheduleTimer = setInterval(applySchedule, 60_000);
  startupRestoreTimer = setTimeout(() => {
    startupRestoreTimer = null;
    restorePersistedQueuedTasks();
    applySchedule();
  }, 0);

  const remoteApi = createDownloadManagerRemoteApi({
    storageRoot,
    handlers: {
      readSnapshot: snapshot,
      enqueue: (request) => {
        enqueueImportRequest(request);
        return snapshot();
      },
      pauseTask,
      resumeTask,
      cancelTask,
      retryTask,
      removeTask,
      setTaskPriority,
      pauseAll: pauseAllTasks,
      resumeAll: resumeAllTasks,
      cancelAll: cancelAllTasks,
      readSettings: () => settings,
      updateSettings: setSettings
    }
  });

  const handlers: Array<readonly [string, (_event: Electron.IpcMainInvokeEvent, payload?: unknown) => unknown]> = [
    [
      LYRA_CHANNELS.downloadsList,
      () => snapshot()
    ],
    [
      LYRA_CHANNELS.downloadsEnqueue,
      (_event, payload) => {
        const request = payload as DownloadManagerEnqueueRequest;
        enqueueImportRequest(request);
        return snapshot();
      }
    ],
    [
      LYRA_CHANNELS.downloadsImportExternalBrowser,
      async () => importExternalBrowserDownloads()
    ],
    [
      LYRA_CHANNELS.downloadsPause,
      (_event, payload) => {
        const { taskId } = normalizeTaskRequest(payload as DownloadManagerTaskRequest);
        return pauseTask(taskId);
      }
    ],
    [
      LYRA_CHANNELS.downloadsResume,
      (_event, payload) => {
        const { taskId } = normalizeTaskRequest(payload as DownloadManagerTaskRequest);
        return resumeTask(taskId);
      }
    ],
    [
      LYRA_CHANNELS.downloadsCancel,
      (_event, payload) => {
        const { taskId } = normalizeTaskRequest(payload as DownloadManagerTaskRequest);
        return cancelTask(taskId);
      }
    ],
    [
      LYRA_CHANNELS.downloadsRetry,
      (_event, payload) => {
        const { taskId } = normalizeTaskRequest(payload as DownloadManagerTaskRequest);
        return retryTask(taskId);
      }
    ],
    [
      LYRA_CHANNELS.downloadsRemove,
      (_event, payload) => {
        const { taskId } = normalizeTaskRequest(payload as DownloadManagerTaskRequest);
        removeTask(taskId);
      }
    ],
    [
      LYRA_CHANNELS.downloadsSetPriority,
      (_event, payload) => {
        const { taskId, priority } = normalizeSetPriorityRequest(payload as DownloadManagerSetPriorityRequest);
        return setTaskPriority(taskId, priority);
      }
    ],
    [
      LYRA_CHANNELS.downloadsPauseAll,
      (_event, payload) => {
        return pauseAllTasks(normalizeBatchRequest(payload));
      }
    ],
    [
      LYRA_CHANNELS.downloadsResumeAll,
      (_event, payload) => {
        return resumeAllTasks(normalizeBatchRequest(payload));
      }
    ],
    [
      LYRA_CHANNELS.downloadsCancelAll,
      (_event, payload) => {
        return cancelAllTasks(normalizeBatchRequest(payload));
      }
    ],
    [
      LYRA_CHANNELS.downloadsReadSettings,
      () => settings
    ],
    [
      LYRA_CHANNELS.downloadsUpdateSettings,
      (_event, payload) => setSettings(payload as DownloadManagerUpdateSettingsRequest)
    ],
    [
      LYRA_CHANNELS.downloadsRemoteStatus,
      () => remoteApi.readStatus()
    ],
    [
      LYRA_CHANNELS.downloadsRemoteStart,
      async (_event, payload) =>
        remoteApi.start(payload as DownloadManagerRemoteApiStartRequest | undefined)
    ],
    [
      LYRA_CHANNELS.downloadsRemoteStop,
      async () => remoteApi.stop()
    ],
    [
      LYRA_CHANNELS.downloadsOpenFile,
      async (_event, payload) => {
        const { taskId } = normalizeTaskRequest(payload as DownloadManagerTaskRequest);
        const task = tasks.get(taskId);
        if (task === undefined || task.state !== "completed") {
          return false;
        }
        const error = await shell.openPath(task.savePath);
        return error.length === 0;
      }
    ],
    [
      LYRA_CHANNELS.downloadsRevealFile,
      (_event, payload) => {
        const { taskId } = normalizeTaskRequest(payload as DownloadManagerTaskRequest);
        const task = tasks.get(taskId);
        if (task === undefined) {
          return false;
        }
        shell.showItemInFolder(task.savePath);
        return true;
      }
    ]
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    readSnapshot: snapshot,
    attachWebContents: (tabId, webContents) => {
      const readContext = (): DownloadSourceContext => ({
        tabId,
        title: toOptionalString(webContents.getTitle()),
        url: toOptionalString(webContents.getURL())
      });
      sourcesByWebContentsId.set(webContents.id, readContext());
      const updateContext = (): void => {
        if (webContents.isDestroyed()) {
          return;
        }
        sourcesByWebContentsId.set(webContents.id, readContext());
      };
      const cleanup = (): void => {
        sourcesByWebContentsId.delete(webContents.id);
      };
      webContents.on("page-title-updated", updateContext);
      webContents.on("did-navigate", updateContext);
      webContents.on("did-navigate-in-page", updateContext);
      webContents.once("destroyed", cleanup);
      return () => {
        webContents.off("page-title-updated", updateContext);
        webContents.off("did-navigate", updateContext);
        webContents.off("did-navigate-in-page", updateContext);
        cleanup();
      };
    },
    dispose: () => {
      session.defaultSession.off("will-download", handleWillDownload);
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      remoteApi.dispose();
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      try {
        flushTasks();
      } catch (error) {
        console.warn(`[lyra-downloads] failed to flush tasks: ${String(error)}`);
      }
      activeItems.clear();
      for (const controller of activeHttpDownloads.values()) {
        controller.pause();
      }
      activeHttpDownloads.clear();
      for (const controller of activeCurlDownloads.values()) {
        controller.pause();
      }
      activeCurlDownloads.clear();
      for (const controller of activeAria2Downloads.values()) {
        controller.pause();
      }
      activeAria2Downloads.clear();
      queuedNativeTaskIds.splice(0);
      nativeHeadersByTaskId.clear();
      queuedCurlTaskIds.splice(0);
      curlHeadersByTaskId.clear();
      queuedAria2TaskIds.splice(0);
      aria2HeadersByTaskId.clear();
      pendingTaskIdsByUrl.clear();
      sourcesByWebContentsId.clear();
      if (scheduleTimer !== null) {
        clearInterval(scheduleTimer);
        scheduleTimer = null;
      }
      if (startupRestoreTimer !== null) {
        clearTimeout(startupRestoreTimer);
        startupRestoreTimer = null;
      }
    }
  };
};
