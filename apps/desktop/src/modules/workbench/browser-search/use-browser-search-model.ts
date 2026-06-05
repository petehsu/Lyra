import { useCallback, useEffect, useRef, useState } from "react";

import {
  cancelDeepSearchStream,
  createEmptyDeepSearchState,
  createEmptySearchPayload,
  expandDeepSearchNode
} from "./service";
import {
  applyCancelledDeepSearchState,
  buildBrowserSearchSettingsCacheKey,
  createLoadingDeepSearchState,
  createLoadingSearchPayload,
  DEFAULT_LOCAL_SCOPE_PRESET,
  createRequestId,
  markDeepSearchStateExpanding,
  resolveActiveBrowserSearchCacheKeys
} from "./runtime-model";
import type {
  BrowserSearchModel,
  DeepSearchTask,
  StandardSearchTask,
  UseBrowserSearchModelArgs
} from "./runtime-types";
import { startDeepSearchTask } from "./deep-search-task";
import { startStandardSearchTask } from "./standard-search-task";
import {
  retainSearchSnapshots,
  setDeepSearchSnapshot,
  setStandardSearchSnapshot
} from "./store";
import type {
  BrowserSearchPayload,
  DeepSearchViewState
} from "./types";
import type { WorkspaceSearchMode } from "../workspace-tabs/types";

