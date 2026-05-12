import {
  ipcMain,
  session,
  shell,
  type BrowserWindow,
  type DownloadItem,
  type WebContents
} from "electron";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type {
  DownloadManagerBatchRequest,
  DownloadManagerEnqueueRequest,
  DownloadManagerEvent,
  DownloadManagerRemoteApiStartRequest,
  DownloadManagerRemoteApiStatus,
  DownloadManagerSetPriorityRequest,
  DownloadManagerSettings,
  DownloadManagerSnapshot,
  DownloadManagerTask,
  DownloadManagerTaskRequest,
  DownloadManagerUpdateSettingsRequest
} from "../../shared/download-manager";
import type { LyraRuntimeClient } from "../runtime-client";
import {
  collectBrowserDownloadHeaders,
  shouldHandoffBrowserDownload
} from "./browser-handoff";

type DownloadSourceContext = {
  readonly tabId: string;
  readonly title?: string | undefined;
  readonly url?: string | undefined;
};

export type DownloadManagerIpcBridge = {
  readonly dispose: () => void;
  readonly attachWebContents: (tabId: string, webContents: WebContents) => () => void;
  readonly readSnapshot: () => DownloadManagerSnapshot;
};

const DOWNLOAD_RUNTIME_EVENT_NAME = "download.runtime";

const EMPTY_SNAPSHOT: DownloadManagerSnapshot = { tasks: [] };

const toOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const normalizeTaskRequest = (payload: DownloadManagerTaskRequest): DownloadManagerTaskRequest => {
  const taskId = payload.taskId.trim();
  if (taskId.length === 0) {
    throw new Error("taskId is required");
  }
  return { taskId };
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

const isDownloadPriority = (value: unknown): value is DownloadManagerTask["priority"] =>
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

export const parseDownloadUrls = (input: {
  readonly text?: string | undefined;
  readonly urls?: readonly string[] | undefined;
}): readonly string[] => {
  const candidates = [
    ...(input.urls ?? []),
    ...(typeof input.text === "string" ? [input.text] : [])
  ];
  const urls = new Set<string>();
  for (const candidate of candidates) {
    for (const part of candidate.split(/[\s"'<>]+/u)) {
      const trimmed = part.trim().replace(/[;,]+$/u, "");
      if (/^(https?|ftps?|sftp|webdavs?):\/\/\S+$/iu.test(trimmed) || /^magnet:\S+$/iu.test(trimmed)) {
        urls.add(trimmed);
      }
    }
  }
  return [...urls];
};

export const createDownloadManagerIpcBridge = ({
  storageRoot,
  runtimeClient,
  getWindow
}: {
  readonly storageRoot: string;
  readonly runtimeClient: LyraRuntimeClient;
  readonly getWindow: () => BrowserWindow | null;
}): DownloadManagerIpcBridge => {
  const sourcesByWebContentsId = new Map<number, DownloadSourceContext>();
  let cachedSnapshot: DownloadManagerSnapshot = EMPTY_SNAPSHOT;
  let disposed = false;

  const withStorageRoot = <T extends object>(payload: T): T & { readonly storageRoot: string } => ({
    ...payload,
    storageRoot
  });

  const requestRuntime = async <T>(method: string, payload: object = {}): Promise<T> =>
    runtimeClient.request<T>(method, withStorageRoot(payload));

  const refreshSnapshot = async (): Promise<DownloadManagerSnapshot> => {
    const snapshot = await requestRuntime<DownloadManagerSnapshot>("download.list");
    cachedSnapshot = snapshot;
    return snapshot;
  };

  const taskFromCache = (taskId: string): DownloadManagerTask | null =>
    cachedSnapshot.tasks.find((task) => task.id === taskId) ?? null;

  const publishEvent = (event: DownloadManagerEvent): void => {
    if (event.kind === "snapshot") {
      cachedSnapshot = event.snapshot;
    }
    if (event.kind === "task-updated") {
      const otherTasks = cachedSnapshot.tasks.filter((task) => task.id !== event.task.id);
      cachedSnapshot = { tasks: [...otherTasks, event.task] };
    }
    if (event.kind === "task-removed") {
      cachedSnapshot = {
        tasks: cachedSnapshot.tasks.filter((task) => task.id !== event.taskId)
      };
    }

    const window = getWindow();
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.downloadsEvent, event);
  };

  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== DOWNLOAD_RUNTIME_EVENT_NAME) {
      return;
    }
    publishEvent(payload as DownloadManagerEvent);
  });

  void refreshSnapshot().catch((error) => {
    console.warn(`[lyra-downloads] failed to read initial runtime snapshot: ${String(error)}`);
  });

  const enqueueBrowserDownload = async (
    url: string,
    webContents: WebContents | undefined,
    headers: Readonly<Record<string, string>>
  ): Promise<void> => {
    const sourceContext = webContents === undefined
      ? undefined
      : sourcesByWebContentsId.get(webContents.id);
    await requestRuntime<DownloadManagerSnapshot>("download.enqueue", {
      urls: [url],
      source: "browser",
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
      ...(sourceContext?.tabId === undefined ? {} : { sourceTabId: sourceContext.tabId }),
      ...(sourceContext?.title === undefined ? {} : { sourceTitle: sourceContext.title })
    });
    await refreshSnapshot();
  };

  const handleWillDownload = (
    _event: Electron.Event,
    item: DownloadItem,
    webContents: WebContents | undefined
  ): void => {
    const url = item.getURL();
    if (shouldHandoffBrowserDownload(url) === false) {
      return;
    }

    try {
      item.cancel();
    } catch {
      return;
    }

    const headerSession = webContents === undefined
      ? session.defaultSession
      : webContents.session ?? session.defaultSession;
    const referrerHint = webContents === undefined
      ? undefined
      : (() => {
          try {
            return webContents.getURL();
          } catch {
            return undefined;
          }
        })();
    const userAgentHint = (() => {
      try {
        return headerSession.getUserAgent();
      } catch {
        return undefined;
      }
    })();

    void (async () => {
      let collectedHeaders: Readonly<Record<string, string>> = {};
      try {
        collectedHeaders = await collectBrowserDownloadHeaders({
          session: headerSession,
          url,
          referrerHint,
          userAgentHint
        });
      } catch {
        collectedHeaders = {};
      }

      try {
        await enqueueBrowserDownload(url, webContents, collectedHeaders);
      } catch (error) {
        console.warn(`[lyra-downloads] failed to hand off browser download: ${String(error)}`);
      }
    })();
  };

  session.defaultSession.on("will-download", handleWillDownload);

  const handlers: Array<readonly [string, (_event: Electron.IpcMainInvokeEvent, payload?: unknown) => unknown]> = [
    [
      LYRA_CHANNELS.downloadsList,
      async () => refreshSnapshot()
    ],
    [
      LYRA_CHANNELS.downloadsEnqueue,
      async (_event, payload) => {
        const snapshot = await requestRuntime<DownloadManagerSnapshot>(
          "download.enqueue",
          payload as DownloadManagerEnqueueRequest
        );
        cachedSnapshot = snapshot;
        return snapshot;
      }
    ],
    [
      LYRA_CHANNELS.downloadsImportExternalBrowser,
      async () => {
        const snapshot = await requestRuntime<DownloadManagerSnapshot>("download.import_external_browser");
        cachedSnapshot = snapshot;
        return snapshot;
      }
    ],
    [
      LYRA_CHANNELS.downloadsPause,
      async (_event, payload) =>
        requestRuntime<DownloadManagerTask | null>("download.pause", normalizeTaskRequest(payload as DownloadManagerTaskRequest))
    ],
    [
      LYRA_CHANNELS.downloadsResume,
      async (_event, payload) =>
        requestRuntime<DownloadManagerTask | null>("download.resume", normalizeTaskRequest(payload as DownloadManagerTaskRequest))
    ],
    [
      LYRA_CHANNELS.downloadsCancel,
      async (_event, payload) =>
        requestRuntime<DownloadManagerTask | null>("download.cancel", normalizeTaskRequest(payload as DownloadManagerTaskRequest))
    ],
    [
      LYRA_CHANNELS.downloadsRetry,
      async (_event, payload) =>
        requestRuntime<DownloadManagerTask | null>("download.retry", normalizeTaskRequest(payload as DownloadManagerTaskRequest))
    ],
    [
      LYRA_CHANNELS.downloadsRemove,
      async (_event, payload) => {
        await requestRuntime<void>("download.remove", normalizeTaskRequest(payload as DownloadManagerTaskRequest));
      }
    ],
    [
      LYRA_CHANNELS.downloadsSetPriority,
      async (_event, payload) =>
        requestRuntime<DownloadManagerTask | null>(
          "download.set_priority",
          normalizeSetPriorityRequest(payload as DownloadManagerSetPriorityRequest)
        )
    ],
    [
      LYRA_CHANNELS.downloadsPauseAll,
      async (_event, payload) =>
        requestRuntime<DownloadManagerSnapshot>("download.pause_all", normalizeBatchRequest(payload))
    ],
    [
      LYRA_CHANNELS.downloadsResumeAll,
      async (_event, payload) =>
        requestRuntime<DownloadManagerSnapshot>("download.resume_all", normalizeBatchRequest(payload))
    ],
    [
      LYRA_CHANNELS.downloadsCancelAll,
      async (_event, payload) =>
        requestRuntime<DownloadManagerSnapshot>("download.cancel_all", normalizeBatchRequest(payload))
    ],
    [
      LYRA_CHANNELS.downloadsReadSettings,
      async () => requestRuntime<DownloadManagerSettings>("download.settings.read")
    ],
    [
      LYRA_CHANNELS.downloadsUpdateSettings,
      async (_event, payload) =>
        requestRuntime<DownloadManagerSettings>(
          "download.settings.update",
          payload as DownloadManagerUpdateSettingsRequest
        )
    ],
    [
      LYRA_CHANNELS.downloadsRemoteStatus,
      async () => requestRuntime<DownloadManagerRemoteApiStatus>("download.remote.status")
    ],
    [
      LYRA_CHANNELS.downloadsRemoteStart,
      async (_event, payload) =>
        requestRuntime<DownloadManagerRemoteApiStatus>(
          "download.remote.start",
          payload as DownloadManagerRemoteApiStartRequest | undefined ?? {}
        )
    ],
    [
      LYRA_CHANNELS.downloadsRemoteStop,
      async () => requestRuntime<DownloadManagerRemoteApiStatus>("download.remote.stop")
    ],
    [
      LYRA_CHANNELS.downloadsOpenFile,
      async (_event, payload) => {
        const { taskId } = normalizeTaskRequest(payload as DownloadManagerTaskRequest);
        const task = taskFromCache(taskId) ?? (await refreshSnapshot()).tasks.find((entry) => entry.id === taskId);
        if (task === undefined || task.state !== "completed") {
          return false;
        }
        const error = await shell.openPath(task.savePath);
        return error.length === 0;
      }
    ],
    [
      LYRA_CHANNELS.downloadsRevealFile,
      async (_event, payload) => {
        const { taskId } = normalizeTaskRequest(payload as DownloadManagerTaskRequest);
        const task = taskFromCache(taskId) ?? (await refreshSnapshot()).tasks.find((entry) => entry.id === taskId);
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
    readSnapshot: () => cachedSnapshot,
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
      if (disposed) {
        return;
      }
      disposed = true;
      session.defaultSession.off("will-download", handleWillDownload);
      unsubscribeRuntimeEvents();
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      sourcesByWebContentsId.clear();
    }
  };
};
