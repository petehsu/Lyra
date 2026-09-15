import {
  Copy,
  FilePlus2,
  FolderPlus,
  FolderUp,
  Image,
  Terminal,
  Trash2
} from "@lyra/icons";
import { useCallback, type MouseEvent } from "react";

import { writeClipboardText } from "../../../shared/clipboard";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { ContextMenuItem, ContextMenuModel } from "../context-menu";
import type { GlobalDialogModel } from "../global-dialog";
import { isImageViewerSupportedPath } from "../image-viewer";
import type { AgentProjectTreeLabels, AgentProjectTreeModel } from "./types";
import {
  createParentPath,
  isValidEntryName,
  joinPath,
  parentDirectoryOf,
  relativeProjectPath
} from "./tree-paths";

export type ProjectTreeContextTarget = {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "directory";
};

export const useAgentProjectTreeContextMenu = ({
  desktopApi,
  labels,
  rootPath,
  instanceId,
  model,
  contextMenu,
  openDialog,
  onOpenFile,
  onOpenTerminal,
  onError,
  loadDirectory
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: AgentProjectTreeLabels;
  readonly rootPath: string;
  readonly instanceId: string;
  readonly model: AgentProjectTreeModel;
  readonly contextMenu: ContextMenuModel;
  readonly openDialog?: GlobalDialogModel["openDialog"];
  readonly onOpenFile?: (filePath: string) => void;
  readonly onOpenTerminal?: (cwd: string) => void;
  readonly onError: (message: string) => void;
  readonly loadDirectory: (path: string) => void;
}): ((
  event: MouseEvent<HTMLElement>,
  target: ProjectTreeContextTarget
) => void) => {
  const runCreate = useCallback(async (
    parentPath: string,
    kind: "file" | "directory",
    name: string
  ): Promise<void> => {
    if (desktopApi?.files === undefined || isValidEntryName(name) === false) {
      return;
    }
    const nextPath = joinPath(parentPath, name.trim());
    try {
      if (kind === "directory") {
        await desktopApi.files.createFolder({ parentPath, name: name.trim() });
        model.revealPath(instanceId, nextPath);
        loadDirectory(parentPath);
        return;
      }
      await desktopApi.files.createFile({ parentPath, name: name.trim() });
      loadDirectory(parentPath);
      await model.openFile(instanceId, nextPath);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }, [desktopApi, instanceId, loadDirectory, model, onError]);

  const openCreateDialog = useCallback((
    parentPath: string,
    kind: "file" | "directory"
  ): void => {
    if (openDialog === undefined) {
      return;
    }
    openDialog({
      title: kind === "directory" ? labels.createFolderTitle : labels.createFileTitle,
      input: {
        id: `create-${kind}`,
        label: kind === "directory" ? labels.createFolderPlaceholder : labels.createFilePlaceholder,
        placeholder: kind === "directory" ? labels.createFolderPlaceholder : labels.createFilePlaceholder,
        submitActionId: "create"
      },
      actions: [
        { id: "cancel", label: labels.cancelAction },
        {
          id: "create",
          label: labels.createConfirm,
          tone: "primary",
          onSelect: ({ inputValue }) => {
            void runCreate(parentPath, kind, inputValue ?? "");
          }
        }
      ]
    });
  }, [
    labels.cancelAction,
    labels.createConfirm,
    labels.createFilePlaceholder,
    labels.createFileTitle,
    labels.createFolderPlaceholder,
    labels.createFolderTitle,
    openDialog,
    runCreate
  ]);

  const openDeleteDialog = useCallback((target: ProjectTreeContextTarget): void => {
    if (openDialog === undefined) {
      return;
    }
    openDialog({
      title: labels.deleteConfirmTitle,
      description: labels.deleteConfirmDescription.replaceAll("{name}", target.name),
      source: {
        title: target.name,
        subtitle: target.path,
        iconTone: "danger"
      },
      actions: [
        { id: "cancel", label: labels.cancelAction },
        {
          id: "delete",
          label: labels.deleteConfirmAction,
          tone: "danger",
          onSelect: () => {
            if (desktopApi?.files === undefined) {
              return;
            }
            const parentPath = parentDirectoryOf(target.path);
            void desktopApi.files.moveToTrash({ paths: [target.path] }).then(() => {
              loadDirectory(parentPath);
            }).catch((error: unknown) => {
              onError(error instanceof Error ? error.message : String(error));
            });
          }
        }
      ]
    });
  }, [
    desktopApi,
    labels.cancelAction,
    labels.deleteConfirmAction,
    labels.deleteConfirmDescription,
    labels.deleteConfirmTitle,
    loadDirectory,
    onError,
    openDialog
  ]);

  return useCallback((
    event: MouseEvent<HTMLElement>,
    target: ProjectTreeContextTarget
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    model.revealPath(instanceId, target.path);
    const isRoot = target.path.replace(/[\\/]+$/u, "") === rootPath.replace(/[\\/]+$/u, "");
    const parentPath = createParentPath(target.path, target.kind);
    const terminalCwd = target.kind === "directory" ? target.path : parentDirectoryOf(target.path);
    const items: ContextMenuItem[] = [];

    if (openDialog !== undefined) {
      items.push(
        {
          id: "new-file",
          label: labels.newFile,
          icon: <FilePlus2 size={14} />,
          onSelect: () => {
            openCreateDialog(parentPath, "file");
          }
        },
        {
          id: "new-folder",
          label: labels.newFolder,
          icon: <FolderPlus size={14} />,
          onSelect: () => {
            openCreateDialog(parentPath, "directory");
          }
        }
      );
    }

    items.push({
      id: "reveal",
      label: labels.revealInFolder,
      icon: <FolderUp size={14} />,
      separatorBefore: items.length > 0,
      onSelect: () => {
        void desktopApi?.revealInFolder?.(target.path);
      }
    });

    if (
      target.kind === "file" &&
      onOpenFile !== undefined &&
      isImageViewerSupportedPath(target.path)
    ) {
      items.push({
        id: "image-preview",
        label: labels.openInImagePreview,
        icon: <Image size={14} />,
        onSelect: () => {
          onOpenFile(target.path);
        }
      });
    }

    if (onOpenTerminal !== undefined) {
      items.push({
        id: "terminal",
        label: labels.openInTerminal,
        icon: <Terminal size={14} />,
        onSelect: () => {
          onOpenTerminal(terminalCwd);
        }
      });
    }

    items.push(
      {
        id: "copy-path",
        label: labels.copyPath,
        icon: <Copy size={14} />,
        separatorBefore: true,
        onSelect: () => {
          void writeClipboardText(target.path);
        }
      },
      {
        id: "copy-relative-path",
        label: labels.copyRelativePath,
        icon: <Copy size={14} />,
        onSelect: () => {
          void writeClipboardText(relativeProjectPath(rootPath, target.path));
        }
      }
    );

    if (isRoot === false && openDialog !== undefined) {
      items.push({
        id: "delete",
        label: labels.moveToTrash,
        icon: <Trash2 size={14} />,
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          openDeleteDialog(target);
        }
      });
    }

    contextMenu.openMenu({
      anchorX: event.clientX,
      anchorY: event.clientY,
      items
    });
  }, [
    contextMenu,
    desktopApi,
    instanceId,
    labels.copyPath,
    labels.copyRelativePath,
    labels.moveToTrash,
    labels.newFile,
    labels.newFolder,
    labels.openInImagePreview,
    labels.openInTerminal,
    labels.revealInFolder,
    model,
    onOpenFile,
    onOpenTerminal,
    openCreateDialog,
    openDeleteDialog,
    openDialog,
    rootPath
  ]);
};
