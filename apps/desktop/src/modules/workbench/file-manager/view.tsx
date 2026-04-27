import {
  type DragEvent as ReactDragEvent,
  useEffect,
  useRef
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
import { useLoadingVisibility } from "../shell/use-loading-visibility";
import {
  deriveFileManagerSurfaceModel
} from "./surface-model";
import {
  FileManagerSurfaceView,
  type FileManagerSurfaceActions
} from "./surface-view";
import type {
  FileManagerAppState,
  FileManagerChooserMode,
  FileManagerModel,
  FileManagerSurfaceLabels
} from "./types";

export type FileManagerSurfaceProps = {
  readonly state: FileManagerAppState | null;
  readonly labels: FileManagerSurfaceLabels;
  readonly model: FileManagerModel;
  readonly onOpenFile: (filePath: string) => void;
  readonly chooser?: FileManagerChooserMode | null;
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

export const FileManagerSurface = ({
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

  if (state === null) {
    return null;
  }

  const renderModel = deriveFileManagerSurfaceModel(
    state,
    chooser,
    showLoadingSkeleton
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
      void model.goBack(state.instanceId);
    },
    onGoForward: () => {
      void model.goForward(state.instanceId);
    },
    onGoUp: () => {
      void model.goUp(state.instanceId);
    },
    onRefresh: () => {
      void model.refresh(state.instanceId);
    },
    onOpenBreadcrumb: (path) => {
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
      void model.openHome(state.instanceId);
    },
    onOpenLocation: (location) => {
      if (location.specialId === "trash") {
        void model.openTrash(state.instanceId);
        return;
      }
      if (location.path !== undefined) {
        void model.openDirectory(state.instanceId, location.path);
      }
    },
    onOpenDirectoryPath: (path) => {
      void model.openDirectory(state.instanceId, path);
    },
    onOpenDisk: (disk) => {
      void model.openDirectory(state.instanceId, disk.mountPath);
    },
    onOpenRecentLocation: (recent) => {
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
    }
  };

  return (
    <FileManagerSurfaceView
      renderModel={renderModel}
      labels={labels}
      actions={actions}
    />
  );
};
