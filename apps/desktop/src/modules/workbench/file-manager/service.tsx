import {
  FilePlus2,
  FolderPlus,
  FolderUp,
  HardDriveDownload,
  RefreshCw,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
  Unplug
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  FileManagerDirectoryPatch,
  FileManagerDirectorySnapshot,
  FileManagerDevice,
  FileManagerEntry,
  FileManagerFavorite,
  FileManagerDisk,
  FileManagerLocation,
  FileManagerReadDirectoryResponse,
  FileManagerReadHomeResponse,
  FileManagerReadTrashResponse,
  FileManagerRecentLocation,
  FileManagerTrashEntry
} from "../../../shared/file-manager";
import type {
  DownloadManagerPriority,
  DownloadManagerRemoteApiStatus,
  DownloadManagerSettings,
  DownloadManagerTask
} from "../../../shared/download-manager";
import type {
  FileManagerDownloadAdvancedDraft,
  FileManagerDownloadSaveRuleDraft,
  FileManagerDownloadSettingsDraft,
  FileManagerModel,
  FileManagerSurfaceLabels,
  UseFileManagerModelOptions,
  FileManagerAppState
} from "./types";
import {
  isSameLocationPath,
  resolveLocationTitle,
  withResolvedLocationTitle
} from "./location-utils";
import {
  buildDownloadEnqueueRequest,
  buildDownloadSettingsUpdate,
  createDownloadAdvancedDraft,
  createDownloadSaveRuleDraft,
  createDownloadSettingsDraft
} from "./download-drafts";

const MAX_RECENT_LOCATIONS = 12;

const createId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
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

const createInitialState = (
  instanceId: string,
  labels: FileManagerSurfaceLabels,
  downloads?: {
    readonly tasks: readonly DownloadManagerTask[];
    readonly status: FileManagerAppState["downloadStatus"];
    readonly errorMessage: string | undefined;
    readonly settings: DownloadManagerSettings | null;
    readonly remoteApiStatus: DownloadManagerRemoteApiStatus | null;
  }
): FileManagerAppState => ({
  instanceId,
  status: "idle",
  viewKind: "home",
  presentationMode: "list",
  title: labels.title,
  iconKey: "file-manager-home",
  currentLocation: null,
  parentPath: undefined,
  history: [],
  historyIndex: -1,
  systemLocations: [],
  favorites: [],
  recentLocations: [],
  disks: [],
  devices: [],
  entries: [],
  trashEntries: [],
  downloadTasks: downloads?.tasks ?? [],
  downloadStatus: downloads?.status ?? "idle",
  downloadUrlDraft: "",
  downloadAdvancedDraft: createDownloadAdvancedDraft(),
  downloadErrorMessage: downloads?.errorMessage,
  downloadSettings: downloads?.settings ?? null,
  downloadRemoteApiStatus: downloads?.remoteApiStatus ?? null,
  downloadSettingsOpen: false,
  downloadSettingsDraft: createDownloadSettingsDraft(
    downloads?.settings ?? null,
    downloads?.remoteApiStatus ?? null
  ),
  downloadSettingsErrorMessage: undefined,
  directorySubscriptionId: undefined,
  directoryGeneration: undefined,
  selectedEntryId: undefined,
  selectedTrashEntryId: undefined,
  createDraft: undefined,
  errorMessage: undefined
});

const deriveDirectoryIconKey = (entries: readonly FileManagerEntry[]) =>
  entries.some((entry) => entry.name.length > 0)
    ? "file-manager-directory-non-empty"
    : "file-manager-directory-empty";

const resolveFavorites = (
  favorites: readonly FileManagerFavorite[],
  labels: FileManagerSurfaceLabels
): readonly FileManagerFavorite[] =>
  favorites.map((favorite) => withResolvedLocationTitle(favorite, labels));

const resolveRecentLocations = (
  recentLocations: readonly FileManagerRecentLocation[],
  labels: FileManagerSurfaceLabels
): readonly FileManagerRecentLocation[] =>
  recentLocations.map((recent) => withResolvedLocationTitle(recent, labels));

const resolveSystemLocations = (
  systemLocations: readonly FileManagerLocation[],
  labels: FileManagerSurfaceLabels
): readonly FileManagerLocation[] =>
  systemLocations.map((location) => withResolvedLocationTitle(location, labels));

const withHistory = (
  state: FileManagerAppState,
  location: FileManagerLocation,
  addToHistory: boolean
): Pick<FileManagerAppState, "history" | "historyIndex"> => {
  if (addToHistory === false) {
    return {
      history: state.history,
      historyIndex: state.historyIndex
    };
  }

  const head = state.history.slice(0, state.historyIndex + 1);
  const last = head[head.length - 1];
  if (last?.id === location.id) {
    return {
      history: head,
      historyIndex: head.length - 1
    };
  }

  const nextHistory = [...head, location];
  return {
    history: nextHistory,
    historyIndex: nextHistory.length - 1
  };
};

const mergeRecentLocations = (
  current: readonly FileManagerRecentLocation[],
  location: FileManagerLocation
): readonly FileManagerRecentLocation[] => {
  if (location.path === undefined || location.path.length === 0) {
    return current;
  }

  const nextItem: FileManagerRecentLocation = {
    id: location.id,
    title: location.title,
    path: location.path,
    lastOpenedAt: new Date().toISOString()
  };

  const deduped = current.filter((item) => item.path !== nextItem.path);
  return [nextItem, ...deduped].slice(0, MAX_RECENT_LOCATIONS);
};

const findSelectedEntry = (
  state: FileManagerAppState
): FileManagerEntry | null => {
  if (state.selectedEntryId === undefined) {
    return null;
  }
  return state.entries.find((entry) => entry.id === state.selectedEntryId) ?? null;
};

const findSelectedTrashEntry = (
  state: FileManagerAppState
): FileManagerTrashEntry | null => {
  if (state.selectedTrashEntryId === undefined) {
    return null;
  }
  return state.trashEntries.find((entry) => entry.id === state.selectedTrashEntryId) ?? null;
};

