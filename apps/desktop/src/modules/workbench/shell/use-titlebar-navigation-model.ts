import { useCallback, useMemo, useState } from "react";

import type { LyraDesktopApi, WorkbenchBrowserPageRuntimeState } from "../../../shared/desktop-bridge";
import type { FileEditorAppState } from "../file-editor";
import type { FileManagerAppState } from "../file-manager";
import type { WorkbenchOmniboxNonBrowserSubmitTarget } from "../preferences";
import type { WorkspaceTab, WorkspaceTabsModel } from "../workspace-tabs";
import { resolveWorkbenchNavigationInput } from "./navigation-input";
import type { TitlebarNavigationPrimaryActionKind } from "./titlebar-navigation";

type UseTitlebarNavigationModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly activeTab: WorkspaceTab | undefined;
  readonly activePageRuntimeState: WorkbenchBrowserPageRuntimeState | null;
  readonly activeFileEditorState: FileEditorAppState | null;
  readonly activeFileManagerState: FileManagerAppState | null;
  readonly tabsModel: Pick<
    WorkspaceTabsModel,
    "navigateResolvedInput" | "updateActiveInput"
  >;
  readonly omniboxNonBrowserSubmitTarget: WorkbenchOmniboxNonBrowserSubmitTarget;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly submitLabel: string;
  readonly reloadLabel: string;
  readonly onReload: () => void;
  readonly onOpenFilePath: (path: string) => string | null;
  readonly onOpenDirectoryPath: (path: string) => Promise<void> | void;
};

type TitlebarNavigationModel = {
  readonly value: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly submitLabel: string;
  readonly reloadLabel: string;
  readonly primaryActionKind: TitlebarNavigationPrimaryActionKind;
  readonly isContextualAddress: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => Promise<void>;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
};

const isBrowserLikeTab = (tab: WorkspaceTab | undefined): tab is WorkspaceTab =>
  tab !== undefined &&
  (tab.pageKind === "page" || tab.pageKind === "search" || tab.pageKind === "results");

const getContextualValue = (params: {
  readonly activeTab: WorkspaceTab | undefined;
  readonly activePageRuntimeState: WorkbenchBrowserPageRuntimeState | null;
  readonly activeFileEditorState: FileEditorAppState | null;
  readonly activeFileManagerState: FileManagerAppState | null;
}): string => {
  const { activeTab, activePageRuntimeState, activeFileEditorState, activeFileManagerState } = params;
  if (activeTab === undefined) {
    return "";
  }

  if (activeTab.pageKind === "page") {
    return activePageRuntimeState?.address ?? activeTab.displayAddress;
  }

  if (activeTab.pageKind === "search" || activeTab.pageKind === "results") {
    return activeTab.inputValue;
  }

  if (activeTab.pageKind === "app" && activeTab.appId === "file-editor") {
    return activeFileEditorState?.filePath ?? activeTab.filePath ?? "";
  }

  if (activeTab.pageKind === "app" && activeTab.appId === "file-manager") {
    const currentLocation = activeFileManagerState?.currentLocation ?? null;
    return currentLocation?.kind === "directory" && currentLocation.path !== undefined
      ? currentLocation.path
      : "";
  }

  return "";
};

