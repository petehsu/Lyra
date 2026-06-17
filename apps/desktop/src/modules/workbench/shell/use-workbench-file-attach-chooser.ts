import { useCallback, useEffect, useRef, useState } from "react";

import { findSelectedEntry } from "../file-manager/state-model";
import type {
  FileManagerChooserMode,
  FileManagerModel
} from "../file-manager";
import type { WorkspaceTabsModel } from "../workspace-tabs";

type UseWorkbenchFileAttachChooserParams = {
  readonly fileManagerModel: FileManagerModel;
  readonly tabsModel: WorkspaceTabsModel;
  readonly confirmLabel: string;
  readonly promptLabel: string;
  readonly selectPlaceholder: string;
};

type WorkbenchFileAttachChooserModel = {
  readonly requestFileAttach: () => Promise<string | null>;
  readonly resolveFileManagerChooser: (
    instanceId: string
  ) => FileManagerChooserMode | null;
};

export const useWorkbenchFileAttachChooser = ({
  fileManagerModel,
  tabsModel,
  confirmLabel,
  promptLabel,
  selectPlaceholder
}: UseWorkbenchFileAttachChooserParams): WorkbenchFileAttachChooserModel => {
  const pendingResolverRef = useRef<((path: string | null) => void) | null>(null);
  const [chooserInstanceId, setChooserInstanceId] = useState<string | null>(null);

  const requestFileAttach = useCallback(
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
        kind: "ai-file-attach",
        confirmLabel,
        promptLabel,
        selectPlaceholder,
        onConfirm: () => {
          const state = fileManagerModel.getState(instanceId);
          const selectedEntry = state === null ? null : findSelectedEntry(state);
          const selectedPath =
            selectedEntry?.kind === "file"
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
    requestFileAttach,
    resolveFileManagerChooser
  };
};