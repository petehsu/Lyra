import type { DragEvent as ReactDragEvent } from "react";

import type {
  FileManagerDevice,
  FileManagerDisk,
  FileManagerEntry,
  FileManagerFavorite,
  FileManagerLocation,
  FileManagerRecentLocation,
  FileManagerTrashEntry
} from "../../../shared/file-manager";
import type { DownloadManagerPriority } from "../../../shared/download-manager";
import type { FileManagerSurfaceRenderModel } from "./surface-model";
import type {
  FileManagerCreateDraftKind,
  FileManagerDownloadAdvancedDraft,
  FileManagerDownloadSaveRuleDraft,
  FileManagerDownloadSettingsDraft,
  FileManagerPresentationMode,
  FileManagerSearchIndexModel,
  FileManagerSurfaceLabels
} from "./types";

export type FileManagerSurfaceActions = {
  readonly onGoBack: () => void;
  readonly onGoForward: () => void;
  readonly onGoUp: () => void;
  readonly onRefresh: () => void;
  readonly onOpenBreadcrumb: (path: string) => void;
  readonly onSetPresentationMode: (mode: FileManagerPresentationMode) => void;
  readonly onToggleFavorite: () => void;
  readonly onBeginCreateDraft: (kind: FileManagerCreateDraftKind) => void;
  readonly onMoveSelectionToTrash: () => void;
  readonly onRestoreSelectionFromTrash: () => void;
  readonly onEmptyTrash: () => void;
  readonly onOpenHome: () => void;
  readonly onOpenFavorites: () => void;
  readonly onOpenDownloads: () => void;
  readonly onOpenLocation: (location: FileManagerLocation) => void;
  readonly onOpenDirectoryPath: (path: string) => void;
  readonly onOpenDisk: (disk: FileManagerDisk) => void;
  readonly onOpenRecentLocation: (recent: FileManagerRecentLocation) => void;
  readonly onOpenFavorite: (favorite: FileManagerFavorite) => void;
  readonly onFavoriteContextMenu: (
    favorite: FileManagerFavorite,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly onLocationContextMenu: (
    location: FileManagerLocation,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly onDiskContextMenu: (
    disk: FileManagerDisk,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly onDeviceContextMenu: (
    device: FileManagerDevice,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly onRecentLocationContextMenu: (
    recent: FileManagerRecentLocation,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly onContentContextMenu: (anchorX: number, anchorY: number) => void;
  readonly onDraftValueChange: (value: string) => void;
  readonly onCommitCreateDraft: () => void;
  readonly onCancelCreateDraft: () => void;
  readonly onSelectEntry: (entryId: string) => void;
  readonly onOpenEntry: (entry: FileManagerEntry) => void;
  readonly onEntryContextMenu: (
    entryId: string,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly onDirectoryEntryDragStart: (
    event: ReactDragEvent<HTMLButtonElement>,
    entry: FileManagerEntry
  ) => void;
  readonly onSelectTrashEntry: (entryId: string) => void;
  readonly onTrashEntryContextMenu: (
    entryId: string,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly onTrashEntryDragStart: (
    event: ReactDragEvent<HTMLButtonElement>,
    entry: FileManagerTrashEntry
  ) => void;
  readonly onEntryDragEnd: () => void;
  readonly onConfirmChooser: () => void;
  readonly onDownloadUrlDraftChange: (value: string) => void;
  readonly onToggleDownloadAdvancedOptions: () => void;
  readonly onDownloadAdvancedDraftChange: (
    patch: Partial<FileManagerDownloadAdvancedDraft>
  ) => void;
  readonly onSubmitDownloadUrlDraft: () => void;
  readonly onImportDownloadUrlsFromClipboard: () => void;
  readonly onImportExternalBrowserDownloads: () => void;
  readonly onPauseDownload: (taskId: string) => void;
  readonly onResumeDownload: (taskId: string) => void;
  readonly onCancelDownload: (taskId: string) => void;
  readonly onRetryDownload: (taskId: string) => void;
  readonly onRemoveDownload: (taskId: string) => void;
  readonly onSetDownloadPriority: (taskId: string, priority: DownloadManagerPriority) => void;
  readonly onPauseAllDownloads: () => void;
  readonly onResumeAllDownloads: () => void;
  readonly onCancelAllDownloads: () => void;
  readonly onOpenDownloadedFile: (taskId: string) => void;
  readonly onRevealDownloadedFile: (taskId: string) => void;
  readonly onToggleDownloadSettings: () => void;
  readonly onDownloadSettingsDraftChange: (
    patch: Partial<FileManagerDownloadSettingsDraft>
  ) => void;
  readonly onAddDownloadSaveRule: () => void;
  readonly onRemoveDownloadSaveRule: (ruleId: string) => void;
  readonly onDownloadSaveRuleDraftChange: (
    ruleId: string,
    patch: Partial<FileManagerDownloadSaveRuleDraft>
  ) => void;
  readonly onSaveDownloadSettings: () => void;
  readonly onStartDownloadRemoteApi: () => void;
  readonly onStopDownloadRemoteApi: () => void;
  readonly onRebuildSearchIndex: () => void;
};

export type FileManagerSurfaceViewProps = {
  readonly renderModel: FileManagerSurfaceRenderModel;
  readonly labels: FileManagerSurfaceLabels;
  readonly actions: FileManagerSurfaceActions;
  readonly searchIndex: FileManagerSearchIndexModel;
};