const compareDirectoryEntries = (
  left: FileManagerEntry,
  right: FileManagerEntry
): number => {
  if (left.kind === "directory" && right.kind === "file") {
    return -1;
  }
  if (left.kind === "file" && right.kind === "directory") {
    return 1;
  }
  return left.name.toLowerCase().localeCompare(right.name.toLowerCase());
};

const sortDirectoryEntries = (
  entries: readonly FileManagerEntry[]
): readonly FileManagerEntry[] => [...entries].sort(compareDirectoryEntries);

const upsertDirectoryEntry = (
  entries: readonly FileManagerEntry[],
  entry: FileManagerEntry
): readonly FileManagerEntry[] => {
  const next = entries.filter((item) => item.path !== entry.path);
  next.push(entry);
  return sortDirectoryEntries(next);
};

const directoryResponseFromSnapshot = (
  snapshot: FileManagerDirectorySnapshot
): FileManagerReadDirectoryResponse => ({
  location: snapshot.location,
  ...(snapshot.parentPath === undefined ? {} : { parentPath: snapshot.parentPath }),
  entries: snapshot.entries
});

const isDirectoryLocation = (location: FileManagerLocation | null): boolean =>
  location?.kind === "directory" || (location?.kind === "special" && location.path !== undefined);

const canFavoriteLocation = (location: {
  readonly path?: string;
  readonly specialId?: string;
}): location is { readonly path: string; readonly specialId?: string } =>
  location.path !== undefined && location.path.length > 0 && location.specialId !== "trash";

const normalizeComparablePath = (
  value: string,
  platform: NodeJS.Platform | null
): string => {
  const normalized = value.replaceAll("\\", "/");
  return platform === "win32" || platform === "darwin"
    ? normalized.toLowerCase()
    : normalized;
};

const isPathInsideMount = (
  candidatePath: string | undefined,
  mountPath: string,
  platform: NodeJS.Platform | null
): boolean => {
  if (candidatePath === undefined) {
    return false;
  }

  const normalizedCandidate = normalizeComparablePath(candidatePath, platform);
  const normalizedMount = normalizeComparablePath(mountPath, platform);
  return normalizedCandidate === normalizedMount
    || normalizedCandidate.startsWith(`${normalizedMount}/`);
};

const buildHomeState = (
  current: FileManagerAppState,
  payload: FileManagerReadHomeResponse,
  labels: FileManagerSurfaceLabels,
  addToHistory: boolean
): FileManagerAppState => ({
  ...current,
  status: "ready",
  viewKind: "home",
  title: labels.title,
  iconKey: "file-manager-home",
  currentLocation: payload.location,
  ...withHistory(current, payload.location, addToHistory),
  systemLocations: resolveSystemLocations(payload.systemLocations, labels),
  favorites: resolveFavorites(payload.favorites, labels),
  recentLocations: resolveRecentLocations(payload.recentLocations, labels),
  disks: payload.disks,
  devices: payload.devices,
  entries: [],
  trashEntries: [],
  directorySubscriptionId: undefined,
  directoryGeneration: undefined,
  selectedEntryId: undefined,
  selectedTrashEntryId: undefined,
  createDraft: undefined,
  errorMessage: undefined
});

const buildDirectoryState = (
  current: FileManagerAppState,
  payload: FileManagerReadDirectoryResponse,
  labels: FileManagerSurfaceLabels,
  addToHistory: boolean,
  realtime?: {
    readonly subscriptionId?: string;
    readonly generation?: number;
  }
): FileManagerAppState => ({
  ...current,
  status: "ready",
  viewKind: "directory",
  title: resolveLocationTitle(payload.location, labels),
  iconKey: deriveDirectoryIconKey(payload.entries),
  currentLocation: withResolvedLocationTitle(payload.location, labels),
  parentPath: payload.parentPath,
  ...withHistory(current, payload.location, addToHistory),
  entries: sortDirectoryEntries(payload.entries),
  disks: [],
  devices: [],
  trashEntries: [],
  directorySubscriptionId: realtime?.subscriptionId,
  directoryGeneration: realtime?.generation,
  selectedEntryId: undefined,
  selectedTrashEntryId: undefined,
  createDraft: undefined,
  errorMessage: undefined
});

const buildTrashState = (
  current: FileManagerAppState,
  payload: FileManagerReadTrashResponse,
  labels: FileManagerSurfaceLabels,
  addToHistory: boolean
): FileManagerAppState => ({
  ...current,
  status: "ready",
  viewKind: "trash",
  title: resolveLocationTitle(payload.location, labels),
  iconKey: "file-manager-trash",
  currentLocation: withResolvedLocationTitle(payload.location, labels),
  parentPath: undefined,
  ...withHistory(current, payload.location, addToHistory),
  entries: [],
  disks: [],
  devices: [],
  trashEntries: payload.entries,
  directorySubscriptionId: undefined,
  directoryGeneration: undefined,
  selectedEntryId: undefined,
  selectedTrashEntryId: undefined,
  createDraft: undefined,
  errorMessage: undefined
});

const buildDownloadsState = (
  current: FileManagerAppState,
  labels: FileManagerSurfaceLabels,
  addToHistory: boolean
): FileManagerAppState => {
  const location: FileManagerLocation = {
    id: "download-manager",
    title: labels.downloadManagerTitle,
    kind: "special",
    specialId: "downloadManager"
  };
  return {
    ...current,
    status: "ready",
    viewKind: "downloads",
    title: labels.downloadManagerTitle,
    iconKey: "file-manager-download-manager",
    currentLocation: location,
    parentPath: undefined,
    ...withHistory(current, location, addToHistory),
    entries: [],
    disks: [],
    devices: [],
    trashEntries: [],
    directorySubscriptionId: undefined,
    directoryGeneration: undefined,
    selectedEntryId: undefined,
    selectedTrashEntryId: undefined,
    createDraft: undefined,
    errorMessage: undefined
  };
};

