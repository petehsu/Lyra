import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import {
  cancelDeepSearchStream,
  cancelLocalSearchStream,
  createEmptyDeepSearchState,
  createEmptySearchPayload,
  expandDeepSearchNode,
  fetchAggregatedSearchPayload,
  readDeepSearchStream,
  readLocalSearchStream,
  readSearchIndexStatus,
  startDeepSearchStream,
  startLocalSearchStream
} from "../browser-search";
import type {
  BrowserSearchPayload,
  DeepSearchViewState,
  LocalSearchScopePreset,
  SearchEngineDefinition
} from "../browser-search/types";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  WorkspaceSearchMode,
  WorkspaceTabsModel
} from "../workspace-tabs/types";

export type BrowserSearchSettings = {
  readonly searchEngines: readonly SearchEngineDefinition[];
  readonly resultsPerEngine: number;
  readonly localScopePreset: LocalSearchScopePreset;
  readonly localCustomRoots: readonly string[];
  readonly localIncludeHidden: boolean;
  readonly localEnableFuzzy: boolean;
  readonly localEnableContent: boolean;
  readonly localEnableExtensionMatch: boolean;
  readonly localProjectRoot?: string;
  readonly localLimit?: number;
  readonly deepBudgetPreset: "low" | "medium" | "high";
  readonly deepSiteExpansionEnabled: boolean;
  readonly deepProactiveDomainGuessingEnabled: boolean;
  readonly deepCrawlPolicy: "accessibility_only";
};

export type BrowserSearchModel = {
  readonly standardSearchState: BrowserSearchPayload;
  readonly deepSearchState: DeepSearchViewState;
  readonly activeSearchMode: WorkspaceSearchMode;
  readonly currentResultMode: WorkspaceSearchMode;
  readonly isSearching: boolean;
  readonly searchError: string | null;
  readonly sharedTransitionRect: DOMRect | null;
  readonly searchPillRef: MutableRefObject<HTMLDivElement | null>;
  readonly onSearchSurfaceSubmit: () => void;
  readonly onSharedAnimationDone: () => void;
  readonly onSetActiveSearchMode: (mode: WorkspaceSearchMode) => void;
  readonly onToggleDeepSearch: () => void;
  readonly onCancelDeepSearch: () => void;
  readonly onExpandDeepNode: (nodeId: string) => void;
};

type UseBrowserSearchModelArgs = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabsModel: WorkspaceTabsModel;
  readonly searchSettings: BrowserSearchSettings;
};

type StandardSearchTask = {
  readonly cacheKey: string;
  readonly tabId: string;
  state: BrowserSearchPayload;
  error: string | null;
  isSearching: boolean;
  cancel: () => void;
};

type DeepSearchTask = {
  readonly cacheKey: string;
  readonly tabId: string;
  state: DeepSearchViewState;
  error: string | null;
  isSearching: boolean;
  streamId: string | null;
  cancel: () => void;
  resume: () => void;
};

const buildSettingsCacheKey = (settings: BrowserSearchSettings): string =>
  JSON.stringify({
    engines: settings.searchEngines.map((engine) => ({
      id: engine.id,
      endpoint: engine.endpoint ?? null
    })),
    limitPerEngine: settings.resultsPerEngine,
    localScopePreset: settings.localScopePreset,
    localCustomRoots: settings.localCustomRoots,
    localIncludeHidden: settings.localIncludeHidden,
    localEnableFuzzy: settings.localEnableFuzzy,
    localEnableContent: settings.localEnableContent,
    localEnableExtensionMatch: settings.localEnableExtensionMatch,
    localProjectRoot: settings.localProjectRoot ?? null,
    localLimit: settings.localLimit ?? 60,
    deepBudgetPreset: settings.deepBudgetPreset,
    deepSiteExpansionEnabled: settings.deepSiteExpansionEnabled,
    deepProactiveDomainGuessingEnabled: settings.deepProactiveDomainGuessingEnabled,
    deepCrawlPolicy: settings.deepCrawlPolicy
  });

const createLoadingPayload = (options: {
  readonly query: string;
  readonly requestId: string;
  readonly scopePreset: LocalSearchScopePreset;
}): BrowserSearchPayload => {
  const payload = createEmptySearchPayload({
    query: options.query,
    scopePreset: options.scopePreset
  });
  return {
    ...payload,
    queryRequestId: options.requestId,
    web: {
      status: "loading",
      payload: payload.web.payload
    },
    local: {
      status: "loading",
      payload: payload.local.payload
    }
  };
};

