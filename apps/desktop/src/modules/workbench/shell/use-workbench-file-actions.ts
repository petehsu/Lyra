import { useCallback, useMemo } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { FileEditorModel, FileEditorRevealLocation } from "../file-editor";
import type { FileManagerModel } from "../file-manager";
import type { ImageViewerModel } from "../image-viewer";
import { isImageViewerSupportedPath } from "../image-viewer";
import type { WorkspaceTab, WorkspaceTabsModel } from "../workspace-tabs/types";

export type WorkbenchOpenFileOptions = {
  readonly forceReloadIfOpen?: boolean;
  readonly allowMissing?: boolean;
};

export type WorkbenchOpenFileFromManager = (
  filePath: string,
  location?: FileEditorRevealLocation,
  options?: WorkbenchOpenFileOptions
) => string | null;

type UseWorkbenchFileActionsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly activeTab: WorkspaceTab | undefined;
  readonly tabsModel: WorkspaceTabsModel;
  readonly fileManagerModel: FileManagerModel;
  readonly fileEditorModel: FileEditorModel;
  readonly imageViewerModel: ImageViewerModel;
};

export type WorkbenchFileActions = {
  readonly onOpenFileFromManager: WorkbenchOpenFileFromManager;
  readonly onRevealPathInFileManager: (filePath: string) => Promise<void>;
  readonly openDirectoryFromNavigation: (path: string) => Promise<void>;
};

type WorkbenchPathKind = "file" | "directory" | "missing" | "unknown";

const parentPathFor = (filePath: string): string => {
  const slashIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slashIndex <= 0) {
    return filePath;
  }
  return filePath.slice(0, slashIndex);
};

const resolvePathKind = async (
  desktopApi: LyraDesktopApi | null,
  filePath: string
): Promise<WorkbenchPathKind> => {
  try {
    const stat = await desktopApi?.files.statFile({ path: filePath });
    if (stat === undefined) {
      return "unknown";
    }
    if (stat.exists === false) {
      return "missing";
    }
    return stat.isDirectory ? "directory" : "file";
  } catch {
    return "unknown";
  }
};

