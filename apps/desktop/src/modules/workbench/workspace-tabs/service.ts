import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createNavigationTab,
  looksLikeUrl,
  toNonEmptyTrimmed,
  toSafeAddress
} from "./navigation";
import {
  reduceWorkspaceTabsState,
  type WorkspaceTabsReducerAction
} from "./reducer";
import type { WorkspaceTabsRuntimeState } from "./runtime-state";
import {
  readPersistedState,
  resolveNextSerial,
  toSnapshot,
  writePersistedState
} from "./session-codec";
import { createVisibleWorkspaceLayout } from "./split-model";
import {
  createAppTab,
  createPageTab,
  createPageTabWithId,
  createSearchTab,
  createSettingsTab,
  createTerminalTab,
  FALLBACK_TERMINAL_TITLE
} from "./tab-factory";
import type {
  WorkspaceNavigationTarget,
  WorkspaceAppTabMetaRequest,
  WorkspaceAppTabOpenRequest,
  WorkspaceResolvedNavigation,
  WorkspaceSearchMode,
  WorkspaceTabInsertOptions,
  WorkspaceTabPageMeta,
  WorkspaceTabPageRuntimeState,
  WorkspaceTabsConfig,
  WorkspaceTabsModel,
  WorkspaceTabsOptions,
  WorkspaceTabsSessionSnapshot
} from "./types";

const DEFAULT_OPTIONS: WorkspaceTabsOptions = {
  splitOverflowPolicy: "block_with_notice"
};