export const useBrowserSearchModel = ({
  desktopApi,
  tabsModel,
  searchSettings
}: UseBrowserSearchModelArgs): BrowserSearchModel => {
  const searchPillRef = useRef<HTMLDivElement | null>(null);
  const standardSearchCacheRef = useRef(new Map<string, BrowserSearchPayload>());
  const deepSearchCacheRef = useRef(new Map<string, DeepSearchViewState>());
  const standardSearchTasksRef = useRef(new Map<string, StandardSearchTask>());
  const deepSearchTasksRef = useRef(new Map<string, DeepSearchTask>());
  const activeStandardCacheKeyRef = useRef<string | null>(null);
  const activeDeepCacheKeyRef = useRef<string | null>(null);
  const unmountedRef = useRef(false);
  const [standardSearchState, setStandardSearchState] = useState<BrowserSearchPayload>(() =>
    createEmptySearchPayload({
      query: "",
      scopePreset: DEFAULT_LOCAL_SCOPE_PRESET
    })
  );
  const [deepSearchState, setDeepSearchState] = useState<DeepSearchViewState>(() =>
    createEmptyDeepSearchState({
      query: "",
      scopePreset: DEFAULT_LOCAL_SCOPE_PRESET,
      budgetPreset: searchSettings.deepBudgetPreset
    })
  );
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sharedTransitionRect, setSharedTransitionRect] = useState<DOMRect | null>(null);

  const activeTab = tabsModel.activeTab;
  const activeTabId = activeTab?.id ?? "";
  const activeTabPageKind = activeTab?.pageKind ?? "search";
  const activeTabQuery = activeTab?.query ?? "";
  const activeSearchMode = activeTab?.searchMode ?? "standard";
  const currentResultMode =
    activeTabPageKind === "results"
      ? (activeTab?.resultMode ?? activeTab?.searchMode ?? "standard")
      : activeSearchMode;
  const settingsCacheKey = buildBrowserSearchSettingsCacheKey(searchSettings);
  const { activeStandardCacheKey, activeDeepCacheKey } =
    resolveActiveBrowserSearchCacheKeys({
      activeTabId,
      activeTabPageKind,
      activeTabQuery,
      currentResultMode,
      settingsCacheKey
    });

  const publishStandardTaskState = useCallback(
    (cacheKey: string, task: StandardSearchTask): void => {
      setStandardSearchSnapshot(task.tabId, task.state);
      if (unmountedRef.current || activeStandardCacheKeyRef.current !== cacheKey) {
        return;
      }
      setStandardSearchState(task.state);
      setIsSearching(task.isSearching);
      setSearchError(task.error);
    },
    []
  );

  const publishDeepTaskState = useCallback(
    (cacheKey: string, task: DeepSearchTask): void => {
      setDeepSearchSnapshot(task.tabId, task.state);
      if (unmountedRef.current || activeDeepCacheKeyRef.current !== cacheKey) {
        return;
      }
      setDeepSearchState(task.state);
      setIsSearching(task.isSearching);
      setSearchError(task.error);
    },
    []
  );

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      for (const task of standardSearchTasksRef.current.values()) {
        task.cancel();
      }
      standardSearchTasksRef.current.clear();
      for (const task of deepSearchTasksRef.current.values()) {
        task.cancel();
      }
      deepSearchTasksRef.current.clear();
    };
  }, []);

  useEffect(() => {
    retainSearchSnapshots(
      tabsModel.tabs
        .filter((tab) => tab.pageKind === "search" || tab.pageKind === "results")
        .map((tab) => tab.id)
    );
  }, [tabsModel.tabs]);

  useEffect(() => {
    if (activeTabPageKind === "results") {
      return;
    }
    setSharedTransitionRect(null);
  }, [activeTabPageKind]);

  useEffect(() => {
    if (activeTabPageKind === "results") {
      return;
    }
    setIsSearching(false);
    setSearchError(null);
  }, [activeTabPageKind]);

  useEffect(() => {
    activeStandardCacheKeyRef.current = activeStandardCacheKey;
    if (activeTabPageKind !== "results" || currentResultMode !== "standard") {
      return;
    }
    const query = activeTabQuery.trim();
    if (query.length === 0 || activeStandardCacheKey === null) {
      setStandardSearchState(
        createEmptySearchPayload({
          query: "",
          scopePreset: DEFAULT_LOCAL_SCOPE_PRESET
        })
      );
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const task = standardSearchTasksRef.current.get(activeStandardCacheKey);
    if (task !== undefined) {
      setStandardSearchState(task.state);
      setIsSearching(task.isSearching);
      setSearchError(task.error);
      return;
    }

    const cached = standardSearchCacheRef.current.get(activeStandardCacheKey);
    if (cached !== undefined) {
      setStandardSearchState(cached);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const loading = createLoadingSearchPayload({
      query,
      requestId: createRequestId(),
      scopePreset: DEFAULT_LOCAL_SCOPE_PRESET
    });
    setStandardSearchState(loading);
    setIsSearching(true);
    setSearchError(null);
  }, [
    activeStandardCacheKey,
    activeTabPageKind,
    activeTabQuery,
    currentResultMode
  ]);

  useEffect(() => {
    if (activeTabPageKind !== "results" || currentResultMode !== "standard") {
      return;
    }
    const query = activeTabQuery.trim();
    if (query.length === 0 || activeStandardCacheKey === null) {
      return;
    }
    if (standardSearchCacheRef.current.has(activeStandardCacheKey)) {
      return;
    }
    if (standardSearchTasksRef.current.has(activeStandardCacheKey)) {
      return;
    }

    for (const [cacheKey, task] of standardSearchTasksRef.current.entries()) {
      if (task.tabId === activeTabId && cacheKey !== activeStandardCacheKey) {
        task.cancel();
      }
    }

    startStandardSearchTask({
      desktopApi,
      cacheKey: activeStandardCacheKey,
      tabId: activeTabId,
      query,
      requestId: createRequestId(),
      searchSettings,
      taskCache: standardSearchTasksRef.current,
      resultCache: standardSearchCacheRef.current,
      publishTaskState: publishStandardTaskState
    });
  }, [
    activeStandardCacheKey,
    activeTabId,
    activeTabPageKind,
    activeTabQuery,
    currentResultMode,
    desktopApi,
    publishStandardTaskState,
    searchSettings
  ]);

  useEffect(() => {
    activeDeepCacheKeyRef.current = activeDeepCacheKey;
    if (activeTabPageKind !== "results" || currentResultMode !== "deep") {
      return;
    }
    const query = activeTabQuery.trim();
    if (query.length === 0 || activeDeepCacheKey === null) {
      setDeepSearchState(
        createEmptyDeepSearchState({
          query: "",
          scopePreset: DEFAULT_LOCAL_SCOPE_PRESET,
          budgetPreset: searchSettings.deepBudgetPreset
        })
      );
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const task = deepSearchTasksRef.current.get(activeDeepCacheKey);
    if (task !== undefined) {
      setDeepSearchState(task.state);
      setIsSearching(task.isSearching);
      setSearchError(task.error);
      return;
    }

    const cached = deepSearchCacheRef.current.get(activeDeepCacheKey);
    if (cached !== undefined) {
      setDeepSearchState(cached);
      setIsSearching(cached.done === false);
      setSearchError(cached.error ?? null);
      return;
    }

    setDeepSearchState(createLoadingDeepSearchState({
      query,
      requestId: createRequestId(),
      scopePreset: DEFAULT_LOCAL_SCOPE_PRESET,
      budgetPreset: searchSettings.deepBudgetPreset
    }));
    setIsSearching(true);
    setSearchError(null);
  }, [
    activeDeepCacheKey,
    activeTabPageKind,
    activeTabQuery,
    currentResultMode,
    searchSettings.deepBudgetPreset
  ]);

  useEffect(() => {
    if (activeTabPageKind !== "results" || currentResultMode !== "deep") {
      return;
    }
    const query = activeTabQuery.trim();
    if (query.length === 0 || activeDeepCacheKey === null) {
      return;
    }
    if (deepSearchTasksRef.current.has(activeDeepCacheKey)) {
      return;
    }
    if (deepSearchCacheRef.current.has(activeDeepCacheKey)) {
      return;
    }

    for (const [cacheKey, task] of deepSearchTasksRef.current.entries()) {
      if (task.tabId === activeTabId && cacheKey !== activeDeepCacheKey) {
        task.cancel();
      }
    }

    startDeepSearchTask({
      desktopApi,
      cacheKey: activeDeepCacheKey,
      tabId: activeTabId,
      query,
      requestId: createRequestId(),
      searchSettings,
      taskCache: deepSearchTasksRef.current,
      resultCache: deepSearchCacheRef.current,
      publishTaskState: publishDeepTaskState
    });
  }, [
    activeDeepCacheKey,
    activeTabId,
    activeTabPageKind,
    activeTabQuery,
    currentResultMode,
    desktopApi,
    publishDeepTaskState,
    searchSettings
  ]);

  const captureSearchPillRect = useCallback(() => {
    const rect = searchPillRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    setSharedTransitionRect(rect);
  }, []);

  const onSearchSurfaceSubmit = useCallback(() => {
    captureSearchPillRect();
    tabsModel.commitActiveInput();
  }, [captureSearchPillRect, tabsModel]);

  const onSharedAnimationDone = useCallback(() => {
    setSharedTransitionRect(null);
  }, []);

  const onSetActiveSearchMode = useCallback((mode: WorkspaceSearchMode) => {
    tabsModel.setActiveSearchMode(mode);
  }, [tabsModel]);

  const onToggleDeepSearch = useCallback(() => {
    tabsModel.setActiveSearchMode(activeSearchMode === "deep" ? "standard" : "deep");
  }, [activeSearchMode, tabsModel]);

  const onExpandDeepNode = useCallback((nodeId: string) => {
    const cacheKey = activeDeepCacheKeyRef.current;
    if (cacheKey === null) {
      return;
    }
    const task = deepSearchTasksRef.current.get(cacheKey);
    const streamId =
      task?.streamId
      ?? deepSearchCacheRef.current.get(cacheKey)?.streamId
      ?? deepSearchState.streamId;
    if (streamId === undefined || streamId === null) {
      return;
    }
    void expandDeepSearchNode({
      desktopApi,
      request: {
        streamId,
        nodeId
      }
    }).then((response) => {
      if (response?.accepted !== true) {
        return;
      }
      const activeTask = deepSearchTasksRef.current.get(cacheKey);
      if (activeTask !== undefined) {
        activeTask.state = markDeepSearchStateExpanding(activeTask.state);
        activeTask.error = null;
        activeTask.isSearching = true;
        activeTask.resume();
        return;
      }
      setIsSearching(true);
      setDeepSearchState((current) => markDeepSearchStateExpanding(current));
    });
  }, [deepSearchState.streamId, desktopApi]);

  const onCancelDeepSearch = useCallback(() => {
    const cacheKey = activeDeepCacheKeyRef.current;
    if (cacheKey === null) {
      return;
    }
    const task = deepSearchTasksRef.current.get(cacheKey);
    const streamId =
      task?.streamId
      ?? deepSearchCacheRef.current.get(cacheKey)?.streamId
      ?? deepSearchState.streamId;
    if (streamId === undefined || streamId === null) {
      return;
    }

    if (task !== undefined) {
      task.cancel();
      task.isSearching = false;
      task.state = applyCancelledDeepSearchState(task.state);
      deepSearchCacheRef.current.set(cacheKey, task.state);
      publishDeepTaskState(cacheKey, task);
      return;
    }

    void cancelDeepSearchStream({
      desktopApi,
      streamId
    }).finally(() => {
      setIsSearching(false);
      setDeepSearchState((current) => {
        const next = applyCancelledDeepSearchState(current);
        deepSearchCacheRef.current.set(cacheKey, next);
        return next;
      });
    });
  }, [deepSearchState.streamId, desktopApi, publishDeepTaskState]);

  return {
    standardSearchState,
    deepSearchState,
    activeSearchMode,
    currentResultMode,
    isSearching,
    searchError,
    sharedTransitionRect,
    searchPillRef,
    onSearchSurfaceSubmit,
    onSharedAnimationDone,
    onSetActiveSearchMode,
    onToggleDeepSearch,
    onCancelDeepSearch,
    onExpandDeepNode
  };
};
