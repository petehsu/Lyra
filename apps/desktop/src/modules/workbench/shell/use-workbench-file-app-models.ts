import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { ContextMenuModel } from "../context-menu";
import { useFileEditorModel, type FileEditorModel } from "../file-editor";
import {
  useFileManagerModel,
  type FileManagerModel,
  type FileManagerSurfaceLabels
} from "../file-manager";
import { useImageViewerModel, type ImageViewerModel } from "../image-viewer";
import type { WorkspaceTabsModel } from "../workspace-tabs";

type WorkbenchFileAppModels = {
  readonly fileManagerModel: FileManagerModel;
  readonly fileEditorModel: FileEditorModel;
  readonly imageViewerModel: ImageViewerModel;
};

type UseWorkbenchFileAppModelsOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly contextMenuModel: ContextMenuModel;
  readonly fileManagerLabels: FileManagerSurfaceLabels;
  readonly tabsModel: WorkspaceTabsModel;
};

export const useWorkbenchFileAppModels = ({
  desktopApi,
  contextMenuModel,
  fileManagerLabels,
  tabsModel
}: UseWorkbenchFileAppModelsOptions): WorkbenchFileAppModels => {
  const fileManagerModel = useFileManagerModel({
    desktopApi,
    contextMenuModel,
    labels: fileManagerLabels,
    onMetaChange: tabsModel.updateAppTabMeta
  });
  const fileEditorModel = useFileEditorModel({
    desktopApi,
    onMetaChange: tabsModel.updateAppTabMeta
  });
  const imageViewerModel = useImageViewerModel({
    desktopApi,
    onMetaChange: tabsModel.updateAppTabMeta
  });

  return { fileManagerModel, fileEditorModel, imageViewerModel };
};