const applyDirectoryPatchToState = (
  state: FileManagerAppState,
  patch: FileManagerDirectoryPatch,
  labels: FileManagerSurfaceLabels
): FileManagerAppState => {
  if (
    state.viewKind !== "directory"
    || state.directorySubscriptionId !== patch.subscriptionId
    || (
      state.directoryGeneration !== undefined
      && patch.generation < state.directoryGeneration
    )
  ) {
    return state;
  }

  if (patch.kind === "reset") {
    if (patch.snapshot === undefined) {
      return {
        ...state,
        status: patch.errorMessage === undefined ? state.status : "error",
        directoryGeneration: patch.generation,
        errorMessage: patch.errorMessage
      };
    }
    return {
      ...buildDirectoryState(
        state,
        directoryResponseFromSnapshot(patch.snapshot),
        labels,
        false,
        {
          subscriptionId: state.directorySubscriptionId,
          generation: patch.snapshot.generation
        }
      ),
      history: state.history,
      historyIndex: state.historyIndex
    };
  }

  if (patch.kind === "remove") {
    const removePath = patch.path ?? patch.oldPath;
    if (removePath === undefined) {
      return state;
    }
    const entries = state.entries.filter((entry) => entry.path !== removePath);
    return {
      ...state,
      status: "ready",
      entries,
      iconKey: deriveDirectoryIconKey(entries),
      directoryGeneration: patch.generation,
      selectedEntryId:
        state.selectedEntryId !== undefined
        && state.entries.find((entry) => entry.id === state.selectedEntryId)?.path === removePath
          ? undefined
          : state.selectedEntryId,
      errorMessage: undefined
    };
  }

  if (patch.kind === "rename") {
    const removePath = patch.oldPath;
    const entry = patch.entry;
    if (removePath === undefined || entry === undefined) {
      return state;
    }
    const entries = upsertDirectoryEntry(
      state.entries.filter((item) => item.path !== removePath),
      entry
    );
    return {
      ...state,
      status: "ready",
      entries,
      iconKey: deriveDirectoryIconKey(entries),
      directoryGeneration: patch.generation,
      selectedEntryId:
        state.selectedEntryId !== undefined
        && state.entries.find((item) => item.id === state.selectedEntryId)?.path === removePath
          ? entry.id
          : state.selectedEntryId,
      errorMessage: undefined
    };
  }

  if (patch.entry === undefined) {
    return state;
  }

  const entries = upsertDirectoryEntry(state.entries, patch.entry);
  return {
    ...state,
    status: "ready",
    entries,
    iconKey: deriveDirectoryIconKey(entries),
    directoryGeneration: patch.generation,
    errorMessage: undefined
  };
};