export const useWorkbenchFileActions = ({
  desktopApi,
  activeTab,
  tabsModel,
  fileManagerModel,
  fileEditorModel,
  imageViewerModel
}: UseWorkbenchFileActionsParams): WorkbenchFileActions => {
  const openDirectoryInFileManager = useCallback(async (
    directoryPath: string,
    addToHistory = false
  ): Promise<string> => {
    const activeFileManagerTab =
      activeTab?.pageKind === "app" &&
      activeTab.appId === "file-manager" &&
      activeTab.appInstanceId !== undefined
        ? activeTab
        : undefined;
    const existingFileManagerTab = activeFileManagerTab ?? tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === "file-manager" &&
        tab.appInstanceId !== undefined
    );

    if (existingFileManagerTab?.appInstanceId !== undefined) {
      fileManagerModel.ensureInstance(existingFileManagerTab.appInstanceId);
      tabsModel.setActiveTab(existingFileManagerTab.id);
      await fileManagerModel.openDirectory(
        existingFileManagerTab.appInstanceId,
        directoryPath,
        addToHistory
      );
      return existingFileManagerTab.appInstanceId;
    }

    const instance = fileManagerModel.createInstance();
    tabsModel.openAppTab(instance);
    await fileManagerModel.openDirectory(instance.appInstanceId, directoryPath, addToHistory);
    return instance.appInstanceId;
  }, [activeTab, fileManagerModel, tabsModel]);

  const onOpenFileFromManager = useCallback<WorkbenchOpenFileFromManager>(
    (filePath, location, options) => {
      if (options?.allowMissing !== true && isImageViewerSupportedPath(filePath)) {
        const existingInstanceId = imageViewerModel.findInstanceByPath(filePath);
        const existingTab = tabsModel.tabs.find(
          (tab) =>
            tab.pageKind === "app" &&
            tab.appId === "image-viewer" &&
            tab.appInstanceId !== undefined &&
            (existingInstanceId !== null
              ? tab.appInstanceId === existingInstanceId
              : tab.filePath === filePath)
        );
        if (existingTab !== undefined) {
          tabsModel.setActiveTab(existingTab.id);
          if (existingTab.appInstanceId !== undefined) {
            void imageViewerModel.openImage(existingTab.appInstanceId, filePath);
            return existingTab.appInstanceId;
          }
          return null;
        }

        const nextViewer = imageViewerModel.createInstance(filePath);
        tabsModel.openAppTab(nextViewer);
        void imageViewerModel.openImage(nextViewer.appInstanceId, filePath);
        return nextViewer.appInstanceId;
      }

      const ensureMissingPlaceholderHydrated = (instanceId: string): void => {
        const state = fileEditorModel.getState(instanceId);
        if (state === null || state.isHydrated) {
          return;
        }
        fileEditorModel.applyExternalContent(instanceId, state.content, {
          markHydrated: true
        });
      };
      const existingInstanceId = fileEditorModel.findInstanceByPath(filePath);
      const existingTab = tabsModel.tabs.find(
        (tab) =>
          tab.pageKind === "app" &&
          tab.appId === "file-editor" &&
          tab.appInstanceId !== undefined &&
          (existingInstanceId !== null
            ? tab.appInstanceId === existingInstanceId
            : tab.filePath === filePath)
      );
      if (existingTab !== undefined) {
        tabsModel.setActiveTab(existingTab.id);
        if (existingTab.appInstanceId !== undefined) {
          const state = fileEditorModel.getState(existingTab.appInstanceId);
          const allowMissing = options?.allowMissing === true;
          const shouldReload =
            allowMissing === false &&
            options?.forceReloadIfOpen === true &&
            state !== null &&
            state.isDirty === false;
          if (allowMissing) {
            fileEditorModel.ensureInstance(existingTab.appInstanceId, {
              filePath
            });
            ensureMissingPlaceholderHydrated(existingTab.appInstanceId);
          } else if (shouldReload) {
            void fileEditorModel.openFile(existingTab.appInstanceId, filePath);
          } else {
            void fileEditorModel.hydrateIfNeeded(existingTab.appInstanceId);
          }
          if (location !== undefined) {
            fileEditorModel.revealLocation(existingTab.appInstanceId, location);
          }
          return existingTab.appInstanceId;
        }
        return null;
      }

      const nextEditor = fileEditorModel.createInstance(filePath);
      tabsModel.openAppTab(nextEditor);
      if (options?.allowMissing === true) {
        fileEditorModel.ensureInstance(nextEditor.appInstanceId, {
          filePath
        });
        ensureMissingPlaceholderHydrated(nextEditor.appInstanceId);
      } else {
        void fileEditorModel.openFile(nextEditor.appInstanceId, filePath);
      }
      if (location !== undefined) {
        fileEditorModel.revealLocation(nextEditor.appInstanceId, location);
      }
      return nextEditor.appInstanceId;
    },
    [fileEditorModel, imageViewerModel, tabsModel]
  );

  const onRevealPathInFileManager = useCallback(async (filePath: string): Promise<void> => {
    const normalized = filePath.trim();
    if (normalized.length === 0) {
      return;
    }

    const pathKind = await resolvePathKind(desktopApi, normalized);
    if (pathKind === "directory") {
      await openDirectoryInFileManager(normalized, false);
      return;
    }

    const parentPath = parentPathFor(normalized);
    const appInstanceId = await openDirectoryInFileManager(parentPath, false);
    const state = fileManagerModel.getState(appInstanceId);
    const entry = state?.entries.find((item) => item.path === normalized);
    if (entry !== undefined) {
      fileManagerModel.selectEntry(appInstanceId, entry.id);
    }
  }, [desktopApi, fileManagerModel, openDirectoryInFileManager]);

  const openDirectoryFromNavigation = useCallback(async (path: string): Promise<void> => {
    const normalizedPath = path.trim();
    if (normalizedPath.length === 0) {
      return;
    }
    await openDirectoryInFileManager(normalizedPath, false);
  }, [openDirectoryInFileManager]);

  return useMemo(
    () => ({
      onOpenFileFromManager,
      onRevealPathInFileManager,
      openDirectoryFromNavigation
    }),
    [onOpenFileFromManager, onRevealPathInFileManager, openDirectoryFromNavigation]
  );
};