export const useWorkspaceTabsModel = (
  config: WorkspaceTabsConfig,
  options: WorkspaceTabsOptions = DEFAULT_OPTIONS
): WorkspaceTabsModel => {
  const nextTabSerialRef = useRef(2);
  const latestInputRef = useRef("");
  const [state, setState] = useState<WorkspaceTabsRuntimeState>(() => {
    const restored = readPersistedState(config);
    nextTabSerialRef.current = resolveNextSerial(restored.tabs);
    return restored;
  });

  useEffect(() => {
    nextTabSerialRef.current = resolveNextSerial(state.tabs);
  }, [state.tabs]);

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0],
    [state.activeTabId, state.tabs]
  );

  const allocateTabSerial = useCallback((): number => {
    const serial = nextTabSerialRef.current;
    nextTabSerialRef.current += 1;
    return serial;
  }, []);

  useEffect(() => {
    latestInputRef.current = activeTab?.inputValue ?? "";
  }, [activeTab?.id, activeTab?.inputValue]);

  useEffect(() => {
    writePersistedState(state);
  }, [state]);

  const dispatchWorkspaceTabsAction = useCallback(
    (action: WorkspaceTabsReducerAction): void => {
      setState((current) => {
        const reduction = reduceWorkspaceTabsState(current, action, {
          config,
          options
        });

        if (reduction.nextSerial !== undefined) {
          nextTabSerialRef.current = reduction.nextSerial;
        }

        if (reduction.latestInputValue !== undefined) {
          latestInputRef.current = reduction.latestInputValue;
        }

        return reduction.state;
      });
    },
    [config, options]
  );

  useEffect(() => {
    setState((current) =>
      reduceWorkspaceTabsState(
        current,
        { type: "sync-settings-title" },
        {
          config,
          options
        }
      ).state
    );
  }, [config.settingsTabTitle]);

  const setActiveTab = useCallback(
    (tabId: string): void => {
      dispatchWorkspaceTabsAction({
        type: "set-active-tab",
        tabId
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  const reorderTab = useCallback(
    (tabId: string, targetIndex: number): void => {
      dispatchWorkspaceTabsAction({
        type: "reorder-tab",
        tabId,
        targetIndex
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  const splitTabWithTarget = useCallback(
    (sourceTabId: string, targetTabId: string): void => {
      dispatchWorkspaceTabsAction({
        type: "split-tab-with-target",
        sourceTabId,
        targetTabId
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  const detachTabFromSplit = useCallback(
    (tabId: string): void => {
      dispatchWorkspaceTabsAction({
        type: "detach-tab-from-split",
        tabId
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  const openNewTab = useCallback((): void => {
    const nextTab = createSearchTab(allocateTabSerial(), config);
    dispatchWorkspaceTabsAction({
      type: "open-new-tab",
      tab: nextTab
    });
  }, [allocateTabSerial, config, dispatchWorkspaceTabsAction]);

  const openSettingsTab = useCallback((): void => {
    const nextTab = createSettingsTab(allocateTabSerial(), config);
    dispatchWorkspaceTabsAction({
      type: "open-settings-tab",
      tab: nextTab
    });
  }, [allocateTabSerial, config, dispatchWorkspaceTabsAction]);

  const openTerminalTab = useCallback((
    terminalTabId: string,
    title: string,
    options?: WorkspaceTabInsertOptions
  ): void => {
    const trimmedId = toNonEmptyTrimmed(terminalTabId);
    if (trimmedId === null) {
      return;
    }

    const nextTitle = toNonEmptyTrimmed(title) ?? FALLBACK_TERMINAL_TITLE;
    const nextTab = createTerminalTab(allocateTabSerial(), trimmedId, nextTitle);
    dispatchWorkspaceTabsAction({
      type: "open-terminal-tab",
      terminalTabId: trimmedId,
      tab: nextTab,
      ...(options?.targetIndex === undefined ? {} : { targetIndex: options.targetIndex })
    });
  }, [allocateTabSerial, dispatchWorkspaceTabsAction]);

  const openAppTab = useCallback(
    (request: WorkspaceAppTabOpenRequest): void => {
      const nextTab = createAppTab(allocateTabSerial(), request);
      dispatchWorkspaceTabsAction({
        type: "open-app-tab",
        request,
        tab: nextTab
      });
    },
    [allocateTabSerial, dispatchWorkspaceTabsAction]
  );

  const updateAppTabMeta = useCallback(
    (request: WorkspaceAppTabMetaRequest): void => {
      dispatchWorkspaceTabsAction({
        type: "update-app-tab-meta",
        request
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  const closeTab = useCallback(
    (tabId: string): void => {
      dispatchWorkspaceTabsAction({
        type: "close-tab",
        tabId
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  const closeTerminalTab = useCallback(
    (terminalTabId: string): void => {
      const trimmedId = toNonEmptyTrimmed(terminalTabId);
      if (trimmedId === null) {
        return;
      }

      const fallbackTab = createSearchTab(allocateTabSerial(), config);
      dispatchWorkspaceTabsAction({
        type: "close-terminal-tab",
        terminalTabId: trimmedId,
        fallbackTab
      });
    },
    [allocateTabSerial, config, dispatchWorkspaceTabsAction]
  );

  const openPageInNewTab = useCallback(
    (
      address: string,
      title?: string,
      options?: { readonly tabId?: string }
    ): string | null => {
      const normalizedAddress = toSafeAddress(address);
      if (normalizedAddress === null) {
        return null;
      }

      const explicitTabId =
        typeof options?.tabId === "string" && options.tabId.trim().length > 0
          ? options.tabId.trim()
          : null;
      const nextTab = explicitTabId === null
        ? createPageTab(allocateTabSerial(), normalizedAddress, title)
        : createPageTabWithId(explicitTabId, normalizedAddress, title);
      dispatchWorkspaceTabsAction({
        type: "open-page-in-new-tab",
        tab: nextTab
      });
      return nextTab.id;
    },
    [allocateTabSerial, dispatchWorkspaceTabsAction]
  );

  const updatePageMeta = useCallback(
    (tabId: string, meta: WorkspaceTabPageMeta): void => {
      dispatchWorkspaceTabsAction({
        type: "update-page-meta",
        tabId,
        meta
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  const syncPageRuntimeState = useCallback(
    (tabId: string, pageState: WorkspaceTabPageRuntimeState): void => {
      dispatchWorkspaceTabsAction({
        type: "sync-page-runtime-state",
        tabId,
        pageState
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  const updateActiveInput = useCallback(
    (value: string): void => {
      dispatchWorkspaceTabsAction({
        type: "update-active-input",
        value
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  const setActiveSearchMode = useCallback(
    (mode: WorkspaceSearchMode): void => {
      dispatchWorkspaceTabsAction({
        type: "set-active-search-mode",
        mode
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  const navigateResolvedInput = useCallback((
    request: WorkspaceResolvedNavigation,
    options?: {
      readonly target?: WorkspaceNavigationTarget;
    }
  ): string => {
    const target = options?.target ?? "active-tab";

    if (target === "active-tab") {
      const current = activeTab;
      if (current === undefined) {
        return "";
      }

      dispatchWorkspaceTabsAction({
        type: "navigate-active-tab",
        request
      });
      return current.id;
    }

    const nextTab = createNavigationTab(allocateTabSerial(), request, config);
    dispatchWorkspaceTabsAction({
      type: "open-navigation-tab",
      tab: nextTab
    });
    return nextTab.id;
  }, [activeTab, allocateTabSerial, config, dispatchWorkspaceTabsAction]);

  const commitActiveInput = useCallback((): void => {
    const current = activeTab;
    if (current === undefined) {
      return;
    }

    const nextInput = latestInputRef.current.trim();
    if (nextInput.length === 0) {
      if (current.pageKind !== "search") {
        navigateResolvedInput({ kind: "home" });
      }
      return;
    }

    if (looksLikeUrl(nextInput)) {
      const safeAddress = toSafeAddress(nextInput);
      if (safeAddress === null) {
        return;
      }
      navigateResolvedInput({
        kind: "page",
        address: safeAddress
      });
      return;
    }

    navigateResolvedInput({
      kind: "search",
      query: nextInput,
      mode: current.searchMode ?? "standard"
    });
  }, [activeTab, navigateResolvedInput]);

  const isTabInSplit = useCallback(
    (tabId: string): boolean => state.splitGroupTabIds.includes(tabId),
    [state.splitGroupTabIds]
  );

  const getVisibleWorkspaceLayout = useCallback(
    () => createVisibleWorkspaceLayout(state),
    [state]
  );

  const snapshotWorkspaceSession = useCallback(
    (): WorkspaceTabsSessionSnapshot => toSnapshot(state),
    [state]
  );

  const restoreWorkspaceSession = useCallback(
    (snapshot: WorkspaceTabsSessionSnapshot): void => {
      dispatchWorkspaceTabsAction({
        type: "restore-session",
        snapshot
      });
    },
    [dispatchWorkspaceTabsAction]
  );

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab,
    splitGroupTabIds: state.splitGroupTabIds,
    focusedSplitTabId: state.focusedSplitTabId,
    setActiveTab,
    reorderTab,
    splitTabWithTarget,
    detachTabFromSplit,
    isTabInSplit,
    getVisibleWorkspaceLayout,
    snapshotWorkspaceSession,
    restoreWorkspaceSession,
    openNewTab,
    openSettingsTab,
    openTerminalTab,
    openAppTab,
    updateAppTabMeta,
    closeTerminalTab,
    openPageInNewTab,
    closeTab,
    updatePageMeta,
    syncPageRuntimeState,
    navigateResolvedInput,
    updateActiveInput,
    setActiveSearchMode,
    commitActiveInput
  };
};
