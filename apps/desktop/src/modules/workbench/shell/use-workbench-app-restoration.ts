import { useEffect, useRef } from "react";

import type { FileEditorModel } from "../file-editor";
import type { FileManagerModel } from "../file-manager";
import type { ImageViewerModel } from "../image-viewer";
import type { WorkspaceTab, WorkspaceTabsModel } from "../workspace-tabs/types";

type UseWorkbenchAppRestorationParams = {
  readonly activeTab: WorkspaceTab | undefined;
  readonly tabsModel: WorkspaceTabsModel;
  readonly fileManagerModel: FileManagerModel;
  readonly fileEditorModel: FileEditorModel;
  readonly imageViewerModel: ImageViewerModel;
};

export const useWorkbenchAppRestoration = ({
  activeTab,
  tabsModel,
  fileManagerModel,
  fileEditorModel,
  imageViewerModel
}: UseWorkbenchAppRestorationParams): void => {
  const restoredFileManagerInstanceIdsRef = useRef<Set<string>>(new Set());
  const restoredFileEditorInstanceIdsRef = useRef<Set<string>>(new Set());
  const restoredImageViewerInstanceIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const fileManagerTabs = tabsModel.tabs
      .filter(
        (tab) =>
          tab.pageKind === "app" &&
          tab.appId === "file-manager" &&
          tab.appInstanceId !== undefined
      );
    const fileManagerInstanceIds = fileManagerTabs
      .map((tab) => tab.appInstanceId as string);
    fileManagerModel.syncTabInstances(fileManagerInstanceIds);

    for (const tab of fileManagerTabs) {
      const instanceId = tab.appInstanceId;
      if (
        instanceId === undefined ||
        restoredFileManagerInstanceIdsRef.current.has(instanceId)
      ) {
        continue;
      }

      restoredFileManagerInstanceIdsRef.current.add(instanceId);
      if (fileManagerModel.getState(instanceId) !== null) {
        continue;
      }
      fileManagerModel.ensureInstance(instanceId);
      if (typeof tab.filePath === "string" && tab.filePath.trim().length > 0) {
        void fileManagerModel.openDirectory(instanceId, tab.filePath, false);
      } else {
        void fileManagerModel.openHome(instanceId, false);
      }
    }

    const activeIds = new Set(fileManagerInstanceIds);
    for (const instanceId of [...restoredFileManagerInstanceIdsRef.current]) {
      if (activeIds.has(instanceId) === false) {
        restoredFileManagerInstanceIdsRef.current.delete(instanceId);
      }
    }
  }, [
    fileManagerModel.syncTabInstances,
    fileManagerModel.getState,
    fileManagerModel.ensureInstance,
    fileManagerModel.openDirectory,
    fileManagerModel.openHome,
    tabsModel.tabs
  ]);

  useEffect(() => {
    const imageViewerTabs = tabsModel.tabs
      .filter(
        (tab) =>
          tab.pageKind === "app" &&
          tab.appId === "image-viewer" &&
          tab.appInstanceId !== undefined
      );
    const imageViewerInstanceIds = imageViewerTabs
      .map((tab) => tab.appInstanceId as string);
    imageViewerModel.syncTabInstances(imageViewerInstanceIds);

    for (const tab of imageViewerTabs) {
      const instanceId = tab.appInstanceId;
      if (
        instanceId === undefined ||
        restoredImageViewerInstanceIdsRef.current.has(instanceId)
      ) {
        continue;
      }
      if (tab.filePath === undefined || tab.filePath.trim().length === 0) {
        continue;
      }

      restoredImageViewerInstanceIdsRef.current.add(instanceId);
      if (imageViewerModel.getState(instanceId) !== null) {
        continue;
      }
      imageViewerModel.ensureInstance(instanceId, {
        filePath: tab.filePath
      });
      void imageViewerModel.openImage(instanceId, tab.filePath);
    }

    const activeIds = new Set(imageViewerInstanceIds);
    for (const instanceId of [...restoredImageViewerInstanceIdsRef.current]) {
      if (activeIds.has(instanceId) === false) {
        restoredImageViewerInstanceIdsRef.current.delete(instanceId);
      }
    }
  }, [
    imageViewerModel.syncTabInstances,
    imageViewerModel.getState,
    imageViewerModel.ensureInstance,
    imageViewerModel.openImage,
    tabsModel.tabs
  ]);

  useEffect(() => {
    const fileEditorTabs = tabsModel.tabs
      .filter(
        (tab) =>
          tab.pageKind === "app" &&
          tab.appId === "file-editor" &&
          tab.appInstanceId !== undefined
      );
    const fileEditorInstanceIds = fileEditorTabs
      .map((tab) => tab.appInstanceId as string);
    fileEditorModel.syncTabInstances(fileEditorInstanceIds);

    for (const tab of fileEditorTabs) {
      const instanceId = tab.appInstanceId;
      if (
        instanceId === undefined ||
        restoredFileEditorInstanceIdsRef.current.has(instanceId)
      ) {
        continue;
      }
      if (tab.filePath === undefined || tab.filePath.trim().length === 0) {
        continue;
      }

      restoredFileEditorInstanceIdsRef.current.add(instanceId);
      if (fileEditorModel.getState(instanceId) !== null) {
        continue;
      }
      fileEditorModel.ensureInstance(instanceId, {
        filePath: tab.filePath,
        ...(tab.fileSessionId === undefined
          ? {}
          : { fileSessionId: tab.fileSessionId })
      });
      void fileEditorModel.hydrateIfNeeded(instanceId);
    }

    const activeIds = new Set(fileEditorInstanceIds);
    for (const instanceId of [...restoredFileEditorInstanceIdsRef.current]) {
      if (activeIds.has(instanceId) === false) {
        restoredFileEditorInstanceIdsRef.current.delete(instanceId);
      }
    }
  }, [
    fileEditorModel.syncTabInstances,
    fileEditorModel.getState,
    fileEditorModel.ensureInstance,
    fileEditorModel.hydrateIfNeeded,
    tabsModel.tabs
  ]);

  useEffect(() => {
    if (
      activeTab?.pageKind === "app" &&
      activeTab.appId === "file-editor" &&
      activeTab.appInstanceId !== undefined
    ) {
      fileEditorModel.touchInstance(activeTab.appInstanceId);
      void fileEditorModel.hydrateIfNeeded(activeTab.appInstanceId);
    }
  }, [activeTab?.appId, activeTab?.appInstanceId, activeTab?.pageKind, fileEditorModel]);

  useEffect(() => {
    if (
      activeTab?.pageKind === "app" &&
      activeTab.appId === "image-viewer" &&
      activeTab.appInstanceId !== undefined
    ) {
      imageViewerModel.touchInstance(activeTab.appInstanceId);
    }
  }, [activeTab?.appId, activeTab?.appInstanceId, activeTab?.pageKind, imageViewerModel]);
};