const createLoadingDeepState = (options: {
  readonly query: string;
  readonly requestId: string;
  readonly scopePreset: LocalSearchScopePreset;
  readonly budgetPreset: "low" | "medium" | "high";
}): DeepSearchViewState => ({
  ...createEmptyDeepSearchState({
    query: options.query,
    scopePreset: options.scopePreset,
    budgetPreset: options.budgetPreset
  }),
  queryRequestId: options.requestId,
  status: "loading"
});

const buildStandardCacheKey = (
  tabId: string,
  query: string,
  settingsCacheKey: string
): string => `${tabId}:standard:${query}:${settingsCacheKey}`;

const buildDeepCacheKey = (
  tabId: string,
  query: string,
  settingsCacheKey: string
): string => `${tabId}:deep:${query}:${settingsCacheKey}`;

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
      scopePreset: searchSettings.localScopePreset
    })
  );
  const [deepSearchState, setDeepSearchState] = useState<DeepSearchViewState>(() =>
    createEmptyDeepSearchState({
      query: "",
      scopePreset: searchSettings.localScopePreset,
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
  const settingsCacheKey = buildSettingsCacheKey(searchSettings);
  const searchEngines = searchSettings.searchEngines;
  const resultsPerEngine = searchSettings.resultsPerEngine;
  const localScopePreset = searchSettings.localScopePreset;
  const localCustomRoots = searchSettings.localCustomRoots;
  const localIncludeHidden = searchSettings.localIncludeHidden;
  const localEnableFuzzy = searchSettings.localEnableFuzzy;
  const localEnableContent = searchSettings.localEnableContent;
  const localEnableExtensionMatch = searchSettings.localEnableExtensionMatch;
  const localProjectRoot = searchSettings.localProjectRoot;
  const localLimit = searchSettings.localLimit ?? 60;
  const deepBudgetPreset = searchSettings.deepBudgetPreset;
  const deepSiteExpansionEnabled = searchSettings.deepSiteExpansionEnabled;
  const deepProactiveDomainGuessingEnabled = searchSettings.deepProactiveDomainGuessingEnabled;
  const deepCrawlPolicy = searchSettings.deepCrawlPolicy;

  const publishStandardTaskState = useCallback((cacheKey: string, task: StandardSearchTask): void => {
    if (unmountedRef.current || activeStandardCacheKeyRef.current !== cacheKey) {
      return;
    }
    setStandardSearchState(task.state);
    setIsSearching(task.isSearching);
    setSearchError(task.error);
  }, []);

  const publishDeepTaskState = useCallback((cacheKey: string, task: DeepSearchTask): void => {
    if (unmountedRef.current || activeDeepCacheKeyRef.current !== cacheKey) {
      return;
    }
    setDeepSearchState(task.state);
    setIsSearching(task.isSearching);
    setSearchError(task.error);
  }, []);

  const startStandardSearchTask = useCallback((options: {
    readonly cacheKey: string;
    readonly tabId: string;
    readonly query: string;
  }): StandardSearchTask => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const task: StandardSearchTask = {
      cacheKey: options.cacheKey,
      tabId: options.tabId,
      state: createLoadingPayload({
        query: options.query,
        requestId,
        scopePreset: localScopePreset
      }),
      error: null,
      isSearching: true,
      cancel: () => undefined
    };

    standardSearchTasksRef.current.set(options.cacheKey, task);
    publishStandardTaskState(options.cacheKey, task);

    let cancelled = false;
    let localStreamId: string | null = null;
    let localStreamPollTimer: ReturnType<typeof setTimeout> | null = null;
    let localStreamCompleted = false;
    let pendingCount = 2;

    const clearLocalStreamTimer = (): void => {
      if (localStreamPollTimer !== null) {
        clearTimeout(localStreamPollTimer);
        localStreamPollTimer = null;
      }
    };

    const updateTaskState = (updater: (current: BrowserSearchPayload) => BrowserSearchPayload): void => {
      if (cancelled) {
        return;
      }
      task.state = updater(task.state);
      publishStandardTaskState(options.cacheKey, task);
    };

    const updateTaskError = (message: string | null): void => {
      task.error = message;
      publishStandardTaskState(options.cacheKey, task);
    };

    const finalizeTask = (): void => {
      if (cancelled) {
        return;
      }
      task.isSearching = false;
      task.state = {
        ...task.state,
        lastUpdatedAt: new Date().toISOString()
      };
      standardSearchCacheRef.current.set(options.cacheKey, task.state);
      standardSearchTasksRef.current.delete(options.cacheKey);
      publishStandardTaskState(options.cacheKey, task);
    };

    const completeOne = (): void => {
      if (cancelled) {
        return;
      }
      pendingCount -= 1;
      if (pendingCount <= 0) {
        finalizeTask();
      }
    };

    const completeLocalStream = (): void => {
      if (localStreamCompleted) {
        return;
      }
      localStreamCompleted = true;
      completeOne();
    };

    task.cancel = () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      clearLocalStreamTimer();
      standardSearchTasksRef.current.delete(options.cacheKey);
      if (localStreamId !== null) {
        void cancelLocalSearchStream({
          desktopApi,
          streamId: localStreamId
        });
      }
    };

    void fetchAggregatedSearchPayload({
      desktopApi,
      query: options.query,
      searchEngines,
      resultsPerEngine
    })
      .then((payload) => {
        updateTaskState((current) => ({
          ...current,
          web: {
            status: "ready",
            payload
          }
        }));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "web search failed";
        updateTaskError(task.error ?? message);
        updateTaskState((current) => ({
          ...current,
          web: {
            status: "error",
            payload: current.web.payload,
            error: message
          }
        }));
      })
      .finally(() => {
        completeOne();
      });

    void startLocalSearchStream({
      desktopApi,
      request: {
        query: options.query,
        limit: localLimit,
        scopePreset: localScopePreset,
        customRoots: localCustomRoots,
        ...(localProjectRoot === undefined ? {} : { projectRoot: localProjectRoot }),
        includeHidden: localIncludeHidden,
        enableFuzzy: localEnableFuzzy,
        enableContent: localEnableContent,
        enableExtensionMatch: localEnableExtensionMatch
      }
    })
      .then((started) => {
        if (cancelled) {
          return;
        }
        if (started === null) {
          completeLocalStream();
          return;
        }
        localStreamId = started.streamId;
        updateTaskState((current) => ({
          ...current,
          local: {
            ...current.local,
            payload: {
              ...current.local.payload,
              query: started.query,
              scopePreset: started.scopePreset,
              roots: started.roots
            }
          }
        }));

        const pollLocalStream = async (): Promise<void> => {
          if (cancelled || localStreamId === null) {
            return;
          }
          try {
            const snapshot = await readLocalSearchStream({
              desktopApi,
              streamId: localStreamId,
              limit: localLimit
            });
            if (cancelled) {
              return;
            }
            if (snapshot === null) {
              completeLocalStream();
              return;
            }
            updateTaskState((current) => ({
              ...current,
              local: {
                ...current.local,
                status:
                  snapshot.done
                    ? (snapshot.error === undefined ? "ready" : "error")
                    : "loading",
                payload: snapshot.payload,
                ...(snapshot.error === undefined ? {} : { error: snapshot.error })
              }
            }));
            if (snapshot.error !== undefined) {
              updateTaskError(task.error ?? snapshot.error ?? "local search failed");
            }
            if (snapshot.done) {
              completeLocalStream();
              return;
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "local search failed";
            updateTaskError(task.error ?? message);
            updateTaskState((current) => ({
              ...current,
              local: {
                ...current.local,
                status: "error",
                error: message
              }
            }));
            completeLocalStream();
            return;
          }
          localStreamPollTimer = setTimeout(() => {
            void pollLocalStream();
          }, 55);
        };

        void pollLocalStream();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "local search failed";
        updateTaskError(task.error ?? message);
        updateTaskState((current) => ({
          ...current,
          local: {
            ...current.local,
            status: "error",
            error: message
          }
        }));
        completeLocalStream();
      });

    void readSearchIndexStatus({ desktopApi })
      .then((indexStatus) => {
        if (indexStatus === null || cancelled) {
          return;
        }
        updateTaskState((current) => ({
          ...current,
          local: {
            ...current.local,
            indexStatus
          }
        }));
      })
      .catch(() => {
        // Best-effort.
      });

    return task;
  }, [
    desktopApi,
    localCustomRoots,
    localEnableContent,
    localEnableExtensionMatch,
    localEnableFuzzy,
    localIncludeHidden,
    localLimit,
    localProjectRoot,
    localScopePreset,
    publishStandardTaskState,
    resultsPerEngine,
    searchEngines
  ]);

  const startDeepSearchTask = useCallback((options: {
    readonly cacheKey: string;
    readonly tabId: string;
    readonly query: string;
  }): DeepSearchTask => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const task: DeepSearchTask = {
      cacheKey: options.cacheKey,
      tabId: options.tabId,
      state: createLoadingDeepState({
        query: options.query,
        requestId,
        scopePreset: localScopePreset,
        budgetPreset: deepBudgetPreset
      }),
      error: null,
      isSearching: true,
      streamId: null,
      cancel: () => undefined,
      resume: () => undefined
    };

    deepSearchTasksRef.current.set(options.cacheKey, task);
    publishDeepTaskState(options.cacheKey, task);

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const stopPolling = (): void => {
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const publish = (): void => {
      publishDeepTaskState(options.cacheKey, task);
    };

    const schedulePoll = (): void => {
      stopPolling();
      pollTimer = setTimeout(() => {
        void pollStream();
      }, 120);
    };

    const pollStream = async (): Promise<void> => {
      if (cancelled || task.streamId === null) {
        return;
      }
      try {
        const response = await readDeepSearchStream({
          desktopApi,
          streamId: task.streamId
        });
        if (cancelled || response === null) {
          return;
        }
        task.state = {
          query: options.query,
          queryRequestId: requestId,
          streamId: task.streamId,
          budgetPreset: deepBudgetPreset,
          status: response.done
            ? (response.error === undefined ? "ready" : "error")
            : "loading",
          snapshot: response.snapshot,
          done: response.done,
          ...(response.error === undefined ? {} : { error: response.error })
        };
        task.error = response.error ?? null;
        task.isSearching = !response.done;
        if (response.done) {
          deepSearchCacheRef.current.set(options.cacheKey, task.state);
          publish();
          return;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "deep search failed";
        task.state = {
          ...task.state,
          status: "error",
          done: true,
          error: message,
          snapshot: {
            ...task.state.snapshot,
            phase: "error",
            lastUpdatedAt: new Date().toISOString()
          }
        };
        task.error = message;
        task.isSearching = false;
        deepSearchCacheRef.current.set(options.cacheKey, task.state);
        publish();
        return;
      }
      publish();
      schedulePoll();
    };

    task.resume = () => {
      if (cancelled || task.streamId === null) {
        return;
      }
      task.isSearching = true;
      task.state = {
        ...task.state,
        status: "loading",
        done: false,
        snapshot: {
          ...task.state.snapshot,
          phase: task.state.snapshot.phase === "error" ? "streaming" : task.state.snapshot.phase,
          lastUpdatedAt: new Date().toISOString()
        }
      };
      publish();
      schedulePoll();
    };

    task.cancel = () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      stopPolling();
      deepSearchTasksRef.current.delete(options.cacheKey);
      if (task.streamId !== null) {
        void cancelDeepSearchStream({
          desktopApi,
          streamId: task.streamId
        });
      }
    };

    void startDeepSearchStream({
      desktopApi,
      request: {
        query: options.query,
        budgetPreset: deepBudgetPreset,
        scopePreset: localScopePreset,
        customRoots: localCustomRoots,
        ...(localProjectRoot === undefined ? {} : { projectRoot: localProjectRoot }),
        includeHidden: localIncludeHidden,
        enableFuzzy: localEnableFuzzy,
        enableContent: localEnableContent,
        enableExtensionMatch: localEnableExtensionMatch,
        engines: searchEngines,
        enableSiteExpansion: deepSiteExpansionEnabled,
        enableProactiveDomainGuessing: deepProactiveDomainGuessingEnabled,
        crawlPolicy: deepCrawlPolicy
      }
    })
      .then((started) => {
        if (cancelled || started === null) {
          return;
        }
        task.streamId = started.streamId;
        task.state = {
          query: options.query,
          queryRequestId: requestId,
          streamId: started.streamId,
          budgetPreset: deepBudgetPreset,
          status: "loading",
          snapshot: started.snapshot,
          done: false
        };
        task.isSearching = true;
        publish();
        schedulePoll();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "deep search failed";
        task.state = {
          ...task.state,
          status: "error",
          done: true,
          error: message,
          snapshot: {
            ...task.state.snapshot,
            phase: "error",
            lastUpdatedAt: new Date().toISOString()
          }
        };
        task.error = message;
        task.isSearching = false;
        deepSearchCacheRef.current.set(options.cacheKey, task.state);
        publish();
      });

    return task;
  }, [
    deepBudgetPreset,
    deepCrawlPolicy,
    deepProactiveDomainGuessingEnabled,
    deepSiteExpansionEnabled,
    desktopApi,
    localCustomRoots,
    localEnableContent,
    localEnableExtensionMatch,
    localEnableFuzzy,
    localIncludeHidden,
    localProjectRoot,
    localScopePreset,
    publishDeepTaskState,
    searchEngines
  ]);

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

  const activeStandardCacheKey =
    activeTabPageKind === "results" && currentResultMode === "standard" && activeTabQuery.trim().length > 0
      ? buildStandardCacheKey(activeTabId, activeTabQuery.trim(), settingsCacheKey)
      : null;
  const activeDeepCacheKey =
    activeTabPageKind === "results" && currentResultMode === "deep" && activeTabQuery.trim().length > 0
      ? buildDeepCacheKey(activeTabId, activeTabQuery.trim(), settingsCacheKey)
      : null;

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
          scopePreset: localScopePreset
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

    const loading = createLoadingPayload({
      query,
      requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      scopePreset: localScopePreset
    });
    setStandardSearchState(loading);
    setIsSearching(true);
    setSearchError(null);
  }, [
    activeDeepCacheKey,
    activeStandardCacheKey,
    activeTabPageKind,
    activeTabQuery,
    currentResultMode,
    localScopePreset
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
      cacheKey: activeStandardCacheKey,
      tabId: activeTabId,
      query
    });
  }, [
    activeStandardCacheKey,
    activeTabId,
    activeTabPageKind,
    activeTabQuery,
    currentResultMode,
    startStandardSearchTask
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
          scopePreset: localScopePreset,
          budgetPreset: deepBudgetPreset
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

    setDeepSearchState(createLoadingDeepState({
      query,
      requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      scopePreset: localScopePreset,
      budgetPreset: deepBudgetPreset
    }));
    setIsSearching(true);
    setSearchError(null);
  }, [
    activeDeepCacheKey,
    activeTabPageKind,
    activeTabQuery,
    currentResultMode,
    deepBudgetPreset,
    localScopePreset
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
      cacheKey: activeDeepCacheKey,
      tabId: activeTabId,
      query
    });
  }, [
    activeDeepCacheKey,
    activeTabId,
    activeTabPageKind,
    activeTabQuery,
    currentResultMode,
    startDeepSearchTask
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
    const streamId = task?.streamId ?? deepSearchCacheRef.current.get(cacheKey)?.streamId ?? deepSearchState.streamId;
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
        activeTask.state = {
          ...activeTask.state,
          status: "loading",
          done: false,
          snapshot: {
            ...activeTask.state.snapshot,
            phase: "streaming",
            lastUpdatedAt: new Date().toISOString()
          }
        };
        activeTask.error = null;
        activeTask.isSearching = true;
        activeTask.resume();
        return;
      }
      setIsSearching(true);
      setDeepSearchState((current) => ({
        ...current,
        status: "loading",
        done: false,
        snapshot: {
          ...current.snapshot,
          phase: "streaming",
          lastUpdatedAt: new Date().toISOString()
        }
      }));
    });
  }, [deepSearchState.streamId, desktopApi]);

  const onCancelDeepSearch = useCallback(() => {
    const cacheKey = activeDeepCacheKeyRef.current;
    if (cacheKey === null) {
      return;
    }
    const task = deepSearchTasksRef.current.get(cacheKey);
    const streamId = task?.streamId ?? deepSearchCacheRef.current.get(cacheKey)?.streamId ?? deepSearchState.streamId;
    if (streamId === undefined || streamId === null) {
      return;
    }

    const applyCancelledState = (current: DeepSearchViewState): DeepSearchViewState => ({
      ...current,
      status: current.status === "error" ? "error" : "ready",
      done: true,
      snapshot: {
        ...current.snapshot,
        phase: current.snapshot.phase === "error" ? "error" : "completed",
        lastUpdatedAt: new Date().toISOString()
      }
    });

    if (task !== undefined) {
      task.cancel();
      task.isSearching = false;
      task.state = applyCancelledState(task.state);
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
        const next = applyCancelledState(current);
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
