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
import { createVisibleWorkspaceLayout, resolveRuntimeState } from "./split-model";
import {
  createAppTab,
  createPageTab,
  createPageTabWithId,
  createResultsTab,
  createSearchTab,
  createSettingsTab,
  createTerminalTab,
  createWebSearchTab,
  FALLBACK_TERMINAL_TITLE
} from "./tab-factory";
import { recordUserTabActivation } from "./tab-activation-coordinator";
import {
  acquireWorkspaceAppVersion,
  assertWorkspaceAppVersionCanOpen,
  createWorkspaceAppInstance,
  isWorkspaceProductComponent,
  readWorkspaceAppVersionState,
  restoreWorkspaceAppInstance,
  resolveWorkspaceApp
} from "../workspace-apps/registry";
import type { WorkspaceAppInstanceHandle } from "../workspace-apps/registry";
import type {
  WorkspaceNavigationTarget,
  WorkspaceSearchEngineSelection,
  WorkspaceWebSearchTarget,
  WorkspaceAppTabMetaRequest,
  WorkspaceAppTabOpenRequest,
  WorkspaceResolvedNavigation,
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

const hasDuplicateTabIds = (tabs: readonly { readonly id: string }[]): boolean => {
  const seen = new Set<string>();
  for (const tab of tabs) {
    if (seen.has(tab.id)) {
      return true;
    }
    seen.add(tab.id);
  }
  return false;
};

export const useWorkspaceTabsModel = (
  config: WorkspaceTabsConfig,
  modelOptions: WorkspaceTabsOptions = DEFAULT_OPTIONS
): WorkspaceTabsModel => {
  const nextTabSerialRef = useRef(2);
  const latestInputRef = useRef("");
  const appVersionReleasesRef = useRef(new Map<string, () => unknown>());
  const appInstanceHandlesRef = useRef(new Map<string, {
    readonly identity: string;
    readonly handle: Promise<WorkspaceAppInstanceHandle>;
  }>());
  const restoredAppInstanceIdsRef = useRef(new Set<string>());
  const [state, setState] = useState<WorkspaceTabsRuntimeState>(() => {
    const restored = readPersistedState(config);
    for (const tab of restored.tabs) {
      if (tab.pageKind === "app" && tab.appInstanceId !== undefined) {
        restoredAppInstanceIdsRef.current.add(tab.appInstanceId);
      }
    }
    nextTabSerialRef.current = resolveNextSerial(restored.tabs);
    return restored;
  });

  useEffect(() => {
    nextTabSerialRef.current = resolveNextSerial(state.tabs);
  }, [state.tabs]);

  useEffect(() => {
    const openVersionLeaseTabIds = new Set<string>();
    const openModuleTabIds = new Set<string>();
    for (const tab of state.tabs) {
      const descriptor = tab.pageKind === "app" && tab.appId !== undefined
        ? resolveWorkspaceApp(tab.appId)
        : undefined;
      const componentId = descriptor !== undefined
        ? descriptor.componentId
        : tab.pageKind === "terminal"
          ? "lyra.terminal"
          : tab.pageKind === "page" || tab.pageKind === "search" || tab.pageKind === "results"
            ? "lyra.browser"
            : undefined;
      if (componentId === undefined) continue;

      const isProductComponent = isWorkspaceProductComponent(componentId);
      const componentVersion = tab.appVersion
        ?? (isProductComponent ? readWorkspaceAppVersionState(componentId).active : undefined);
      const componentInstanceId = tab.appInstanceId
        ?? (isProductComponent ? `${componentId}:${tab.id}` : undefined);
      const moduleAppId = tab.appId
        ?? (tab.pageKind === "terminal" ? "terminal" : "browser");
      const componentRoute = tab.appRoute
        ?? (tab.displayAddress.length > 0 ? tab.displayAddress : "/");
      if (
        isProductComponent
        && componentVersion !== undefined
        && componentInstanceId !== undefined
      ) {
        openModuleTabIds.add(tab.id);
        const identity = `${componentId}\u0000${componentVersion}\u0000${componentInstanceId}`;
        const current = appInstanceHandlesRef.current.get(tab.id);
        if (current?.identity === identity) {
          continue;
        }
        if (current !== undefined) {
          void current.handle
            .then((handle) => handle.close())
            .catch((error: unknown) => {
              console.error("[lyra-workspace-apps] failed to replace app instance", error);
            });
        }
        const shouldRestore = tab.pageKind === "app"
          && restoredAppInstanceIdsRef.current.delete(componentInstanceId);
        const handle = shouldRestore
          ? restoreWorkspaceAppInstance({
              appId: moduleAppId,
              componentId,
              version: componentVersion,
              instanceId: componentInstanceId,
              route: componentRoute,
              opaqueState: tab.appOpaqueState ?? {}
            })
          : createWorkspaceAppInstance({
              appId: moduleAppId,
              componentId,
              version: componentVersion,
              instanceId: componentInstanceId,
              route: componentRoute
            });
        appInstanceHandlesRef.current.set(tab.id, { identity, handle });
        void handle.catch((error: unknown) => {
          console.error("[lyra-workspace-apps] failed to open app instance", error);
        });
        continue;
      }

      openVersionLeaseTabIds.add(tab.id);
      if (!appVersionReleasesRef.current.has(tab.id)) {
        const acquired = acquireWorkspaceAppVersion(componentId, tab.appVersion);
        appVersionReleasesRef.current.set(tab.id, acquired.release);
      }
    }
    for (const [tabId, release] of appVersionReleasesRef.current) {
      if (!openVersionLeaseTabIds.has(tabId)) {
        release();
        appVersionReleasesRef.current.delete(tabId);
      }
    }
    for (const [tabId, entry] of appInstanceHandlesRef.current) {
      if (!openModuleTabIds.has(tabId)) {
        appInstanceHandlesRef.current.delete(tabId);
        void entry.handle
          .then((handle) => handle.close())
          .catch((error: unknown) => {
            console.error("[lyra-workspace-apps] failed to close app instance", error);
          });
      }
    }
  }, [state.tabs]);

  useEffect(() => () => {
    for (const release of appVersionReleasesRef.current.values()) {
      release();
    }
    appVersionReleasesRef.current.clear();
    for (const entry of appInstanceHandlesRef.current.values()) {
      void entry.handle
        .then((handle) => handle.close())
        .catch((error: unknown) => {
          console.error("[lyra-workspace-apps] failed to close app instance", error);
        });
    }
    appInstanceHandlesRef.current.clear();
  }, []);

  useEffect(() => {
    if (hasDuplicateTabIds(state.tabs) === false) {
      return;
    }
    setState((current) =>
      hasDuplicateTabIds(current.tabs) ? resolveRuntimeState(current, config) : current
    );
  }, [config, state.tabs]);

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
          options: modelOptions
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
    [config, modelOptions]
  );

  useEffect(() => {
    setState((current) =>
      reduceWorkspaceTabsState(
        current,
        { type: "sync-settings-title" },
        {
          config,
          options: modelOptions
        }
      ).state
    );
  }, [config.settingsTabTitle]);

  const setActiveTab = useCallback(
    (
      tabId: string,
      options?: {
        readonly source?: "user" | "agent";
      }
    ): void => {
      if (options?.source !== "agent") {
        recordUserTabActivation();
      }
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
      const descriptor = resolveWorkspaceApp(request.appId);
      if (descriptor !== undefined && isWorkspaceProductComponent(descriptor.componentId)) {
        const version = request.appVersion
          ?? readWorkspaceAppVersionState(descriptor.componentId).active;
        assertWorkspaceAppVersionCanOpen(descriptor.componentId, version);
      }
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
      const committedAddress =
        request.kind === "page" || request.kind === "web-search"
          ? request.address
          : null;
      if (committedAddress !== null) {
        modelOptions.onCommitPageNavigation?.({
          tabId: current.id,
          address: committedAddress
        });
      }
      return current.id;
    }

    const nextTab = createNavigationTab(allocateTabSerial(), request, config);
    dispatchWorkspaceTabsAction({
      type: "open-navigation-tab",
      tab: nextTab
    });
    return nextTab.id;
  }, [
    activeTab,
    allocateTabSerial,
    config,
    dispatchWorkspaceTabsAction,
    modelOptions
  ]);

  const openWebSearchTabs = useCallback((
    request: {
      readonly query: string;
      readonly targets: readonly WorkspaceWebSearchTarget[];
      readonly selection: WorkspaceSearchEngineSelection;
    },
    options?: {
      readonly target?: WorkspaceNavigationTarget;
    }
  ): readonly string[] => {
    const targets = request.targets.slice(0, 4);
    if (targets.length === 0) {
      return [];
    }
    const tabs = targets.map((target) =>
      createWebSearchTab(
        allocateTabSerial(),
        request.query,
        target.address,
        config,
        target.engineId,
        target.title,
        request.selection
      )
    );
    dispatchWorkspaceTabsAction({
      type: options?.target === "new-tab" ? "open-search-tabs" : "replace-active-search-tabs",
      tabs
    });
    return tabs.map((tab) => tab.id);
  }, [allocateTabSerial, config, dispatchWorkspaceTabsAction]);

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
      query: nextInput
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
      for (const tab of snapshot.tabs) {
        if (tab.pageKind === "app" && tab.appInstanceId !== undefined) {
          restoredAppInstanceIdsRef.current.add(tab.appInstanceId);
        }
      }
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
    openWebSearchTabs,
    navigateResolvedInput,
    updateActiveInput,
    commitActiveInput
  };
};
