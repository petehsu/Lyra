import {
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  clearFileManagerEntryDragPayload,
  type FileManagerEntryDragPayload,
  writeFileManagerEntryDragPayload
} from "./drag-transfer";
import { resolveFileManagerEntryIconKind } from "./entry-icon-classifier";
import type {
  FileManagerEntry,
  FileManagerTrashEntry
} from "../../../shared/file-manager";
import type {
  LyraDesktopApi,
  SearchIndexStatusResponse
} from "../../../shared/desktop-bridge";
import { useLoadingVisibility } from "../shell/use-loading-visibility";
import {
  deriveFileManagerSurfaceModel
} from "./surface-model";
import {
  FileManagerSurfaceView,
  type FileManagerSurfaceActions
} from "./surface-view";
import { FileManagerToolbarContent } from "./surface-toolbar";
import type {
  FileManagerAppState,
  FileManagerChooserMode,
  FileManagerModel,
  FileManagerSearchIndexModel,
  FileManagerSurfaceLabels
} from "./types";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";

export type FileManagerSurfaceProps = {
  readonly desktopApi?: LyraDesktopApi | null;
  readonly state: FileManagerAppState | null;
  readonly labels: FileManagerSurfaceLabels;
  readonly model: FileManagerModel;
  readonly onOpenFile: (filePath: string) => void;
  readonly chooser?: FileManagerChooserMode | null;
};

const SEARCH_INDEX_ACTIVE_POLL_INTERVAL_MS = 2_000;
const SEARCH_INDEX_READY_POLL_INTERVAL_MS = 15_000;

type FileManagerSearchIndexRuntime = FileManagerSearchIndexModel & {
  readonly rebuildSearchIndex: () => Promise<void>;
};

