import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { FileEditorModel } from "../file-editor";
import type { FileManagerModel } from "../file-manager";
import { useSettingsAiModel } from "../settings-ai";
import type { WorkspaceTab } from "../workspace-tabs/types";
import type { WorkbenchLabels } from "./use-workbench-labels";

type UseWorkbenchActiveAppContextParams = {
  readonly activeTab: WorkspaceTab | undefined;
  readonly desktopApi: LyraDesktopApi | null;
  readonly fileManagerModel: FileManagerModel;
  readonly fileEditorModel: FileEditorModel;
  readonly labels: WorkbenchLabels;
  readonly onOpenJcodeConfigFile?: (filePath: string) => void | Promise<void>;
};

export const useWorkbenchActiveAppContext = ({
  activeTab,
  desktopApi,
  fileManagerModel,
  fileEditorModel,
  labels,
  onOpenJcodeConfigFile
}: UseWorkbenchActiveAppContextParams) => {
  const activeFileManagerState =
    activeTab?.pageKind === "app" &&
    activeTab.appId === "file-manager" &&
    activeTab.appInstanceId !== undefined
      ? fileManagerModel.getState(activeTab.appInstanceId)
      : null;
  const activeFileEditorState =
    activeTab?.pageKind === "app" &&
    activeTab.appId === "file-editor" &&
    activeTab.appInstanceId !== undefined
      ? fileEditorModel.getState(activeTab.appInstanceId)
      : null;
  const settingsAiModel = useSettingsAiModel({
    desktopApi,
    labels: labels.settingsAi,
    onOpenJcodeConfigFile
  });

  return {
    activeFileManagerState,
    activeFileEditorState,
    settingsAiModel
  };
};
