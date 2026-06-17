import { useCallback, useEffect, useRef, useState } from "react";

import type {
  FileManagerChooserMode,
  FileManagerModel
} from "../file-manager";
import type { WorkspaceTabsModel } from "../workspace-tabs";

type UseWorkbenchProjectBindChooserParams = {
  readonly fileManagerModel: FileManagerModel;
  readonly tabsModel: WorkspaceTabsModel;
  readonly confirmLabel: string;
  readonly promptLabel: string;
  readonly selectPlaceholder: string;
};

type WorkbenchProjectBindChooserModel = {
  readonly requestProjectBind: (currentPath?: string) => Promise<string | null>;
  readonly resolveFileManagerChooser: (
    instanceId: string
  ) => FileManagerChooserMode | null;
};

export const useWorkbenchProjectBindChooser = ({
  fileManagerModel,
  tabsModel,
  confirmLabel,
  promptLabel,
  selectPlaceholder
}: UseWorkbenchProjectBindChooserParams): WorkbenchProjectBindChooserModel => {
  const pendingResolverRef = useRef<((path: string | null) => void) | null>(null);
  const [chooserInstanceId, setChooserInstanceId] = useState<string | null>(null);

  const requestProjectBind = useCallback(
    (currentPath?: string): Promise<string | null> =>
      new Promise((resolve) => {
        if (pendingResolverRef.current !== null) {
          const previousResolver = pendingResolverRef.current;
          pendingResolverRef.current = null;
          previousResolver(null);
        }

        const picker = fileManagerModel.createInstance();
        const pickerInstanceId = picker.appInstanceId;
        pendingResolverRef.current = resolve;
        setChooserInstanceId(pickerInstanceId);
        tabsModel.openAppTab(picker);

        const normalizedPath =
          typeof currentPath === "string" ? currentPath.trim() : "";
        if (normalizedPath.length > 0) {
          void fileManagerModel.openDirectory(pickerInstanceId, normalizedPath, false);
          return;
        }
        void fileManagerModel.openHome(pickerInstanceId, false);
      }),
    [fileManagerModel, tabsModel]
  );

  const resolveFileManagerChooser = useCallback(
    (instanceId: string): FileManagerChooserMode | null => {
      if (chooserInstanceId === null || chooserInstanceId !== instanceId) {
        return null;
      }

      return {
        kind: "ai-project-bind",
        confirmLabel,
        promptLabel,
        selectPlaceholder,
        onConfirm: () => {
          const state = fileManagerModel.getState(instanceId);
          const selectedPath =
            state?.viewKind === "directory"
            && typeof state.currentLocation?.path === "string"
              ? state.currentLocation.path.trim()
              : "";
          if (selectedPath.length === 0) {
            return;
          }

          const chooserTab = tabsModel.tabs.find(
            (tab) =>
              tab.pageKind === "app"
              && tab.appId === "file-manager"
              && tab.appInstanceId === instanceId
          );
          if (chooserTab !== undefined) {
            tabsModel.closeTab(chooserTab.id);
          }

          const resolver = pendingResolverRef.current;
          pendingResolverRef.current = null;
          setChooserInstanceId(null);
          resolver?.(selectedPath);
        }
      };
    },
    [chooserInstanceId, confirmLabel, fileManagerModel, promptLabel, selectPlaceholder, tabsModel]
  );

  useEffect(() => {
    if (chooserInstanceId === null) {
      return;
    }

    const chooserTabStillOpen = tabsModel.tabs.some(
      (tab) =>
        tab.pageKind === "app"
        && tab.appId === "file-manager"
        && tab.appInstanceId === chooserInstanceId
    );
    if (chooserTabStillOpen) {
      return;
    }

    if (pendingResolverRef.current !== null) {
      const resolver = pendingResolverRef.current;
      pendingResolverRef.current = null;
      resolver(null);
    }
    setChooserInstanceId(null);
  }, [chooserInstanceId, tabsModel.tabs]);

  useEffect(
    () => () => {
      if (pendingResolverRef.current === null) {
        return;
      }
      const resolver = pendingResolverRef.current;
      pendingResolverRef.current = null;
      resolver(null);
    },
    []
  );

  return {
    requestProjectBind,
    resolveFileManagerChooser
  };
};