const useFileManagerSearchIndexStatus = (
  desktopApi: LyraDesktopApi | null | undefined
): FileManagerSearchIndexRuntime => {
  const searchApi = desktopApi?.search;
  const [status, setStatus] = useState<SearchIndexStatusResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    if (searchApi === undefined) {
      setStatus(null);
      setErrorMessage(undefined);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;

    const poll = async (): Promise<void> => {
      let nextState: SearchIndexStatusResponse["state"] | undefined;
      try {
        const nextStatus = await searchApi.readIndexStatus();
        nextState = nextStatus.state;
        if (cancelled) {
          return;
        }
        setStatus(nextStatus);
        setErrorMessage(undefined);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(() => {
            void poll();
          }, nextState === "ready" ? SEARCH_INDEX_READY_POLL_INTERVAL_MS : SEARCH_INDEX_ACTIVE_POLL_INTERVAL_MS);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [searchApi]);

  const rebuildSearchIndex = useCallback(async (): Promise<void> => {
    if (searchApi === undefined || rebuilding) {
      return;
    }
    setRebuilding(true);
    try {
      const response = await searchApi.rebuildIndex();
      setStatus(response.status);
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRebuilding(false);
    }
  }, [rebuilding, searchApi]);

  return useMemo(
    () => ({
      status,
      errorMessage,
      rebuilding,
      rebuildSearchIndex
    }),
    [errorMessage, rebuildSearchIndex, rebuilding, status]
  );
};

const toDirectoryEntryDragPayload = (
  entry: FileManagerEntry
): FileManagerEntryDragPayload => ({
  name: entry.name,
  kind: entry.kind,
  source: "directory",
  path: entry.path,
  iconKind: resolveFileManagerEntryIconKind(entry)
});

const toTrashEntryDragPayload = (
  entry: FileManagerTrashEntry
): FileManagerEntryDragPayload => ({
  name: entry.name,
  kind: entry.kind,
  source: "trash",
  iconKind: resolveFileManagerEntryIconKind(entry),
  ...(entry.originalPath === undefined
    ? entry.trashedPath === undefined
      ? {}
      : { path: entry.trashedPath }
    : { path: entry.originalPath })
});

const createFileManagerDragPreview = (
  documentRef: Document,
  label: string
): HTMLDivElement => {
  const preview = documentRef.createElement("div");
  preview.className = "lyra-file-manager-drag-preview";
  preview.textContent = label;
  documentRef.body.append(preview);
  return preview;
};

const FileManagerTitlebarBridge = ({
  renderModel,
  labels,
  actions,
  searchIndex
}: {
  readonly renderModel: ReturnType<typeof deriveFileManagerSurfaceModel>;
  readonly labels: FileManagerSurfaceLabels;
  readonly actions: FileManagerSurfaceActions;
  readonly searchIndex: FileManagerSearchIndexModel;
}) => {
  const contribution = useMemo(
    () => ({
      ariaLabel: labels.title,
      content: (
        <FileManagerToolbarContent
          renderModel={renderModel}
          labels={labels}
          actions={actions}
          searchIndex={searchIndex}
        />
      )
    }),
    [actions, labels, renderModel, searchIndex]
  );
  useWorkbenchTitlebarContribution(contribution);
  return null;
};

export const FileManagerSurface = ({
  desktopApi,
  state,
  labels,
  model,
  onOpenFile,
  chooser
}: FileManagerSurfaceProps) => {
  const isLoading = state?.status === "loading";
  const showLoadingSkeleton = useLoadingVisibility(isLoading, {
    showDelayMs: 120,
    minVisibleMs: 180
  });
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const [pageKindOverride, setPageKindOverride] = useState<"favorites" | null>(null);
  const searchIndex = useFileManagerSearchIndexStatus(desktopApi);

  const clearEntryDragPreview = (): void => {
    const currentPreview = dragPreviewRef.current;
    if (currentPreview === null) {
      return;
    }
    dragPreviewRef.current = null;
    currentPreview.remove();
  };

  useEffect(
    () => () => {
      clearEntryDragPreview();
    },
    []
  );

  useEffect(() => {
    setPageKindOverride(null);
  }, [state?.instanceId]);

  if (state === null) {
    return null;
  }

  const renderModel = deriveFileManagerSurfaceModel(
    state,
    chooser,
    showLoadingSkeleton,
    pageKindOverride ?? state.viewKind
  );

  const onEntryDragEnd = (): void => {
    clearEntryDragPreview();
    clearFileManagerEntryDragPayload();
  };

  const applyEntryDragImage = (
    event: ReactDragEvent<HTMLButtonElement>,
    label: string
  ): void => {
    clearEntryDragPreview();
    const preview = createFileManagerDragPreview(
      event.currentTarget.ownerDocument,
      label
    );
    dragPreviewRef.current = preview;
    event.dataTransfer.setDragImage(preview, 14, 12);
  };

  const actions: FileManagerSurfaceActions = {
    onGoBack: () => {
      setPageKindOverride(null);
      void model.goBack(state.instanceId);
    },
    onGoForward: () => {
      setPageKindOverride(null);
      void model.goForward(state.instanceId);
    },
    onGoUp: () => {
      setPageKindOverride(null);
      void model.goUp(state.instanceId);
    },
    onRefresh: () => {
      void model.refresh(state.instanceId);
    },
    onOpenBreadcrumb: (path) => {
      setPageKindOverride(null);
      void model.openDirectory(state.instanceId, path);
    },
    onSetPresentationMode: (mode) => {
      model.setPresentationMode(state.instanceId, mode);
    },
    onToggleFavorite: () => {
      void model.toggleCurrentDirectoryFavorite(state.instanceId);
    },
    onBeginCreateDraft: (kind) => {
      model.beginCreateDraft(state.instanceId, kind);
    },
    onMoveSelectionToTrash: () => {
      void model.moveSelectionToTrash(state.instanceId);
    },
    onRestoreSelectionFromTrash: () => {
      void model.restoreSelectionFromTrash(state.instanceId);
    },
    onEmptyTrash: () => {
      void model.emptyTrash(state.instanceId);
    },
    onOpenHome: () => {
      setPageKindOverride(null);
      void model.openHome(state.instanceId);
    },
    onOpenFavorites: () => {
      setPageKindOverride("favorites");
    },
    onOpenDownloads: () => {
      setPageKindOverride(null);
      void model.openDownloads(state.instanceId);
    },
    onOpenLocation: (location) => {
      setPageKindOverride(null);
      if (location.specialId === "trash") {
        void model.openTrash(state.instanceId);
        return;
      }
      if (location.specialId === "downloadManager") {
        void model.openDownloads(state.instanceId);
        return;
      }
      if (location.path !== undefined) {
        void model.openDirectory(state.instanceId, location.path);
      }
    },
    onOpenDirectoryPath: (path) => {
      setPageKindOverride(null);
      void model.openDirectory(state.instanceId, path);
    },
    onOpenDisk: (disk) => {
      setPageKindOverride(null);
      void model.openDirectory(state.instanceId, disk.mountPath);
    },
    onOpenRecentLocation: (recent) => {
      setPageKindOverride(null);
      void model.openDirectory(state.instanceId, recent.path);
    },
    onFavoriteContextMenu: (favorite, anchorX, anchorY) => {
      model.openFavoriteContextMenu(state.instanceId, favorite, anchorX, anchorY);
    },
    onLocationContextMenu: (location, anchorX, anchorY) => {
      model.openLocationContextMenu(state.instanceId, location, anchorX, anchorY);
    },
    onDiskContextMenu: (disk, anchorX, anchorY) => {
      model.openDiskContextMenu(state.instanceId, disk, anchorX, anchorY);
    },
    onDeviceContextMenu: (device, anchorX, anchorY) => {
      model.openDeviceContextMenu(state.instanceId, device, anchorX, anchorY);
    },
    onRecentLocationContextMenu: (recent, anchorX, anchorY) => {
      model.openRecentLocationContextMenu(state.instanceId, recent, anchorX, anchorY);
    },
    onContentContextMenu: (anchorX, anchorY) => {
      if (state.viewKind === "directory") {
        model.openDirectoryContextMenu(state.instanceId, anchorX, anchorY);
        return;
      }
      if (state.viewKind === "trash") {
        model.openTrashContextMenu(state.instanceId, anchorX, anchorY);
      }
    },
    onDraftValueChange: (value) => {
      model.updateCreateDraft(state.instanceId, value);
    },
    onCommitCreateDraft: () => {
      void model.commitCreateDraft(state.instanceId);
    },
    onCancelCreateDraft: () => {
      model.cancelCreateDraft(state.instanceId);
    },
    onSelectEntry: (entryId) => {
      model.selectEntry(state.instanceId, entryId);
    },
    onOpenEntry: (entry) => {
      if (entry.kind === "directory") {
        setPageKindOverride(null);
        void model.openDirectory(state.instanceId, entry.path);
        return;
      }
      onOpenFile(entry.path);
    },
    onEntryContextMenu: (entryId, anchorX, anchorY) => {
      model.openEntryContextMenu(state.instanceId, entryId, anchorX, anchorY);
    },
    onDirectoryEntryDragStart: (event, entry) => {
      applyEntryDragImage(event, entry.name);
      writeFileManagerEntryDragPayload(
        event.dataTransfer,
        toDirectoryEntryDragPayload(entry)
      );
    },
    onSelectTrashEntry: (entryId) => {
      model.selectTrashEntry(state.instanceId, entryId);
    },
    onTrashEntryContextMenu: (entryId, anchorX, anchorY) => {
      model.openTrashEntryContextMenu(state.instanceId, entryId, anchorX, anchorY);
    },
    onTrashEntryDragStart: (event, entry) => {
      applyEntryDragImage(event, entry.name);
      writeFileManagerEntryDragPayload(
        event.dataTransfer,
        toTrashEntryDragPayload(entry)
      );
    },
    onEntryDragEnd,
    onConfirmChooser: () => {
      if (renderModel.chooserBar?.canConfirm !== true) {
        return;
      }
      chooser?.onConfirm();
    },
    onDownloadUrlDraftChange: (value) => {
      model.updateDownloadUrlDraft(state.instanceId, value);
    },
    onToggleDownloadAdvancedOptions: () => {
      model.toggleDownloadAdvancedOptions(state.instanceId);
    },
    onDownloadAdvancedDraftChange: (patch) => {
      model.updateDownloadAdvancedDraft(state.instanceId, patch);
    },
    onSubmitDownloadUrlDraft: () => {
      void model.submitDownloadUrlDraft(state.instanceId);
    },
    onImportDownloadUrlsFromClipboard: () => {
      const clipboard = navigator.clipboard;
      if (clipboard === undefined) {
        return;
      }
      void clipboard.readText()
        .then((text) => {
          if (text.trim().length === 0) {
            return;
          }
          void model.submitDownloadText(state.instanceId, text);
        })
        .catch(() => undefined);
    },
    onImportExternalBrowserDownloads: () => {
      void model.importExternalBrowserDownloads(state.instanceId);
    },
    onPauseDownload: (taskId) => {
      void model.pauseDownload(taskId);
    },
    onResumeDownload: (taskId) => {
      void model.resumeDownload(taskId);
    },
    onCancelDownload: (taskId) => {
      void model.cancelDownload(taskId);
    },
    onRetryDownload: (taskId) => {
      void model.retryDownload(taskId);
    },
    onRemoveDownload: (taskId) => {
      void model.removeDownload(taskId);
    },
    onSetDownloadPriority: (taskId, priority) => {
      void model.setDownloadPriority(taskId, priority);
    },
    onPauseAllDownloads: () => {
      void model.pauseAllDownloads();
    },
    onResumeAllDownloads: () => {
      void model.resumeAllDownloads();
    },
    onCancelAllDownloads: () => {
      void model.cancelAllDownloads();
    },
    onOpenDownloadedFile: (taskId) => {
      void model.openDownloadedFile(taskId);
    },
    onRevealDownloadedFile: (taskId) => {
      void model.revealDownloadedFile(taskId);
    },
    onToggleDownloadSettings: () => {
      void model.toggleDownloadSettings(state.instanceId);
    },
    onDownloadSettingsDraftChange: (patch) => {
      model.updateDownloadSettingsDraft(state.instanceId, patch);
    },
    onAddDownloadSaveRule: () => {
      model.addDownloadSaveRuleDraft(state.instanceId);
    },
    onRemoveDownloadSaveRule: (ruleId) => {
      model.removeDownloadSaveRuleDraft(state.instanceId, ruleId);
    },
    onDownloadSaveRuleDraftChange: (ruleId, patch) => {
      model.updateDownloadSaveRuleDraft(state.instanceId, ruleId, patch);
    },
    onSaveDownloadSettings: () => {
      void model.saveDownloadSettings(state.instanceId);
    },
    onStartDownloadRemoteApi: () => {
      void model.startDownloadRemoteApi(state.instanceId);
    },
    onStopDownloadRemoteApi: () => {
      void model.stopDownloadRemoteApi(state.instanceId);
    },
    onRebuildSearchIndex: () => {
      void searchIndex.rebuildSearchIndex();
    }
  };
  return (
    <>
      <FileManagerTitlebarBridge
        renderModel={renderModel}
        labels={labels}
        actions={actions}
        searchIndex={searchIndex}
      />
      <FileManagerSurfaceView
        renderModel={renderModel}
        labels={labels}
        actions={actions}
        searchIndex={searchIndex}
      />
    </>
  );
};
