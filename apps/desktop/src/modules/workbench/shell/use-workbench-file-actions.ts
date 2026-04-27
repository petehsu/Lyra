import { useCallback, useMemo } from "react";

import type { FileEditorModel, FileEditorRevealLocation } from "../file-editor";
import type { FileManagerModel } from "../file-manager";
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
  readonly activeTab: WorkspaceTab | undefined;
  readonly tabsModel: WorkspaceTabsModel;
  readonly fileManagerModel: FileManagerModel;
  readonly fileEditorModel: FileEditorModel;
};

export type WorkbenchFileActions = {
  readonly onOpenFileFromManager: WorkbenchOpenFileFromManager;
  readonly onRevealPathInFileManager: (filePath: string) => Promise<void>;
  readonly openDirectoryFromNavigation: (path: string) => Promise<void>;
};

export const useWorkbenchFileActions = ({
  activeTab,
  tabsModel,
  fileManagerModel,
  fileEditorModel
}: UseWorkbenchFileActionsParams): WorkbenchFileActions => {
  const onOpenFileFromManager = useCallback<WorkbenchOpenFileFromManager>(
    (filePath, location, options) => {
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
      } else {
        void fileEditorModel.openFile(nextEditor.appInstanceId, filePath);
      }
      if (location !== undefined) {
        fileEditorModel.revealLocation(nextEditor.appInstanceId, location);
      }
      return nextEditor.appInstanceId;
    },
    [fileEditorModel, tabsModel]
  );

  const onRevealPathInFileManager = useCallback(async (filePath: string): Promise<void> => {
    const normalized = filePath.trim();
    if (normalized.length === 0) {
      return;
    }
    const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    const parentPath = slashIndex <= 0 ? normalized : normalized.slice(0, slashIndex);
    const instance = fileManagerModel.createInstance();
    tabsModel.openAppTab(instance);
    await fileManagerModel.openDirectory(instance.appInstanceId, parentPath);
    const state = fileManagerModel.getState(instance.appInstanceId);
    const entry = state?.entries.find((item) => item.path === normalized);
    if (entry !== undefined) {
      fileManagerModel.selectEntry(instance.appInstanceId, entry.id);
    }
  }, [fileManagerModel, tabsModel]);

  const openDirectoryFromNavigation = useCallback(async (path: string): Promise<void> => {
    const normalizedPath = path.trim();
    if (normalizedPath.length === 0) {
      return;
    }

    if (
      activeTab?.pageKind === "app" &&
      activeTab.appId === "file-manager" &&
      activeTab.appInstanceId !== undefined
    ) {
      tabsModel.setActiveTab(activeTab.id);
      await fileManagerModel.openDirectory(activeTab.appInstanceId, normalizedPath, false);
      return;
    }

    const instance = fileManagerModel.createInstance();
    tabsModel.openAppTab(instance);
    await fileManagerModel.openDirectory(instance.appInstanceId, normalizedPath, false);
  }, [activeTab, fileManagerModel, tabsModel]);

  return useMemo(
    () => ({
      onOpenFileFromManager,
      onRevealPathInFileManager,
      openDirectoryFromNavigation
    }),
    [onOpenFileFromManager, onRevealPathInFileManager, openDirectoryFromNavigation]
  );
};
