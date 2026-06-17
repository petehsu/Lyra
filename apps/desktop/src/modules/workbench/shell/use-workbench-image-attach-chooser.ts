import { useCallback, useEffect, useRef, useState } from "react";

import { findSelectedEntry } from "../file-manager/state-model";
import type {
  FileManagerChooserMode,
  FileManagerModel
} from "../file-manager";
import { isImageViewerSupportedPath } from "../image-viewer";
import type { WorkspaceTabsModel } from "../workspace-tabs";

type UseWorkbenchImageAttachChooserParams = {
  readonly fileManagerModel: FileManagerModel;
  readonly tabsModel: WorkspaceTabsModel;
  readonly confirmLabel: string;
  readonly promptLabel: string;
  readonly selectPlaceholder: string;
};

type WorkbenchImageAttachChooserModel = {
  readonly requestImageAttach: () => Promise<string | null>;
  readonly resolveFileManagerChooser: (
    instanceId: string
  ) => FileManagerChooserMode | null;
};

export const useWorkbenchImageAttachChooser = ({
  fileManagerModel,
  tabsModel,
  confirmLabel,
  promptLabel,
  selectPlaceholder
}: UseWorkbenchImageAttachChooserParams): WorkbenchImageAttachChooserModel => {
  const pendingResolverRef = useRef<((path: string | null) => void) | null>(null);
  const [chooserInstanceId, setChooserInstanceId] = useState<string | null>(null);

  const requestImageAttach = useCallback(
    (): Promise<string | null> =>
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
        kind: "ai-image-attach",
        confirmLabel,
        promptLabel,
        selectPlaceholder,
        onConfirm: () => {
          const state = fileManagerModel.getState(instanceId);
          const selectedEntry = state === null ? null : findSelectedEntry(state);
          const selectedPath =
            selectedEntry?.kind === "file"
            && isImageViewerSupportedPath(selectedEntry.path)
              ? selectedEntry.path.trim()
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
    [
      chooserInstanceId,
      confirmLabel,
      fileManagerModel,
      promptLabel,
      selectPlaceholder,
      tabsModel
    ]
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
    requestImageAttach,
    resolveFileManagerChooser
  };
};