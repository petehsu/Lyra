import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import { createEmptySearchPayload, fetchAggregatedSearchPayload } from "../browser-search";
import { WORKBENCH_CONFIG } from "../config";
import type { AggregatedSearchPayload } from "../browser-search/types";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { WorkspaceTabsModel } from "../workspace-tabs/types";

export type BrowserSearchModel = {
  readonly searchPayload: AggregatedSearchPayload;
  readonly isSearching: boolean;
  readonly searchError: string | null;
  readonly sharedTransitionRect: DOMRect | null;
  readonly searchPillRef: MutableRefObject<HTMLDivElement | null>;
  readonly onSearchSurfaceSubmit: () => void;
  readonly onSharedAnimationDone: () => void;
};

type UseBrowserSearchModelArgs = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabsModel: WorkspaceTabsModel;
};

export const useBrowserSearchModel = ({
  desktopApi,
  tabsModel
}: UseBrowserSearchModelArgs): BrowserSearchModel => {
  const searchPillRef = useRef<HTMLDivElement | null>(null);
  const searchCacheRef = useRef(new Map<string, AggregatedSearchPayload>());
  const [searchPayload, setSearchPayload] = useState<AggregatedSearchPayload>(() =>
    createEmptySearchPayload("")
  );
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sharedTransitionRect, setSharedTransitionRect] = useState<DOMRect | null>(null);

  const activeTab = tabsModel.activeTab;
  const activeTabId = activeTab?.id ?? "";
  const activeTabPageKind = activeTab?.pageKind ?? "search";
  const activeTabQuery = activeTab?.query ?? "";

  useEffect(() => {
    if (activeTabPageKind === "results") {
      return;
    }
    setSharedTransitionRect(null);
  }, [activeTabPageKind]);

  useEffect(() => {
    if (activeTabPageKind !== "results") {
      setIsSearching(false);
      setSearchError(null);
      return;
    }
    const query = activeTabQuery.trim();
    if (query.length === 0) {
      setSearchPayload(createEmptySearchPayload(""));
      setIsSearching(false);
      setSearchError(null);
      return;
    }
    const cacheKey = `${activeTabId}:${query}`;
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      setSearchPayload(cached);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setSearchError(null);

    void fetchAggregatedSearchPayload({
      desktopApi,
      query,
      searchEngines: WORKBENCH_CONFIG.browser.searchEngines,
      resultsPerEngine: WORKBENCH_CONFIG.browser.resultsPerEngine
    })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        searchCacheRef.current.set(cacheKey, payload);
        setSearchPayload(payload);
        setIsSearching(false);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "search failed";
        setSearchError(message);
        setSearchPayload(createEmptySearchPayload(query));
        setIsSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTabId, activeTabPageKind, activeTabQuery, desktopApi]);

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

  return {
    searchPayload,
    isSearching,
    searchError,
    sharedTransitionRect,
    searchPillRef,
    onSearchSurfaceSubmit,
    onSharedAnimationDone
  };
};