export const useFileManagerModel = ({
  desktopApi,
  contextMenuModel,
  labels,
  onMetaChange
}: UseFileManagerModelOptions): FileManagerModel => {
  const [statesById, setStatesById] = useState<Record<string, FileManagerAppState>>({});
  const statesRef = useRef<Record<string, FileManagerAppState>>({});
  const tabInstanceIdsRef = useRef<ReadonlySet<string>>(new Set());
  const externalInstanceIdsRef = useRef<ReadonlySet<string>>(new Set());
  const downloadTasksRef = useRef<readonly DownloadManagerTask[]>([]);
  const downloadStatusRef = useRef<FileManagerAppState["downloadStatus"]>("idle");
  const downloadErrorMessageRef = useRef<string | undefined>(undefined);
  const downloadSettingsRef = useRef<DownloadManagerSettings | null>(null);
  const downloadRemoteApiStatusRef = useRef<DownloadManagerRemoteApiStatus | null>(null);
  const platform = desktopApi?.appMeta.platform ?? null;

  const createState = useCallback(
    (instanceId: string) =>
      createInitialState(instanceId, labels, {
        tasks: downloadTasksRef.current,
        status: downloadStatusRef.current,
        errorMessage: downloadErrorMessageRef.current,
        settings: downloadSettingsRef.current,
        remoteApiStatus: downloadRemoteApiStatusRef.current
      }),
    [labels]
  );

  const updateStates = useCallback(
    (
      updater: (
        current: Record<string, FileManagerAppState>
      ) => Record<string, FileManagerAppState>
    ) => {
      setStatesById((current) => {
        const next = updater(current);
        statesRef.current = next;
        return next;
      });
    },
    []
  );

  const patchState = useCallback((instanceId: string, updater: (state: FileManagerAppState) => FileManagerAppState) => {
    updateStates((current) => {
      const base = current[instanceId] ?? createState(instanceId);
      const nextState = updater(base);
      onMetaChange({
        appId: "file-manager",
        appInstanceId: instanceId,
        title: nextState.title,
        iconKey: nextState.iconKey
      });
      return {
        ...current,
        [instanceId]: nextState
      };
    });
  }, [createState, onMetaChange, updateStates]);

  const replaceState = useCallback((instanceId: string, nextState: FileManagerAppState) => {
    updateStates((current) => ({
      ...current,
      [instanceId]: nextState
    }));
    onMetaChange({
      appId: "file-manager",
      appInstanceId: instanceId,
      title: nextState.title,
      iconKey: nextState.iconKey
    });
  }, [onMetaChange, updateStates]);

  const unsubscribeDirectory = useCallback((subscriptionId: string | undefined) => {
    if (subscriptionId === undefined) {
      return;
    }
    void desktopApi?.files.unsubscribeDirectory?.(subscriptionId).catch(() => undefined);
  }, [desktopApi]);

  const unsubscribeDirectoryForInstance = useCallback((instanceId: string) => {
    unsubscribeDirectory(statesRef.current[instanceId]?.directorySubscriptionId);
  }, [unsubscribeDirectory]);

  const applyDownloadState = useCallback((
    tasks: readonly DownloadManagerTask[],
    status: FileManagerAppState["downloadStatus"],
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
  }, [updateStates]);

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
  }, [updateStates]);

  useEffect(() => {
    if (desktopApi?.files.onDirectoryPatch === undefined) {
      return undefined;
    }
    return desktopApi.files.onDirectoryPatch((patch) => {
      updateStates((current) => {
        let changed = false;
        const nextEntries = Object.entries(current).map(([instanceId, state]) => {
          const nextState = applyDirectoryPatchToState(state, patch, labels);
          if (nextState !== state) {
            changed = true;
            onMetaChange({
              appId: "file-manager",
              appInstanceId: instanceId,
              title: nextState.title,
              iconKey: nextState.iconKey
            });
          }
          return [instanceId, nextState] as const;
        });
        return changed ? Object.fromEntries(nextEntries) : current;
      });
    });
  }, [desktopApi, labels, onMetaChange, updateStates]);

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
  }, [applyDownloadConfiguration, applyDownloadState, desktopApi, labels.unavailable]);

  useEffect(
    () => () => {
      for (const state of Object.values(statesRef.current)) {
        unsubscribeDirectory(state.directorySubscriptionId);
      }
    },
    [unsubscribeDirectory]
  );

  const isFavoritePath = useCallback(
    (favorites: readonly FileManagerFavorite[], path: string | undefined) => {
      if (path === undefined) {
        return false;
      }

      return favorites.some((item) => isSameLocationPath(item.path, path, platform));
    },
    [platform]
  );

  const broadcastFavorites = useCallback((favorites: readonly FileManagerFavorite[]) => {
    updateStates((current) => Object.fromEntries(
      Object.entries(current).map(([instanceId, state]) => [instanceId, { ...state, favorites }])
    ));
  }, [updateStates]);

  const broadcastRecentLocations = useCallback((recentLocations: readonly FileManagerRecentLocation[]) => {
    updateStates((current) => Object.fromEntries(
      Object.entries(current).map(([instanceId, state]) => [instanceId, { ...state, recentLocations }])
    ));
  }, [updateStates]);

  const writeFavoritesForState = useCallback(
    async (
      state: FileManagerAppState,
      updater: (current: readonly FileManagerFavorite[]) => readonly FileManagerFavorite[]
    ) => {
      if (desktopApi === null) {
        return;
      }

      const nextFavorites = resolveFavorites(updater(state.favorites), labels);
      await desktopApi.files.writeFavorites({ favorites: nextFavorites });
      broadcastFavorites(nextFavorites);
    },
    [broadcastFavorites, desktopApi, labels]
  );

  const loadHome = useCallback(async (instanceId: string, addToHistory = true) => {
    if (desktopApi === null) {
      replaceState(instanceId, {
        ...createState(instanceId),
        status: "error",
        errorMessage: labels.unavailable
      });
      return;
    }

    unsubscribeDirectoryForInstance(instanceId);
    patchState(instanceId, (state) => ({ ...state, status: "loading", errorMessage: undefined }));
    try {
      const payload = await desktopApi.files.readHome();
      const current = statesRef.current[instanceId] ?? createState(instanceId);
      replaceState(instanceId, buildHomeState(current, payload, labels, addToHistory));
    } catch (error) {
      patchState(instanceId, (state) => ({
        ...state,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [desktopApi, labels, patchState, replaceState, unsubscribeDirectoryForInstance]);

  const loadDirectory = useCallback(async (instanceId: string, path: string, addToHistory = true) => {
    if (desktopApi === null) {
      replaceState(instanceId, {
        ...createState(instanceId),
        status: "error",
        errorMessage: labels.unavailable
      });
      return;
    }

    unsubscribeDirectoryForInstance(instanceId);
    patchState(instanceId, (state) => ({ ...state, status: "loading", errorMessage: undefined }));
    try {
      const subscription = await desktopApi.files.subscribeDirectory?.({ path });
      const payload = subscription === undefined
        ? await desktopApi.files.readDirectory({ path })
        : directoryResponseFromSnapshot(subscription.snapshot);
      const current = statesRef.current[instanceId] ?? createState(instanceId);
      const nextState = buildDirectoryState(
        current,
        payload,
        labels,
        addToHistory,
        subscription === undefined
          ? undefined
          : {
              subscriptionId: subscription.subscriptionId,
              generation: subscription.snapshot.generation
            }
      );
      replaceState(instanceId, nextState);

      const nextRecentLocations = mergeRecentLocations(current.recentLocations, payload.location);
      void desktopApi.files.writeRecentLocations({ recentLocations: nextRecentLocations })
        .then((payload) => {
          broadcastRecentLocations(payload.recentLocations);
        })
        .catch(() => undefined);
    } catch (error) {
      patchState(instanceId, (state) => ({
        ...state,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [broadcastRecentLocations, desktopApi, labels, patchState, replaceState, unsubscribeDirectoryForInstance]);

  const loadTrash = useCallback(async (instanceId: string, addToHistory = true) => {
    if (desktopApi === null) {
      replaceState(instanceId, {
        ...createState(instanceId),
        status: "error",
        errorMessage: labels.unavailable
      });
      return;
    }

    unsubscribeDirectoryForInstance(instanceId);
    patchState(instanceId, (state) => ({ ...state, status: "loading", errorMessage: undefined }));
    try {
      const payload = await desktopApi.files.readTrash();
      const current = statesRef.current[instanceId] ?? createState(instanceId);
      replaceState(instanceId, buildTrashState(current, payload, labels, addToHistory));
    } catch (error) {
      patchState(instanceId, (state) => ({
        ...state,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [desktopApi, labels, patchState, replaceState, unsubscribeDirectoryForInstance]);

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
  }, [createState, desktopApi, labels, patchState, replaceState, unsubscribeDirectoryForInstance]);

  const createInstance = useCallback(() => {
    const appInstanceId = createId("file-manager");
    const initialState = createState(appInstanceId);
    replaceState(appInstanceId, initialState);
    return {
      appId: "file-manager" as const,
      appInstanceId,
      title: initialState.title,
      iconKey: initialState.iconKey
    };
  }, [labels, replaceState]);

  const openLocation = useCallback(async (instanceId: string, location: FileManagerLocation, addToHistory = true) => {
    if (location.kind === "home") {
      await loadHome(instanceId, addToHistory);
      return;
    }
    if (location.kind === "trash" || location.specialId === "trash") {
      await loadTrash(instanceId, addToHistory);
      return;
    }
    if (location.specialId === "downloadManager") {
      await loadDownloads(instanceId, addToHistory);
      return;
    }
    if (location.path !== undefined && location.path.length > 0) {
      await loadDirectory(instanceId, location.path, addToHistory);
    }
  }, [loadDirectory, loadDownloads, loadHome, loadTrash]);

  const ensureInstance = useCallback((instanceId: string) => {
    updateStates((current) => {
      if (current[instanceId] !== undefined) {
        return current;
      }
      return {
        ...current,
        [instanceId]: createState(instanceId)
      };
    });
  }, [labels, updateStates]);

  const syncTabInstances = useCallback((instanceIds: readonly string[]) => {
    const normalizedInstanceIds = instanceIds.filter((instanceId) => instanceId.trim().length > 0);
    tabInstanceIdsRef.current = new Set(normalizedInstanceIds);
    const keep = new Set([
      ...normalizedInstanceIds,
      ...externalInstanceIdsRef.current
    ]);
    updateStates((current) => {
      const currentEntries = Object.entries(current);
      const nextEntries = currentEntries.filter(([instanceId]) => keep.has(instanceId));
      if (nextEntries.length === currentEntries.length) {
        return current;
      }
      for (const [, state] of currentEntries) {
        if (keep.has(state.instanceId) === false) {
          unsubscribeDirectory(state.directorySubscriptionId);
        }
      }
      return Object.fromEntries(nextEntries);
    });
  }, [unsubscribeDirectory, updateStates]);

  const syncExternalInstances = useCallback((instanceIds: readonly string[]) => {
    const normalized = instanceIds
      .map((instanceId) => instanceId.trim())
      .filter((instanceId) => instanceId.length > 0);
    const nextExternalIds = new Set(normalized);
    const currentExternalIds = externalInstanceIdsRef.current;

    if (
      currentExternalIds.size === nextExternalIds.size
      && normalized.every((instanceId) => currentExternalIds.has(instanceId))
    ) {
      return;
    }

    externalInstanceIdsRef.current = nextExternalIds;
    syncTabInstances(Array.from(tabInstanceIdsRef.current));
  }, [syncTabInstances]);

  const getState = useCallback((instanceId: string) => statesRef.current[instanceId] ?? null, []);

  const goBack = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    if (state === undefined || state.historyIndex <= 0) {
      return;
    }
    const target = state.history[state.historyIndex - 1];
    if (target === undefined) {
      return;
    }
    patchState(instanceId, (current) => ({ ...current, historyIndex: current.historyIndex - 1 }));
    await openLocation(instanceId, target, false);
  }, [openLocation, patchState]);

  const goForward = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    if (state === undefined || state.historyIndex >= state.history.length - 1) {
      return;
    }
    const target = state.history[state.historyIndex + 1];
    if (target === undefined) {
      return;
    }
    patchState(instanceId, (current) => ({ ...current, historyIndex: current.historyIndex + 1 }));
    await openLocation(instanceId, target, false);
  }, [openLocation, patchState]);

  const goUp = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    if (state?.parentPath === undefined) {
      return;
    }
    await loadDirectory(instanceId, state.parentPath);
  }, [loadDirectory]);

  const refresh = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    if (state?.viewKind === "downloads") {
      await loadDownloads(instanceId, false);
      return;
    }
    if (state === undefined || state.currentLocation === null) {
      await loadHome(instanceId, false);
      return;
    }
    await openLocation(instanceId, state.currentLocation, false);
  }, [loadDownloads, loadHome, openLocation]);

  const setPresentationMode = useCallback((instanceId: string, mode: "list" | "large") => {
    patchState(instanceId, (state) => ({
      ...state,
      presentationMode: mode
    }));
  }, [patchState]);

  const refreshAfterDeviceEject = useCallback(async (mountPath: string) => {
    const snapshot = Object.values(statesRef.current);
    await Promise.all(
      snapshot.map(async (state) => {
        if (state.viewKind === "home") {
          await loadHome(state.instanceId, false);
          return;
        }

        if (isPathInsideMount(state.currentLocation?.path, mountPath, platform)) {
          await loadHome(state.instanceId, false);
        }
      })
    );
  }, [loadHome, platform]);

  const selectEntry = useCallback((instanceId: string, entryId: string) => {
    patchState(instanceId, (state) => ({
      ...state,
      selectedEntryId: entryId,
      selectedTrashEntryId: undefined
    }));
  }, [patchState]);

  const selectTrashEntry = useCallback((instanceId: string, entryId: string) => {
    patchState(instanceId, (state) => ({
      ...state,
      selectedTrashEntryId: entryId,
      selectedEntryId: undefined
    }));
  }, [patchState]);

  const beginCreateDraft = useCallback((instanceId: string, kind: "file" | "directory") => {
    patchState(instanceId, (state) => ({
      ...state,
      createDraft: {
        kind,
        value: ""
      }
    }));
  }, [patchState]);

  const updateCreateDraft = useCallback((instanceId: string, value: string) => {
    patchState(instanceId, (state) => {
      if (state.createDraft === undefined) {
        return state;
      }
      return {
        ...state,
        createDraft: {
          ...state.createDraft,
          value
        }
      };
    });
  }, [patchState]);

  const cancelCreateDraft = useCallback((instanceId: string) => {
    patchState(instanceId, (state) => ({
      ...state,
      createDraft: undefined
    }));
  }, [patchState]);

  const commitCreateDraft = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    if (desktopApi === null || state?.createDraft === undefined || state.currentLocation?.path === undefined) {
      return;
    }

    const name = state.createDraft.value.trim();
    if (name.length === 0) {
      return;
    }

    if (state.createDraft.kind === "directory") {
      await desktopApi.files.createFolder({
        parentPath: state.currentLocation.path,
        name
      });
    } else {
      await desktopApi.files.createFile({
        parentPath: state.currentLocation.path,
        name
      });
    }

    await loadDirectory(instanceId, state.currentLocation.path, false);
  }, [desktopApi, loadDirectory]);

  const moveSelectionToTrash = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    const target = state === undefined ? null : findSelectedEntry(state);
    if (desktopApi === null || target === null) {
      return;
    }

    await desktopApi.files.moveToTrash({ paths: [target.path] });
    await refresh(instanceId);
  }, [desktopApi, refresh]);

  const restoreSelectionFromTrash = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    const target = state === undefined ? null : findSelectedTrashEntry(state);
    if (desktopApi === null || target === null) {
      return;
    }

    await desktopApi.files.restoreFromTrash({ itemIds: [target.id] });
    await loadTrash(instanceId, false);
  }, [desktopApi, loadTrash]);

  const emptyTrash = useCallback(async (instanceId: string) => {
    if (desktopApi === null) {
      return;
    }
    await desktopApi.files.emptyTrash();
    await loadTrash(instanceId, false);
  }, [desktopApi, loadTrash]);

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
  }, [applyDownloadState, desktopApi, patchState]);

  const submitDownloadUrlDraft = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    await submitDownloadText(instanceId, state?.downloadUrlDraft ?? "");
  }, [submitDownloadText]);

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
  }, [applyDownloadState, desktopApi, patchState]);

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
  }, [desktopApi, patchState]);

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
  }, [desktopApi, patchState]);

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
  }, [desktopApi, patchState]);

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
  }, [desktopApi, patchState]);

  const ejectDisk = useCallback(async (instanceId: string, disk: FileManagerDisk) => {
    if (desktopApi === null || disk.canEject === false) {
      return;
    }

    const request = {
      mountPath: disk.mountPath,
      kind: disk.kind
    } as const;
    await desktopApi.files.ejectDevice(
      disk.devicePath === undefined
        ? request
        : {
            ...request,
            devicePath: disk.devicePath
          }
    );
    await refreshAfterDeviceEject(disk.mountPath);

    const currentState = statesRef.current[instanceId];
    if (currentState !== undefined && currentState.viewKind !== "home") {
      await loadHome(instanceId, false);
    }
  }, [desktopApi, loadHome, refreshAfterDeviceEject]);

  const ejectDevice = useCallback(async (instanceId: string, device: FileManagerDevice) => {
    if (desktopApi === null || device.canEject === false) {
      return;
    }

    await desktopApi.files.ejectDevice({
      mountPath: device.devicePath,
      devicePath: device.devicePath,
      kind: device.kind
    });
    await refreshAfterDeviceEject(device.devicePath);

    const currentState = statesRef.current[instanceId];
    if (currentState !== undefined && currentState.viewKind !== "home") {
      await loadHome(instanceId, false);
    }
  }, [desktopApi, loadHome, refreshAfterDeviceEject]);

  const mountDevice = useCallback(async (instanceId: string, device: FileManagerDevice) => {
    if (desktopApi === null || device.canMount === false) {
      return;
    }

    const result = await desktopApi.files.mountDevice({
      devicePath: device.devicePath,
      kind: device.kind
    });
    await loadHome(instanceId, false);

    if (result.mountPath !== undefined && result.mountPath.length > 0) {
      await loadDirectory(instanceId, result.mountPath, false);
    }
  }, [desktopApi, loadDirectory, loadHome]);

  const toggleFavoriteForLocation = useCallback(
    async (
      instanceId: string,
      location: {
        readonly title: string;
        readonly path?: string;
        readonly specialId?: string;
      }
    ) => {
      const initialState = statesRef.current[instanceId];
      if (initialState === undefined || canFavoriteLocation(location) === false) {
        return;
      }

      const state = statesRef.current[instanceId] ?? initialState;
      await writeFavoritesForState(state, (currentFavorites) => {
        const exists = isFavoritePath(currentFavorites, location.path);
        if (exists) {
          return currentFavorites.filter(
            (item) => isSameLocationPath(item.path, location.path, platform) === false
          );
        }

        const nextFavorite: FileManagerFavorite =
          location.specialId !== undefined
            ? {
                id: createId("favorite"),
                title: location.title,
                path: location.path,
                specialId:
                  location.specialId as Exclude<
                    FileManagerFavorite["specialId"],
                    undefined
                  >
              }
            : {
                id: createId("favorite"),
                title: location.title,
                path: location.path
              };

        return [
          nextFavorite,
          ...currentFavorites
        ];
      });
    },
    [isFavoritePath, platform, writeFavoritesForState]
  );

  const toggleCurrentDirectoryFavorite = useCallback(async (instanceId: string) => {
    const state = statesRef.current[instanceId];
    const currentLocation = state?.currentLocation ?? null;
    if (state === undefined || currentLocation === null || isDirectoryLocation(currentLocation) === false) {
      return;
    }
    await toggleFavoriteForLocation(instanceId, currentLocation);
  }, [toggleFavoriteForLocation]);

  const openFavoriteContextMenu = useCallback(
    (instanceId: string, favorite: FileManagerFavorite, anchorX: number, anchorY: number) => {
      contextMenuModel.openMenu({
        anchorX,
        anchorY,
        items: [
          {
            id: `open-favorite-${favorite.id}`,
            label: labels.contextOpen,
            icon: <FolderUp size={14} />,
            onSelect: () => {
              void loadDirectory(instanceId, favorite.path);
            }
          },
          {
            id: `remove-favorite-${favorite.id}`,
            label: labels.removeFavorite,
            icon: <StarOff size={14} />,
            onSelect: () => {
              const state = statesRef.current[instanceId];
              if (state === undefined) {
                return;
              }
              void writeFavoritesForState(state, (currentFavorites) =>
                currentFavorites.filter(
                  (item) => isSameLocationPath(item.path, favorite.path, platform) === false
                )
              );
            }
          }
        ]
      });
    },
    [contextMenuModel, labels.contextOpen, labels.removeFavorite, loadDirectory, platform, writeFavoritesForState]
  );

  const openLocationContextMenu = useCallback(
    (instanceId: string, location: FileManagerLocation, anchorX: number, anchorY: number) => {
      const state = statesRef.current[instanceId];
      const items = [
        {
          id: `open-location-${location.id}`,
          label: labels.contextOpen,
          icon: <FolderUp size={14} />,
          onSelect: () => {
            void openLocation(instanceId, location);
          }
        }
      ];

      if (state !== undefined && canFavoriteLocation(location)) {
        const favoriteActive = isFavoritePath(state.favorites, location.path);
        items.push({
          id: `toggle-location-favorite-${location.id}`,
          label: favoriteActive ? labels.removeFavorite : labels.addFavorite,
          icon: favoriteActive ? <StarOff size={14} /> : <Star size={14} />,
          onSelect: () => {
            void toggleFavoriteForLocation(instanceId, location);
          }
        });
      }

      contextMenuModel.openMenu({
        anchorX,
        anchorY,
        items
      });
    },
    [
      contextMenuModel,
      isFavoritePath,
      labels.addFavorite,
      labels.contextOpen,
      labels.removeFavorite,
      openLocation,
      platform,
      toggleFavoriteForLocation
    ]
  );

  const openRecentLocationContextMenu = useCallback(
    (instanceId: string, recent: FileManagerRecentLocation, anchorX: number, anchorY: number) => {
      const location: FileManagerLocation = {
        id: recent.id,
        title: recent.title,
        kind: "directory",
        path: recent.path
      };
      openLocationContextMenu(instanceId, location, anchorX, anchorY);
    },
    [openLocationContextMenu]
  );

  const openDiskContextMenu = useCallback((instanceId: string, disk: FileManagerDisk, anchorX: number, anchorY: number) => {
    const items = [
      {
        id: `open-disk-${disk.id}`,
        label: labels.contextOpen,
        icon: <FolderUp size={14} />,
        onSelect: () => {
          void loadDirectory(instanceId, disk.mountPath);
        }
      }
    ];

    if (disk.canEject) {
      items.push({
        id: `eject-disk-${disk.id}`,
        label: labels.contextEjectDevice,
        icon: <Unplug size={14} />,
        onSelect: () => {
          void ejectDisk(instanceId, disk);
        }
      });
    }

    contextMenuModel.openMenu({
      anchorX,
      anchorY,
      items
    });
  }, [contextMenuModel, ejectDisk, labels.contextEjectDevice, labels.contextOpen, loadDirectory]);

  const openDeviceContextMenu = useCallback((instanceId: string, device: FileManagerDevice, anchorX: number, anchorY: number) => {
    const items = [];

    if (device.canMount) {
      items.push({
        id: `mount-device-${device.id}`,
        label: labels.contextMountDevice,
        icon: <HardDriveDownload size={14} />,
        onSelect: () => {
          void mountDevice(instanceId, device);
        }
      });
    }

    if (device.canEject) {
      items.push({
        id: `eject-device-${device.id}`,
        label: labels.contextEjectDevice,
        icon: <Unplug size={14} />,
        onSelect: () => {
          void ejectDevice(instanceId, device);
        }
      });
    }

    if (items.length === 0) {
      return;
    }

    contextMenuModel.openMenu({
      anchorX,
      anchorY,
      items
    });
  }, [contextMenuModel, ejectDevice, labels.contextEjectDevice, labels.contextMountDevice, mountDevice]);

  const openEntryContextMenu = useCallback((instanceId: string, entryId: string, anchorX: number, anchorY: number) => {
    const state = statesRef.current[instanceId];
    const entry = state?.entries.find((item) => item.id === entryId);
    if (entry === undefined) {
      return;
    }
    selectEntry(instanceId, entryId);
    contextMenuModel.openMenu({
      anchorX,
      anchorY,
      items: [
        ...(entry.kind === "directory"
          ? [{
              id: `open-${entry.id}`,
              label: labels.contextOpen,
              icon: <FolderUp size={14} />,
              onSelect: () => {
                void loadDirectory(instanceId, entry.path);
              }
            }]
          : []),
        ...(entry.kind === "directory"
          ? [{
              id: `favorite-${entry.id}`,
              label: isFavoritePath(state?.favorites ?? [], entry.path)
                ? labels.removeFavorite
                : labels.addFavorite,
              icon: isFavoritePath(state?.favorites ?? [], entry.path)
                ? <StarOff size={14} />
                : <Star size={14} />,
              onSelect: () => {
                void toggleFavoriteForLocation(instanceId, {
                  title: entry.name,
                  path: entry.path
                });
              }
            }]
          : []),
        {
          id: `trash-${entry.id}`,
          label: labels.contextMoveToTrash,
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () => {
            if (desktopApi === null) {
              return;
            }
            void desktopApi.files.moveToTrash({ paths: [entry.path] }).then(() => refresh(instanceId));
          }
        }
      ]
    });
  }, [
    contextMenuModel,
    desktopApi,
    isFavoritePath,
    labels.addFavorite,
    labels.contextMoveToTrash,
    labels.contextOpen,
    labels.removeFavorite,
    loadDirectory,
    platform,
    refresh,
    selectEntry,
    toggleFavoriteForLocation
  ]);

  const openTrashEntryContextMenu = useCallback((instanceId: string, entryId: string, anchorX: number, anchorY: number) => {
    const state = statesRef.current[instanceId];
    const entry = state?.trashEntries.find((item) => item.id === entryId);
    if (entry === undefined) {
      return;
    }
    selectTrashEntry(instanceId, entryId);
    contextMenuModel.openMenu({
      anchorX,
      anchorY,
      items: [
        {
          id: `restore-${entry.id}`,
          label: labels.contextRestore,
          icon: <RotateCcw size={14} />,
          onSelect: () => {
            if (desktopApi === null) {
              return;
            }
            void desktopApi.files.restoreFromTrash({ itemIds: [entry.id] }).then(() => loadTrash(instanceId, false));
          }
        },
        {
          id: `empty-trash-${entry.id}`,
          label: labels.contextEmptyTrash,
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () => {
            if (desktopApi === null) {
              return;
            }
            void desktopApi.files.emptyTrash().then(() => loadTrash(instanceId, false));
          }
        }
      ]
    });
  }, [contextMenuModel, desktopApi, labels.contextEmptyTrash, labels.contextRestore, loadTrash, selectTrashEntry]);

  const openTrashContextMenu = useCallback((instanceId: string, anchorX: number, anchorY: number) => {
    contextMenuModel.openMenu({
      anchorX,
      anchorY,
      items: [
        {
          id: `refresh-trash-${instanceId}`,
          label: labels.refresh,
          icon: <RefreshCw size={14} />,
          onSelect: () => {
            void loadTrash(instanceId, false);
          }
        },
        {
          id: `empty-trash-${instanceId}`,
          label: labels.contextEmptyTrash,
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () => {
            void emptyTrash(instanceId);
          }
        }
      ]
    });
  }, [contextMenuModel, emptyTrash, labels.contextEmptyTrash, labels.refresh, loadTrash]);

  const openDirectoryContextMenu = useCallback((instanceId: string, anchorX: number, anchorY: number) => {
    contextMenuModel.openMenu({
      anchorX,
      anchorY,
      items: [
        {
          id: `new-folder-${instanceId}`,
          label: labels.newFolder,
          icon: <FolderPlus size={14} />,
          onSelect: () => {
            beginCreateDraft(instanceId, "directory");
          }
        },
        {
          id: `new-file-${instanceId}`,
          label: labels.newFile,
          icon: <FilePlus2 size={14} />,
          onSelect: () => {
            beginCreateDraft(instanceId, "file");
          }
        },
        {
          id: `refresh-${instanceId}`,
          label: labels.refresh,
          icon: <RefreshCw size={14} />,
          onSelect: () => {
            void refresh(instanceId);
          }
        },
        {
          id: `toggle-favorite-${instanceId}`,
          label: (() => {
            const state = statesRef.current[instanceId];
            const currentLocation = state?.currentLocation ?? null;
            if (state === undefined || currentLocation === null || isDirectoryLocation(currentLocation) === false) {
              return labels.addFavorite;
            }
            return isFavoritePath(state.favorites, currentLocation.path)
              ? labels.removeFavorite
              : labels.addFavorite;
          })(),
          icon: (() => {
            const state = statesRef.current[instanceId];
            const currentLocation = state?.currentLocation ?? null;
            if (state === undefined || currentLocation === null || isDirectoryLocation(currentLocation) === false) {
              return <Star size={14} />;
            }
            return isFavoritePath(state.favorites, currentLocation.path)
              ? <StarOff size={14} />
              : <Star size={14} />;
          })(),
          disabled: (() => {
            const state = statesRef.current[instanceId];
            return isDirectoryLocation(state?.currentLocation ?? null) === false;
          })(),
          onSelect: () => {
            void toggleCurrentDirectoryFavorite(instanceId);
          }
        }
      ]
    });
  }, [
    beginCreateDraft,
    contextMenuModel,
    isFavoritePath,
    labels.addFavorite,
    labels.newFile,
    labels.newFolder,
    labels.refresh,
    labels.removeFavorite,
    refresh,
    toggleCurrentDirectoryFavorite
  ]);

  const model = useMemo<FileManagerModel>(() => ({
    createInstance,
    getState,
    ensureInstance,
    syncExternalInstances,
    syncTabInstances,
    openHome: loadHome,
    openDirectory: loadDirectory,
    openTrash: loadTrash,
    openDownloads: loadDownloads,
    goBack,
    goForward,
    goUp,
    refresh,
    setPresentationMode,
    selectEntry,
    selectTrashEntry,
    beginCreateDraft,
    updateCreateDraft,
    cancelCreateDraft,
    commitCreateDraft,
    moveSelectionToTrash,
    restoreSelectionFromTrash,
    emptyTrash,
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
    stopDownloadRemoteApi,
    toggleCurrentDirectoryFavorite,
    openDiskContextMenu,
    openDeviceContextMenu,
    openEntryContextMenu,
    openFavoriteContextMenu,
    openLocationContextMenu,
    openRecentLocationContextMenu,
    openTrashEntryContextMenu,
    openDirectoryContextMenu,
    openTrashContextMenu
  }), [
    addDownloadSaveRuleDraft,
    beginCreateDraft,
    cancelCreateDraft,
    commitCreateDraft,
    createInstance,
    getState,
    emptyTrash,
    ensureInstance,
    goBack,
    goForward,
    goUp,
    loadDirectory,
    loadDownloads,
    loadHome,
    loadTrash,
    importExternalBrowserDownloads,
    moveSelectionToTrash,
    cancelAllDownloads,
    cancelDownload,
    openDiskContextMenu,
    openDownloadedFile,
    openDeviceContextMenu,
    openDirectoryContextMenu,
    openEntryContextMenu,
    openFavoriteContextMenu,
    openLocationContextMenu,
    openRecentLocationContextMenu,
    openTrashContextMenu,
    openTrashEntryContextMenu,
    pauseDownload,
    pauseAllDownloads,
    refresh,
    removeDownload,
    removeDownloadSaveRuleDraft,
    resumeDownload,
    resumeAllDownloads,
    retryDownload,
    setDownloadPriority,
    setPresentationMode,
    saveDownloadSettings,
    startDownloadRemoteApi,
    stopDownloadRemoteApi,
    submitDownloadText,
    submitDownloadUrlDraft,
    revealDownloadedFile,
    restoreSelectionFromTrash,
    selectEntry,
    selectTrashEntry,
    syncExternalInstances,
    syncTabInstances,
    toggleDownloadSettings,
    toggleCurrentDirectoryFavorite,
    toggleDownloadAdvancedOptions,
    updateDownloadAdvancedDraft,
    updateDownloadSettingsDraft,
    updateDownloadSaveRuleDraft,
    updateDownloadUrlDraft,
    updateCreateDraft
  ]);

  return model;
};