export const useTitlebarNavigationModel = ({
  desktopApi,
  activeTab,
  activePageRuntimeState,
  activeFileEditorState,
  activeFileManagerState,
  tabsModel,
  omniboxNonBrowserSubmitTarget,
  placeholder,
  ariaLabel,
  submitLabel,
  reloadLabel,
  onReload,
  onOpenFilePath,
  onOpenDirectoryPath
}: UseTitlebarNavigationModelOptions): TitlebarNavigationModel => {
  const [draftByTabId, setDraftByTabId] = useState<Readonly<Record<string, string>>>({});

  const contextualValue = useMemo(
    () =>
      getContextualValue({
        activeTab,
        activePageRuntimeState,
        activeFileEditorState,
        activeFileManagerState
      }),
    [activeFileEditorState, activeFileManagerState, activePageRuntimeState, activeTab]
  );

  const currentDraft = activeTab === undefined ? undefined : draftByTabId[activeTab.id];
  const activeTabId = activeTab?.id ?? null;
  const value = isBrowserLikeTab(activeTab)
    ? activeTab.inputValue
    : currentDraft ?? contextualValue;
  const activePageAddress =
    activeTab?.pageKind === "page"
      ? activePageRuntimeState?.address ?? activeTab.displayAddress
      : "";
  const primaryActionKind: TitlebarNavigationPrimaryActionKind =
    activeTab?.pageKind === "page" &&
    activePageAddress.length > 0 &&
    value.trim() === activePageAddress
      ? "reload"
      : "submit";
  const isContextualAddress =
    isBrowserLikeTab(activeTab) === false &&
    currentDraft === undefined &&
    contextualValue.trim().length > 0;

  const clearDraft = useCallback((tabId: string): void => {
    setDraftByTabId((current) => {
      if (current[tabId] === undefined) {
        return current;
      }
      const next = { ...current };
      delete next[tabId];
      return next;
    });
  }, []);

  const onChange = useCallback((nextValue: string): void => {
    if (activeTab === undefined || activeTabId === null) {
      return;
    }

    if (isBrowserLikeTab(activeTab)) {
      tabsModel.updateActiveInput(nextValue);
      return;
    }

    setDraftByTabId((current) => {
      if (current[activeTabId] === nextValue) {
        return current;
      }
      return {
        ...current,
        [activeTabId]: nextValue
      };
    });
  }, [activeTab, activeTabId, tabsModel]);

  const onSubmit = useCallback(async (): Promise<void> => {
    if (activeTab === undefined || activeTabId === null) {
      return;
    }

    if (primaryActionKind === "reload") {
      onReload();
      return;
    }

    const resolution = await resolveWorkbenchNavigationInput(value, desktopApi);
    if (isBrowserLikeTab(activeTab)) {
      switch (resolution.kind) {
        case "empty":
          tabsModel.navigateResolvedInput({ kind: "home" }, { target: "active-tab" });
          return;
        case "url":
          tabsModel.navigateResolvedInput(
            { kind: "page", address: resolution.address },
            { target: "active-tab" }
          );
          return;
        case "search":
          tabsModel.navigateResolvedInput(
            { kind: "search", query: resolution.query, mode: "standard" },
            { target: "active-tab" }
          );
          return;
        case "file":
          onOpenFilePath(resolution.path);
          return;
        case "directory":
          await onOpenDirectoryPath(resolution.path);
          return;
      }
    }

    switch (resolution.kind) {
      case "empty":
        clearDraft(activeTabId);
        return;
      case "url":
        tabsModel.navigateResolvedInput(
          { kind: "page", address: resolution.address },
          {
            target:
              omniboxNonBrowserSubmitTarget === "replace_active_tab"
                ? "active-tab"
                : "new-tab"
          }
        );
        clearDraft(activeTabId);
        return;
      case "search":
        tabsModel.navigateResolvedInput(
          { kind: "search", query: resolution.query, mode: "standard" },
          {
            target:
              omniboxNonBrowserSubmitTarget === "replace_active_tab"
                ? "active-tab"
                : "new-tab"
          }
        );
        clearDraft(activeTabId);
        return;
      case "file":
        onOpenFilePath(resolution.path);
        clearDraft(activeTabId);
        return;
      case "directory":
        await onOpenDirectoryPath(resolution.path);
        clearDraft(activeTabId);
        return;
    }
  }, [
    activeTab,
    activeTabId,
    clearDraft,
    desktopApi,
    omniboxNonBrowserSubmitTarget,
    onOpenDirectoryPath,
    onOpenFilePath,
    onReload,
    primaryActionKind,
    tabsModel,
    value
  ]);

  const onBlur = useCallback((): void => {
    if (activeTab === undefined || activeTabId === null || isBrowserLikeTab(activeTab)) {
      return;
    }
    if ((draftByTabId[activeTabId] ?? "").trim().length === 0) {
      clearDraft(activeTabId);
    }
  }, [activeTab, activeTabId, clearDraft, draftByTabId]);

  return {
    value,
    placeholder,
    ariaLabel,
    submitLabel,
    reloadLabel,
    primaryActionKind,
    isContextualAddress,
    onChange,
    onSubmit,
    onFocus: () => undefined,
    onBlur
  };
};
