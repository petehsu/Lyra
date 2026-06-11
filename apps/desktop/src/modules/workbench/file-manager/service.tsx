import {
  useCallback,
  useMemo,
  useRef
} from "react";

import type {
  DownloadManagerRemoteApiStatus,
  DownloadManagerSettings,
  DownloadManagerTask
} from "../../../shared/download-manager";
import type {
  FileManagerAppState,
  FileManagerModel,
  UseFileManagerModelOptions
} from "./types";
import { useFileManagerContextMenusController } from "./context-menus";
import { useFileManagerDownloadsController } from "./downloads-controller";
import { useFileManagerFileActionsController } from "./file-actions-controller";
import { useFileManagerLocationController } from "./location-controller";
import { useFileManagerStateStore } from "./state-store";

export const useFileManagerModel = ({
  desktopApi,
  contextMenuModel,
  labels,
  onMetaChange
}: UseFileManagerModelOptions): FileManagerModel => {
  const downloadTasksRef = useRef<readonly DownloadManagerTask[]>([]);
  const downloadStatusRef = useRef<FileManagerAppState["downloadStatus"]>("idle");
  const downloadErrorMessageRef = useRef<string | undefined>(undefined);
  const downloadSettingsRef = useRef<DownloadManagerSettings | null>(null);
  const downloadRemoteApiStatusRef = useRef<DownloadManagerRemoteApiStatus | null>(null);
  const platform = desktopApi?.appMeta.platform ?? null;

  const getDownloadDefaults = useCallback(() => ({
    tasks: downloadTasksRef.current,
    status: downloadStatusRef.current,
    errorMessage: downloadErrorMessageRef.current,
    settings: downloadSettingsRef.current,
    remoteApiStatus: downloadRemoteApiStatusRef.current
  }), [
    downloadErrorMessageRef,
    downloadRemoteApiStatusRef,
    downloadSettingsRef,
    downloadStatusRef,
    downloadTasksRef
  ]);

  const unsubscribeDirectory = useCallback((subscriptionId: string | undefined) => {
    if (subscriptionId === undefined) {
      return;
    }
    void desktopApi?.files.unsubscribeDirectory?.(subscriptionId).catch(() => undefined);
  }, [desktopApi]);

  const handleStateRemoved = useCallback((state: FileManagerAppState) => {
    unsubscribeDirectory(state.directorySubscriptionId);
  }, [unsubscribeDirectory]);

  const store = useFileManagerStateStore({
    labels,
    getDownloadDefaults,
    onMetaChange,
    onStateRemoved: handleStateRemoved
  });

  const unsubscribeDirectoryForInstance = useCallback((instanceId: string) => {
    unsubscribeDirectory(store.statesRef.current[instanceId]?.directorySubscriptionId);
  }, [store.statesRef, unsubscribeDirectory]);

  const downloads = useFileManagerDownloadsController({
    desktopApi,
    labels,
    store,
    refs: {
      tasksRef: downloadTasksRef,
      statusRef: downloadStatusRef,
      errorMessageRef: downloadErrorMessageRef,
      settingsRef: downloadSettingsRef,
      remoteApiStatusRef: downloadRemoteApiStatusRef
    },
    unsubscribeDirectoryForInstance
  });

  const locations = useFileManagerLocationController({
    desktopApi,
    labels,
    platform,
    store,
    loadDownloads: downloads.loadDownloads,
    onMetaChange,
    unsubscribeDirectory,
    unsubscribeDirectoryForInstance
  });

  const fileActions = useFileManagerFileActionsController({
    desktopApi,
    platform,
    store,
    loadHome: locations.loadHome,
    loadDirectory: locations.loadDirectory,
    loadTrash: locations.loadTrash,
    refresh: locations.refresh
  });

  const contextMenus = useFileManagerContextMenusController({
    desktopApi,
    contextMenuModel,
    labels,
    platform,
    store,
    loadDirectory: locations.loadDirectory,
    openLocation: locations.openLocation,
    loadTrash: locations.loadTrash,
    refresh: locations.refresh,
    writeFavoritesForState: locations.writeFavoritesForState,
    isFavoritePath: locations.isFavoritePath,
    toggleFavoriteForLocation: locations.toggleFavoriteForLocation,
    toggleCurrentDirectoryFavorite: locations.toggleCurrentDirectoryFavorite,
    ejectDisk: fileActions.ejectDisk,
    ejectDevice: fileActions.ejectDevice,
    mountDevice: fileActions.mountDevice,
    selectEntry: fileActions.selectEntry,
    selectTrashEntry: fileActions.selectTrashEntry,
    beginCreateDraft: fileActions.beginCreateDraft,
    emptyTrash: fileActions.emptyTrash
  });

  const {
    createInstance,
    getState,
    ensureInstance,
    syncExternalInstances,
    syncTabInstances
  } = store;
  const {
    loadHome,
    loadDirectory,
    loadTrash,
    goBack,
    goForward,
    goUp,
    refresh,
    toggleCurrentDirectoryFavorite
  } = locations;
  const {
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
  } = downloads;
  const {
    setPresentationMode,
    selectEntry,
    selectTrashEntry,
    beginCreateDraft,
    updateCreateDraft,
    cancelCreateDraft,
    commitCreateDraft,
    moveSelectionToTrash,
    restoreSelectionFromTrash,
    emptyTrash
  } = fileActions;
  const {
    openDiskContextMenu,
    openDeviceContextMenu,
    openEntryContextMenu,
    openFavoriteContextMenu,
    openLocationContextMenu,
    openRecentLocationContextMenu,
    openTrashEntryContextMenu,
    openDirectoryContextMenu,
    openTrashContextMenu
  } = contextMenus;

  return useMemo<FileManagerModel>(() => ({
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
    cancelAllDownloads,
    cancelCreateDraft,
    cancelDownload,
    commitCreateDraft,
    createInstance,
    emptyTrash,
    ensureInstance,
    getState,
    goBack,
    goForward,
    goUp,
    importExternalBrowserDownloads,
    loadDirectory,
    loadDownloads,
    loadHome,
    loadTrash,
    moveSelectionToTrash,
    openDeviceContextMenu,
    openDirectoryContextMenu,
    openDiskContextMenu,
    openDownloadedFile,
    openEntryContextMenu,
    openFavoriteContextMenu,
    openLocationContextMenu,
    openRecentLocationContextMenu,
    openTrashContextMenu,
    openTrashEntryContextMenu,
    pauseAllDownloads,
    pauseDownload,
    refresh,
    removeDownload,
    removeDownloadSaveRuleDraft,
    resumeAllDownloads,
    resumeDownload,
    restoreSelectionFromTrash,
    retryDownload,
    revealDownloadedFile,
    saveDownloadSettings,
    selectEntry,
    selectTrashEntry,
    setDownloadPriority,
    setPresentationMode,
    startDownloadRemoteApi,
    stopDownloadRemoteApi,
    submitDownloadText,
    submitDownloadUrlDraft,
    syncExternalInstances,
    syncTabInstances,
    toggleCurrentDirectoryFavorite,
    toggleDownloadAdvancedOptions,
    toggleDownloadSettings,
    updateCreateDraft,
    updateDownloadAdvancedDraft,
    updateDownloadSaveRuleDraft,
    updateDownloadSettingsDraft,
    updateDownloadUrlDraft
  ]);
};
