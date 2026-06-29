import { useCallback, useEffect, useRef, useState } from "react";

import {
  createEmptySearchPayload,
  resolveWebSearchTarget
} from "./service";
import {
  buildBrowserSearchSettingsCacheKey,
  createLoadingSearchPayload,
  createRequestId,
  resolveActiveBrowserSearchCacheKeys
} from "./runtime-model";
import type {
  BrowserSearchModel,
  StandardSearchTask,
  UseBrowserSearchModelArgs
} from "./runtime-types";
import { startStandardSearchTask } from "./standard-search-task";
import {
  retainSearchSnapshots,
  setStandardSearchSnapshot
} from "./store";
import type { BrowserSearchPayload } from "./types";
import {
  looksLikeUrl,
  toSafeAddress
} from "../workspace-tabs/navigation";

export const useBrowserSearchModel = ({
  desktopApi,
  tabsModel,
  searchSettings
}: UseBrowserSearchModelArgs): BrowserSearchModel => {
  const searchPillRef = useRef<HTMLDivElement | null>(null);
  const standardSearchCacheRef = useRef(new Map<string, BrowserSearchPayload>());
  const standardSearchTasksRef = useRef(new Map<string, StandardSearchTask>());
  const activeStandardCacheKeyRef = useRef<string | null>(null);
  const unmountedRef = useRef(false);
  const [standardSearchState, setStandardSearchState] = useState<BrowserSearchPayload>(() =>
    createEmptySearchPayload({
      query: ""
    })
  );
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sharedTransitionRect, setSharedTransitionRect] = useState<DOMRect | null>(null);

  const activeTab = tabsModel.activeTab;
  const activeTabId = activeTab?.id ?? "";
  const activeTabPageKind = activeTab?.pageKind ?? "search";
  const activeTabQuery = activeTab?.query ?? "";
  const settingsCacheKey = buildBrowserSearchSettingsCacheKey(searchSettings);
  const { activeStandardCacheKey } =
    resolveActiveBrowserSearchCacheKeys({
      activeTabId,
      activeTabPageKind,
      activeTabQuery,
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

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      for (const task of standardSearchTasksRef.current.values()) {
        task.cancel();
      }
      standardSearchTasksRef.current.clear();
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
    if (activeTabPageKind !== "results") {
      return;
    }
    const query = activeTabQuery.trim();
    if (query.length === 0 || activeStandardCacheKey === null) {
      setStandardSearchState(
        createEmptySearchPayload({
          query: ""
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
      requestId: createRequestId()
    });
    setStandardSearchState(loading);
    setIsSearching(true);
    setSearchError(null);
  }, [
    activeStandardCacheKey,
    activeTabPageKind,
    activeTabQuery
  ]);

  useEffect(() => {
    if (activeTabPageKind !== "results") {
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
    desktopApi,
    publishStandardTaskState,
    searchSettings
  ]);

  const captureSearchPillRect = useCallback(() => {
    const rect = searchPillRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    setSharedTransitionRect(rect);
  }, []);

  const onSearchSurfaceSubmit = useCallback(async () => {
    captureSearchPillRect();
    const input = tabsModel.activeTab?.inputValue.trim() ?? "";
    if (input.length === 0) {
      tabsModel.navigateResolvedInput({ kind: "home" });
      return;
    }

    if (looksLikeUrl(input)) {
      const safeAddress = toSafeAddress(input);
      if (safeAddress !== null) {
        tabsModel.navigateResolvedInput({
          kind: "page",
          address: safeAddress
        });
      }
      return;
    }

    const target = await resolveWebSearchTarget({
      desktopApi,
      query: input,
      searchEngines: searchSettings.searchEngines
    });
    if (target === null) {
      return;
    }
    tabsModel.openWebSearchTabs({
      query: input,
      targets: [
        {
          address: target.searchUrl,
          engineId: target.engine.id,
          title: target.engine.label
        }
      ],
      selection: { mode: "auto", engineIds: [] }
    });
  }, [
    captureSearchPillRect,
    desktopApi,
    searchSettings.searchEngines,
    tabsModel
  ]);

  const onSharedAnimationDone = useCallback(() => {
    setSharedTransitionRect(null);
  }, []);

  return {
    standardSearchState,
    isSearching,
    searchError,
    sharedTransitionRect,
    searchPillRef,
    onSearchSurfaceSubmit,
    onSharedAnimationDone
  };
};