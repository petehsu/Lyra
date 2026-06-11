import {
  useCallback,
  useEffect,
  type MutableRefObject
} from "react";

import type {
  DownloadManagerPriority,
  DownloadManagerRemoteApiStatus,
  DownloadManagerSettings,
  DownloadManagerTask
} from "../../../shared/download-manager";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  FileManagerDownloadAdvancedDraft,
  FileManagerDownloadSaveRuleDraft,
  FileManagerDownloadSettingsDraft,
  FileManagerSurfaceLabels
} from "./types";
import {
  buildDownloadEnqueueRequest,
  buildDownloadSettingsUpdate,
  createDownloadSaveRuleDraft,
  createDownloadSettingsDraft
} from "./download-drafts";
import { buildDownloadsState } from "./state-model";
import type { FileManagerStateStore } from "./state-store";

export type FileManagerDownloadRefs = {
  readonly tasksRef: MutableRefObject<readonly DownloadManagerTask[]>;
  readonly statusRef: MutableRefObject<"idle" | "loading" | "ready" | "error">;
  readonly errorMessageRef: MutableRefObject<string | undefined>;
  readonly settingsRef: MutableRefObject<DownloadManagerSettings | null>;
  readonly remoteApiStatusRef: MutableRefObject<DownloadManagerRemoteApiStatus | null>;
};

export type FileManagerDownloadsController = {
  readonly loadDownloads: (instanceId: string, addToHistory?: boolean) => Promise<void>;
  readonly updateDownloadUrlDraft: (instanceId: string, value: string) => void;
  readonly toggleDownloadAdvancedOptions: (instanceId: string) => void;
  readonly updateDownloadAdvancedDraft: (
    instanceId: string,
    patch: Partial<FileManagerDownloadAdvancedDraft>
  ) => void;
  readonly submitDownloadUrlDraft: (instanceId: string) => Promise<void>;
  readonly submitDownloadText: (instanceId: string, text: string) => Promise<void>;
  readonly importExternalBrowserDownloads: (instanceId: string) => Promise<void>;
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
  readonly toggleDownloadSettings: (instanceId: string) => Promise<void>;
  readonly updateDownloadSettingsDraft: (
    instanceId: string,
    patch: Partial<FileManagerDownloadSettingsDraft>
  ) => void;
  readonly addDownloadSaveRuleDraft: (instanceId: string) => void;
  readonly removeDownloadSaveRuleDraft: (instanceId: string, ruleId: string) => void;
  readonly updateDownloadSaveRuleDraft: (
    instanceId: string,
    ruleId: string,
    patch: Partial<FileManagerDownloadSaveRuleDraft>
  ) => void;
  readonly saveDownloadSettings: (instanceId: string) => Promise<void>;
  readonly startDownloadRemoteApi: (instanceId: string) => Promise<void>;
  readonly stopDownloadRemoteApi: (instanceId: string) => Promise<void>;
};

const parseRemoteApiPort = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const port = Number(trimmed);
  if (Number.isInteger(port) === false || port < 0 || port > 65_535) {
    throw new Error("Remote API port must be between 0 and 65535.");
  }
  return port;
};

