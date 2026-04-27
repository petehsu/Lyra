import { useMemo } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { FileEditorModel } from "../file-editor";
import type { FileManagerModel } from "../file-manager";
import { useMcpCenterModel } from "../mcp-center";
import { useSettingsAiModel } from "../settings-ai";
import { useSkillsCenterModel } from "../skills-center";
import type { WorkspaceTab } from "../workspace-tabs/types";
import type { WorkbenchLabels } from "./use-workbench-labels";

type UseWorkbenchActiveAppContextParams = {
  readonly activeTab: WorkspaceTab | undefined;
  readonly desktopApi: LyraDesktopApi | null;
  readonly fileManagerModel: FileManagerModel;
  readonly fileEditorModel: FileEditorModel;
  readonly labels: WorkbenchLabels;
};

export const useWorkbenchActiveAppContext = ({
  activeTab,
  desktopApi,
  fileManagerModel,
  fileEditorModel,
  labels
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
  const mcpProjectHintPath = useMemo(() => {
    if (activeFileEditorState !== null) {
      return activeFileEditorState.filePath;
    }
    if (activeFileManagerState?.currentLocation?.path !== undefined) {
      return activeFileManagerState.currentLocation.path;
    }
    return activeTab?.filePath;
  }, [activeFileEditorState, activeFileManagerState, activeTab?.filePath]);
  const mcpCenterModel = useMcpCenterModel({
    desktopApi,
    ...(mcpProjectHintPath === undefined ? {} : { projectHintPath: mcpProjectHintPath })
  });
  const skillsCenterModel = useSkillsCenterModel({
    desktopApi,
    ...(mcpProjectHintPath === undefined ? {} : { projectHintPath: mcpProjectHintPath }),
    labels: labels.skillsCenter
  });
  const settingsAiModel = useSettingsAiModel({
    desktopApi,
    labels: labels.settingsAi
  });

  return {
    activeFileManagerState,
    activeFileEditorState,
    mcpCenterModel,
    skillsCenterModel,
    settingsAiModel
  };
};
