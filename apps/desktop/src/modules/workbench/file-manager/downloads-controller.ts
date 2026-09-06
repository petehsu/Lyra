import {
  useCallback,
  useEffect,
  type MutableRefObject
} from "react";

import type {
  DownloadManagerPriority,
  DownloadManagerTask
} from "../../../shared/download-manager";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { FileManagerSurfaceLabels } from "./types";
import { buildDownloadsState } from "./state-model";
import type { FileManagerStateStore } from "./state-store";

export type FileManagerDownloadRefs = {
  readonly tasksRef: MutableRefObject<readonly DownloadManagerTask[]>;
  readonly statusRef: MutableRefObject<"idle" | "loading" | "ready" | "error">;
  readonly errorMessageRef: MutableRefObject<string | undefined>;
};

export type FileManagerDownloadsController = {
  readonly loadDownloads: (instanceId: string, addToHistory?: boolean) => Promise<void>;
  readonly updateDownloadUrlDraft: (instanceId: string, value: string) => void;
  readonly submitDownloadUrlDraft: (instanceId: string) => Promise<void>;
  readonly submitDownloadText: (instanceId: string, text: string) => Promise<void>;
  readonly openDownloadSettings: () => void;
  readonly pauseDownload: (taskId: string) => Promise<void>;
  readonly resumeDownload: (taskId: string) => Promise<void>;
  readonly cancelDownload: (taskId: string) => Promise<void>;
  readonly retryDownload: (taskId: string) => Promise<void>;
  readonly removeDownload: (taskId: string) => Promise<void>;
  readonly setDownloadPriority: (taskId: string, priority: DownloadManagerPriority) => Promise<void>;
  readonly pauseAllDownloads: () => Promise<void>;
  readonly resumeAllDownloads: () => Promise<void>;
  readonly cancelAllDownloads: () => Promise<void>;
  readonly openDownloadedFile: (taskId: string) => Promise<void>;
  readonly revealDownloadedFile: (taskId: string) => Promise<void>;
};