export const useFileManagerDownloadsController = ({
  desktopApi,
  labels,
  store,
  refs,
  unsubscribeDirectoryForInstance
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: FileManagerSurfaceLabels;
  readonly store: FileManagerStateStore;
  readonly refs: FileManagerDownloadRefs;
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
    errorMessageRef: downloadErrorMessageRef,
    settingsRef: downloadSettingsRef,
    remoteApiStatusRef: downloadRemoteApiStatusRef
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

  const applyDownloadConfiguration = useCallback((
    settings: DownloadManagerSettings | null,
    remoteApiStatus: DownloadManagerRemoteApiStatus | null,
    errorMessage: string | undefined
  ) => {
    downloadSettingsRef.current = settings;
    downloadRemoteApiStatusRef.current = remoteApiStatus;
    updateStates((current) => Object.fromEntries(
      Object.entries(current).map(([instanceId, state]) => {
        const nextDraft = createDownloadSettingsDraft(settings, remoteApiStatus);
        return [
          instanceId,
          {
            ...state,
            downloadSettings: settings,
            downloadRemoteApiStatus: remoteApiStatus,
            downloadSettingsDraft: state.downloadSettingsOpen
              ? state.downloadSettingsDraft
              : nextDraft,
            downloadSettingsErrorMessage: errorMessage
          }
        ];
      })
    ));
  }, [downloadRemoteApiStatusRef, downloadSettingsRef, updateStates]);

  useEffect(() => {
    const downloadsApi = desktopApi?.downloads;
    if (downloadsApi === undefined) {
      applyDownloadState(downloadTasksRef.current, "error", labels.unavailable);
      applyDownloadConfiguration(
        downloadSettingsRef.current,
        downloadRemoteApiStatusRef.current,
        labels.unavailable
      );
      return undefined;
    }

    let disposed = false;
    applyDownloadState(downloadTasksRef.current, "loading", undefined);
    void Promise.all([
      downloadsApi.list(),
      downloadsApi.readSettings(),
      downloadsApi.readRemoteApiStatus()
    ])
      .then(([snapshot, settings, remoteApiStatus]) => {
        if (disposed) {
          return;
        }
        applyDownloadState(snapshot.tasks, "ready", undefined);
        applyDownloadConfiguration(settings, remoteApiStatus, undefined);
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        applyDownloadState(
          downloadTasksRef.current,
          "error",
          message
        );
        applyDownloadConfiguration(
          downloadSettingsRef.current,
          downloadRemoteApiStatusRef.current,
          message
        );
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
  }, [
    applyDownloadConfiguration,
    applyDownloadState,
    desktopApi,
    downloadRemoteApiStatusRef,
    downloadSettingsRef,
    downloadTasksRef,
    labels.unavailable
  ]);

  const loadDownloads = useCallback(async (instanceId: string, addToHistory = true) => {
    unsubscribeDirectoryForInstance(instanceId);
    patchState(instanceId, (state) => ({ ...state, downloadStatus: "loading", downloadErrorMessage: undefined }));
    try {
      const downloadsApi = desktopApi?.downloads;
      const [snapshot, settings, remoteApiStatus] = downloadsApi === undefined
        ? [undefined, null, null] as const
        : await Promise.all([
            downloadsApi.list(),
            downloadsApi.readSettings(),
            downloadsApi.readRemoteApiStatus()
          ]);
      const current = statesRef.current[instanceId] ?? createState(instanceId);
      const nextTasks = snapshot?.tasks ?? downloadTasksRef.current;
      downloadTasksRef.current = nextTasks;
      downloadStatusRef.current = snapshot === undefined ? "error" : "ready";
      downloadErrorMessageRef.current = snapshot === undefined ? labels.unavailable : undefined;
      downloadSettingsRef.current = settings;
      downloadRemoteApiStatusRef.current = remoteApiStatus;
      replaceState(instanceId, {
        ...buildDownloadsState(current, labels, addToHistory),
        downloadTasks: nextTasks,
        downloadStatus: snapshot === undefined ? "error" : "ready",
        downloadErrorMessage: snapshot === undefined ? labels.unavailable : undefined,
        downloadSettings: settings,
        downloadRemoteApiStatus: remoteApiStatus,
        downloadSettingsDraft: createDownloadSettingsDraft(settings, remoteApiStatus),
        downloadSettingsErrorMessage: snapshot === undefined ? labels.unavailable : undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      downloadStatusRef.current = "error";
      downloadErrorMessageRef.current = message;
      patchState(instanceId, (state) => ({
        ...buildDownloadsState(state, labels, addToHistory),
        downloadStatus: "error",
        downloadErrorMessage: message,
        downloadSettingsErrorMessage: message
      }));
    }
  }, [
    createState,
    desktopApi,
    downloadErrorMessageRef,
    downloadRemoteApiStatusRef,
    downloadSettingsRef,
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

  const toggleDownloadAdvancedOptions = useCallback((instanceId: string) => {
    patchState(instanceId, (state) => ({
      ...state,
      downloadAdvancedDraft: {
        ...state.downloadAdvancedDraft,
        advancedOpen: state.downloadAdvancedDraft.advancedOpen === false
      }
    }));
  }, [patchState]);

  const updateDownloadAdvancedDraft = useCallback((
    instanceId: string,
    patch: Partial<FileManagerDownloadAdvancedDraft>
  ) => {
    patchState(instanceId, (state) => ({
      ...state,
      downloadAdvancedDraft: {
        ...state.downloadAdvancedDraft,
        ...patch
      },
      downloadErrorMessage: undefined
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
      const state = statesRef.current[instanceId] ?? createState(instanceId);
      const snapshot = await desktopApi.downloads.enqueue(
        buildDownloadEnqueueRequest(text, state.downloadAdvancedDraft)
      );
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
  }, [applyDownloadState, createState, desktopApi, downloadTasksRef, patchState, statesRef]);

  const submitDownloadUrlDraft = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    await submitDownloadText(instanceId, state?.downloadUrlDraft ?? "");
  }, [statesRef, submitDownloadText]);

  const importExternalBrowserDownloads = useCallback(async (instanceId: string) => {
    const downloadsApi = desktopApi?.downloads;
    if (downloadsApi === undefined) {
      return;
    }
    patchState(instanceId, (current) => ({
      ...current,
      downloadStatus: "loading",
      downloadErrorMessage: undefined
    }));
    try {
      const snapshot = await downloadsApi.importExternalBrowser();
      applyDownloadState(snapshot.tasks, "ready", undefined);
    } catch (error) {
      applyDownloadState(
        downloadTasksRef.current,
        "error",
        error instanceof Error ? error.message : String(error)
      );
    }
  }, [applyDownloadState, desktopApi, downloadTasksRef, patchState]);

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

  const toggleDownloadSettings = useCallback(async (instanceId: string) => {
    const willOpen = statesRef.current[instanceId]?.downloadSettingsOpen !== true;
    patchState(instanceId, (state) => ({
      ...state,
      downloadSettingsOpen: willOpen,
      downloadSettingsErrorMessage: undefined
    }));
    if (willOpen === false || desktopApi?.downloads === undefined) {
      return;
    }
    try {
      const [settings, remoteApiStatus] = await Promise.all([
        desktopApi.downloads.readSettings(),
        desktopApi.downloads.readRemoteApiStatus()
      ]);
      downloadSettingsRef.current = settings;
      downloadRemoteApiStatusRef.current = remoteApiStatus;
      patchState(instanceId, (state) => ({
        ...state,
        downloadSettings: settings,
        downloadRemoteApiStatus: remoteApiStatus,
        downloadSettingsDraft: createDownloadSettingsDraft(settings, remoteApiStatus),
        downloadSettingsErrorMessage: undefined
      }));
    } catch (error) {
      patchState(instanceId, (state) => ({
        ...state,
        downloadSettingsErrorMessage: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [desktopApi, downloadRemoteApiStatusRef, downloadSettingsRef, patchState, statesRef]);

  const updateDownloadSettingsDraft = useCallback((
    instanceId: string,
    patch: Partial<FileManagerDownloadSettingsDraft>
  ) => {
    patchState(instanceId, (state) => ({
      ...state,
      downloadSettingsDraft: {
        ...state.downloadSettingsDraft,
        ...patch
      },
      downloadSettingsErrorMessage: undefined
    }));
  }, [patchState]);

  const addDownloadSaveRuleDraft = useCallback((instanceId: string) => {
    patchState(instanceId, (state) => ({
      ...state,
      downloadSettingsDraft: {
        ...state.downloadSettingsDraft,
        saveRules: [
          ...state.downloadSettingsDraft.saveRules,
          createDownloadSaveRuleDraft()
        ]
      },
      downloadSettingsErrorMessage: undefined
    }));
  }, [patchState]);

  const removeDownloadSaveRuleDraft = useCallback((instanceId: string, ruleId: string) => {
    patchState(instanceId, (state) => ({
      ...state,
      downloadSettingsDraft: {
        ...state.downloadSettingsDraft,
        saveRules: state.downloadSettingsDraft.saveRules.filter((rule) => rule.id !== ruleId)
      },
      downloadSettingsErrorMessage: undefined
    }));
  }, [patchState]);

  const updateDownloadSaveRuleDraft = useCallback((
    instanceId: string,
    ruleId: string,
    patch: Partial<FileManagerDownloadSaveRuleDraft>
  ) => {
    patchState(instanceId, (state) => ({
      ...state,
      downloadSettingsDraft: {
        ...state.downloadSettingsDraft,
        saveRules: state.downloadSettingsDraft.saveRules.map((rule) =>
          rule.id === ruleId ? { ...rule, ...patch } : rule
        )
      },
      downloadSettingsErrorMessage: undefined
    }));
  }, [patchState]);

  const saveDownloadSettings = useCallback(async (instanceId: string) => {
    const downloadsApi = desktopApi?.downloads;
    const state = statesRef.current[instanceId];
    if (downloadsApi === undefined || state === undefined) {
      return;
    }
    try {
      const nextSettings = await downloadsApi.updateSettings(
        buildDownloadSettingsUpdate(state.downloadSettingsDraft)
      );
      downloadSettingsRef.current = nextSettings;
      patchState(instanceId, (current) => ({
        ...current,
        downloadSettings: nextSettings,
        downloadSettingsDraft: createDownloadSettingsDraft(
          nextSettings,
          current.downloadRemoteApiStatus
        ),
        downloadSettingsErrorMessage: undefined
      }));
    } catch (error) {
      patchState(instanceId, (current) => ({
        ...current,
        downloadSettingsErrorMessage: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [desktopApi, downloadSettingsRef, patchState, statesRef]);

  const startDownloadRemoteApi = useCallback(async (instanceId: string) => {
    const downloadsApi = desktopApi?.downloads;
    const state = statesRef.current[instanceId];
    if (downloadsApi === undefined || state === undefined) {
      return;
    }
    try {
      const draft = state.downloadSettingsDraft;
      const nextStatus = await downloadsApi.startRemoteApi({
        host: draft.remoteHost.trim() || undefined,
        port: parseRemoteApiPort(draft.remotePort),
        allowLan: draft.remoteAllowLan
      });
      downloadRemoteApiStatusRef.current = nextStatus;
      patchState(instanceId, (current) => ({
        ...current,
        downloadRemoteApiStatus: nextStatus,
        downloadSettingsDraft: {
          ...current.downloadSettingsDraft,
          remoteHost: nextStatus.host,
          remotePort: nextStatus.port === null ? "" : String(nextStatus.port)
        },
        downloadSettingsErrorMessage: undefined
      }));
    } catch (error) {
      patchState(instanceId, (current) => ({
        ...current,
        downloadSettingsErrorMessage: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [desktopApi, downloadRemoteApiStatusRef, patchState, statesRef]);

  const stopDownloadRemoteApi = useCallback(async (instanceId: string) => {
    const downloadsApi = desktopApi?.downloads;
    if (downloadsApi === undefined) {
      return;
    }
    try {
      const nextStatus = await downloadsApi.stopRemoteApi();
      downloadRemoteApiStatusRef.current = nextStatus;
      patchState(instanceId, (current) => ({
        ...current,
        downloadRemoteApiStatus: nextStatus,
        downloadSettingsErrorMessage: undefined
      }));
    } catch (error) {
      patchState(instanceId, (current) => ({
        ...current,
        downloadSettingsErrorMessage: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [desktopApi, downloadRemoteApiStatusRef, patchState]);

  return {
    loadDownloads,
    updateDownloadUrlDraft,
    toggleDownloadAdvancedOptions,
    updateDownloadAdvancedDraft,
    submitDownloadUrlDraft,
    submitDownloadText,
    importExternalBrowserDownloads,
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
    revealDownloadedFile,
    toggleDownloadSettings,
    updateDownloadSettingsDraft,
    addDownloadSaveRuleDraft,
    removeDownloadSaveRuleDraft,
    updateDownloadSaveRuleDraft,
    saveDownloadSettings,
    startDownloadRemoteApi,
    stopDownloadRemoteApi
  };
};