export const useFileManagerDownloadsController = ({
  desktopApi,
  labels,
  store,
  refs,
  openDownloadSettings,
  unsubscribeDirectoryForInstance
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: FileManagerSurfaceLabels;
  readonly store: FileManagerStateStore;
  readonly refs: FileManagerDownloadRefs;
  readonly openDownloadSettings: () => void;
  readonly unsubscribeDirectoryForInstance: (instanceId: string) => void;
}): FileManagerDownloadsController => {
  const {
    statesRef,
    createState,
    updateStates,
    patchState,
    replaceState
  } = store;
  const {
    tasksRef: downloadTasksRef,
    statusRef: downloadStatusRef,
    errorMessageRef: downloadErrorMessageRef
  } = refs;

  const applyDownloadState = useCallback((
    tasks: readonly DownloadManagerTask[],
    status: "idle" | "loading" | "ready" | "error",
    errorMessage: string | undefined
  ) => {
    downloadTasksRef.current = tasks;
    downloadStatusRef.current = status;
    downloadErrorMessageRef.current = errorMessage;
    updateStates((current) => Object.fromEntries(
      Object.entries(current).map(([instanceId, state]) => [
        instanceId,
        {
          ...state,
          downloadTasks: tasks,
          downloadStatus: status,
          downloadErrorMessage: errorMessage
        }
      ])
    ));
  }, [downloadErrorMessageRef, downloadStatusRef, downloadTasksRef, updateStates]);

  useEffect(() => {
    const downloadsApi = desktopApi?.downloads;
    if (downloadsApi === undefined) {
      applyDownloadState(downloadTasksRef.current, "error", labels.unavailable);
      return undefined;
    }

    let disposed = false;
    applyDownloadState(downloadTasksRef.current, "loading", undefined);
    downloadsApi
      .list()
      .then((snapshot) => {
        if (disposed) {
          return;
        }
        applyDownloadState(snapshot.tasks, "ready", undefined);
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        applyDownloadState(downloadTasksRef.current, "error", message);
      });

    const unsubscribe = downloadsApi.onEvent((event) => {
      if (event.kind === "snapshot") {
        applyDownloadState(event.snapshot.tasks, "ready", undefined);
        return;
      }
      if (event.kind === "task-updated") {
        const nextTasks = [
          event.task,
          ...downloadTasksRef.current.filter((task) => task.id !== event.task.id)
        ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        applyDownloadState(nextTasks, "ready", undefined);
        return;
      }
      const nextTasks = downloadTasksRef.current.filter((task) => task.id !== event.taskId);
      applyDownloadState(nextTasks, "ready", undefined);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [applyDownloadState, desktopApi, downloadTasksRef, labels.unavailable]);

  const loadDownloads = useCallback(async (instanceId: string, addToHistory = true) => {
    unsubscribeDirectoryForInstance(instanceId);
    patchState(instanceId, (state) => ({ ...state, downloadStatus: "loading", downloadErrorMessage: undefined }));
    try {
      const downloadsApi = desktopApi?.downloads;
      const snapshot = downloadsApi === undefined ? undefined : await downloadsApi.list();
      const current = statesRef.current[instanceId] ?? createState(instanceId);
      const nextTasks = snapshot?.tasks ?? downloadTasksRef.current;
      downloadTasksRef.current = nextTasks;
      downloadStatusRef.current = snapshot === undefined ? "error" : "ready";
      downloadErrorMessageRef.current = snapshot === undefined ? labels.unavailable : undefined;
      replaceState(instanceId, {
        ...buildDownloadsState(current, labels, addToHistory),
        downloadTasks: nextTasks,
        downloadStatus: snapshot === undefined ? "error" : "ready",
        downloadErrorMessage: snapshot === undefined ? labels.unavailable : undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      downloadStatusRef.current = "error";
      downloadErrorMessageRef.current = message;
      patchState(instanceId, (state) => ({
        ...buildDownloadsState(state, labels, addToHistory),
        downloadStatus: "error",
        downloadErrorMessage: message
      }));
    }
  }, [
    createState,
    desktopApi,
    downloadErrorMessageRef,
    downloadStatusRef,
    downloadTasksRef,
    labels,
    patchState,
    replaceState,
    statesRef,
    unsubscribeDirectoryForInstance
  ]);

  const updateDownloadUrlDraft = useCallback((instanceId: string, value: string) => {
    patchState(instanceId, (state) => ({
      ...state,
      downloadUrlDraft: value
    }));
  }, [patchState]);

  const submitDownloadText = useCallback(async (instanceId: string, rawText: string) => {
    const text = rawText.trim();
    if (text.length === 0 || desktopApi?.downloads === undefined) {
      return;
    }
    patchState(instanceId, (current) => ({
      ...current,
      downloadStatus: "loading",
      downloadErrorMessage: undefined
    }));
    try {
      const snapshot = await desktopApi.downloads.enqueue({ text });
      applyDownloadState(snapshot.tasks, "ready", undefined);
      patchState(instanceId, (current) => ({
        ...current,
        downloadUrlDraft: ""
      }));
    } catch (error) {
      applyDownloadState(
        downloadTasksRef.current,
        "error",
        error instanceof Error ? error.message : String(error)
      );
    }
  }, [applyDownloadState, desktopApi, downloadTasksRef, patchState]);

  const submitDownloadUrlDraft = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    await submitDownloadText(instanceId, state?.downloadUrlDraft ?? "");
  }, [statesRef, submitDownloadText]);

  const pauseDownload = useCallback(async (taskId: string) => {
    await desktopApi?.downloads?.pause({ taskId });
  }, [desktopApi]);

  const resumeDownload = useCallback(async (taskId: string) => {
    await desktopApi?.downloads?.resume({ taskId });
  }, [desktopApi]);

  const cancelDownload = useCallback(async (taskId: string) => {
    await desktopApi?.downloads?.cancel({ taskId });
  }, [desktopApi]);

  const retryDownload = useCallback(async (taskId: string) => {
    await desktopApi?.downloads?.retry({ taskId });
  }, [desktopApi]);

  const removeDownload = useCallback(async (taskId: string) => {
    await desktopApi?.downloads?.remove({ taskId });
  }, [desktopApi]);

  const setDownloadPriority = useCallback(async (
    taskId: string,
    priority: DownloadManagerPriority
  ) => {
    await desktopApi?.downloads?.setPriority({ taskId, priority });
  }, [desktopApi]);

  const pauseAllDownloads = useCallback(async () => {
    const snapshot = await desktopApi?.downloads?.pauseAll();
    if (snapshot !== undefined) {
      applyDownloadState(snapshot.tasks, "ready", undefined);
    }
  }, [applyDownloadState, desktopApi]);

  const resumeAllDownloads = useCallback(async () => {
    const snapshot = await desktopApi?.downloads?.resumeAll();
    if (snapshot !== undefined) {
      applyDownloadState(snapshot.tasks, "ready", undefined);
    }
  }, [applyDownloadState, desktopApi]);

  const cancelAllDownloads = useCallback(async () => {
    const snapshot = await desktopApi?.downloads?.cancelAll();
    if (snapshot !== undefined) {
      applyDownloadState(snapshot.tasks, "ready", undefined);
    }
  }, [applyDownloadState, desktopApi]);

  const openDownloadedFile = useCallback(async (taskId: string) => {
    await desktopApi?.downloads?.openFile({ taskId });
  }, [desktopApi]);

  const revealDownloadedFile = useCallback(async (taskId: string) => {
    await desktopApi?.downloads?.revealFile({ taskId });
  }, [desktopApi]);

  return {
    loadDownloads,
    updateDownloadUrlDraft,
    submitDownloadUrlDraft,
    submitDownloadText,
    openDownloadSettings,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    removeDownload,
    setDownloadPriority,
    pauseAllDownloads,
    resumeAllDownloads,
    cancelAllDownloads,
    openDownloadedFile,
    revealDownloadedFile
  };
};